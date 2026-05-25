import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Circle,
  Copy,
  Crop,
  Download,
  Eye,
  FlipHorizontal,
  FlipVertical,
  Highlighter,
  Image as ImageIcon,
  Layers,
  Minus,
  MousePointer2,
  Pipette,
  Pencil,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Shield,
  Sparkles,
  Square,
  Type,
  Undo2,
  Workflow,
} from 'lucide-react';
import type {
  BaseMetadata,
  ImageEditorDocument,
  ImageEditorObject,
  ImageEditorObjectStyle,
  ImageEditorTool,
  IndexedImage,
} from '../types';
import {
  DEFAULT_IMAGE_EDITOR_OBJECT_STYLE,
  clampImageAdjustment,
  clampImageEditEffect,
  createImageEditorDocument,
  embedMetaHubMetadataInPngBytes,
  getImageEditOutputDimensions,
  hasImageEditorDocumentChanges,
  normalizeImageEditRecipe,
  normalizeImageEditorDocument,
  renderImageEditorDocumentToPngBlob,
  renderImageEditorDocumentToPngBytes,
} from '../services/imageEditingService';
import { mediaSourceCache } from '../services/mediaSourceCache';
import { hasCompactedRuntimeMetadata, hydrateImageRawMetadata } from '../services/rawMetadataHydration';
import { getRelativeImagePath, splitRelativePath } from '../utils/imagePaths';
import { getFileExtension } from '../utils/mediaTypes.js';
import { indexImageFileAtPath, reparseIndexedImage } from '../services/fileIndexer';
import cacheManager from '../services/cacheManager';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGenerateWithComfyUI } from '../hooks/useGenerateWithComfyUI';
import { useFeatureAccess } from '../hooks/useFeatureAccess';

interface ImageEditorWorkspaceProps {
  image: IndexedImage;
  navigationImages?: IndexedImage[];
  directoryPath?: string;
  onBack: () => void;
  onOpenComfyUIWorkflow?: (image: IndexedImage) => void;
}

type HistoryState = {
  past: ImageEditorDocument[];
  future: ImageEditorDocument[];
};

type EditorSessionState = {
  document: ImageEditorDocument;
  activeTool: ImageEditorTool;
  activeStyle: ImageEditorObjectStyle;
  history: HistoryState;
  zoom: number;
};

type DragState = {
  tool: ImageEditorTool;
  start: { x: number; y: number };
  current: { x: number; y: number };
  points?: { x: number; y: number }[];
  movingObjectId?: string;
  movingObjectIds?: string[];
  resizeHandle?: ResizeHandle;
  keepAspectRatio?: boolean;
};

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type PanState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  scrollLeft: number;
  scrollTop: number;
};

const editorSessionCache = new Map<string, EditorSessionState>();

const TOOL_DEFS: Array<{ id: ImageEditorTool; label: string; icon: React.ReactNode }> = [
  { id: 'select', label: 'Select', icon: <MousePointer2 className="h-4 w-4" /> },
  { id: 'color-picker', label: 'Pick Color', icon: <Pipette className="h-4 w-4" /> },
  { id: 'crop', label: 'Crop', icon: <Crop className="h-4 w-4" /> },
  { id: 'rectangle', label: 'Rectangle', icon: <Square className="h-4 w-4" /> },
  { id: 'ellipse', label: 'Ellipse', icon: <Circle className="h-4 w-4" /> },
  { id: 'line', label: 'Line', icon: <Minus className="h-4 w-4" /> },
  { id: 'arrow', label: 'Arrow', icon: <ArrowLeft className="h-4 w-4 rotate-180" /> },
  { id: 'freehand', label: 'Freehand', icon: <Pencil className="h-4 w-4" /> },
  { id: 'text', label: 'Text', icon: <Type className="h-4 w-4" /> },
  { id: 'highlight', label: 'Highlight', icon: <Highlighter className="h-4 w-4" /> },
  { id: 'blur', label: 'Blur', icon: <Eye className="h-4 w-4" /> },
  { id: 'pixelate', label: 'Pixelate', icon: <Shield className="h-4 w-4" /> },
  { id: 'spotlight', label: 'Spotlight', icon: <Search className="h-4 w-4" /> },
];

const isEnabledEditorTool = (tool: ImageEditorTool) => TOOL_DEFS.some((definition) => definition.id === tool);

const TOOL_HINTS: Record<ImageEditorTool, string> = {
  select: 'Click an object to select it.',
  'color-picker': 'Click the image to pick a color for the active style.',
  crop: 'Drag a crop area. The crop is editable in the inspector.',
  rectangle: 'Drag to create a rectangle annotation.',
  ellipse: 'Drag to create an ellipse annotation.',
  line: 'Drag to draw a line.',
  arrow: 'Drag toward the arrow tip.',
  freehand: 'Drag to sketch a freehand stroke.',
  text: 'Click or drag, then enter text.',
  step: 'Click or drag to place a numbered step marker.',
  highlight: 'Drag to highlight an area.',
  blur: 'Drag over a region to blur it on export.',
  pixelate: 'Drag over a region to pixelate it on export.',
  spotlight: 'Drag the spotlight focus area.',
  magnify: 'Drag the magnified lens area.',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const clampZoom = (value: number) => clamp(Math.round(value * 100) / 100, 0.1, 6);

const createObjectId = () => `editor_obj_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

const isEditableShortcutTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
};

const isAnnotationTool = (tool: ImageEditorTool): tool is ImageEditorObject['type'] => (
  tool !== 'select' && tool !== 'color-picker' && tool !== 'crop'
);

const isResizableObjectType = (type: ImageEditorObject['type']) => type === 'rectangle' || type === 'ellipse';

const TOOL_SHORTCUTS: Partial<Record<string, ImageEditorTool>> = {
  v: 'select',
  i: 'color-picker',
  c: 'crop',
  r: 'rectangle',
  e: 'ellipse',
  l: 'line',
  a: 'arrow',
  f: 'freehand',
  t: 'text',
  h: 'highlight',
  b: 'blur',
  p: 'pixelate',
  s: 'spotlight',
};

const getUsableNormalizedMetadata = (image: IndexedImage): BaseMetadata | undefined => (
  image.metadata?.normalizedMetadata as BaseMetadata | undefined
);

const boundsFromPoints = (points: Array<{ x: number; y: number }>): ImageEditorObject['bounds'] => {
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
};

const boundsFromDrag = (drag: DragState): ImageEditorObject['bounds'] => ({
  x: Math.min(drag.start.x, drag.current.x),
  y: Math.min(drag.start.y, drag.current.y),
  width: Math.max(1, Math.abs(drag.current.x - drag.start.x)),
  height: Math.max(1, Math.abs(drag.current.y - drag.start.y)),
});

const boundsIntersect = (first: ImageEditorObject['bounds'], second: ImageEditorObject['bounds']) => (
  first.x < second.x + second.width &&
  first.x + first.width > second.x &&
  first.y < second.y + second.height &&
  first.y + first.height > second.y
);

const objectFromDrag = (
  tool: ImageEditorTool,
  drag: DragState,
  style: ImageEditorObjectStyle,
  nextStepNumber: number,
): ImageEditorObject | null => {
  if (!isAnnotationTool(tool)) {
    return null;
  }

  const dragBounds = boundsFromDrag(drag);
  const x = dragBounds.x;
  const y = dragBounds.y;
  const width = dragBounds.width;
  const height = dragBounds.height;
  const isPointTool = tool === 'text' || tool === 'step';
  const resolvedBounds = tool === 'freehand' && drag.points?.length
    ? boundsFromPoints(drag.points)
    : isPointTool
    ? { x: drag.start.x, y: drag.start.y, width: tool === 'step' ? 44 : Math.max(160, width), height: tool === 'step' ? 44 : Math.max(48, height) }
    : { x, y, width, height };

  const text = tool === 'text'
    ? window.prompt('Text annotation', 'Text') || 'Text'
    : undefined;
  const directionalPoints = tool === 'line' || tool === 'arrow'
    ? [drag.start, drag.current]
    : undefined;

  return {
    id: createObjectId(),
    type: tool,
    bounds: resolvedBounds,
    points: tool === 'freehand' ? drag.points : directionalPoints,
    text,
    stepNumber: tool === 'step' ? nextStepNumber : undefined,
    zIndex: Date.now(),
    style: { ...style },
  };
};

const getCanvasPoint = (
  event: React.PointerEvent<HTMLDivElement>,
  canvasElement: HTMLDivElement | null,
  document: ImageEditorDocument,
) => {
  const rect = canvasElement?.getBoundingClientRect();
  if (!rect) {
    return { x: 0, y: 0 };
  }
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * document.canvasDimensions.width, 0, document.canvasDimensions.width),
    y: clamp(((event.clientY - rect.top) / rect.height) * document.canvasDimensions.height, 0, document.canvasDimensions.height),
  };
};

const colorComponentToHex = (value: number) => Math.round(value).toString(16).padStart(2, '0');
const rgbToHex = (red: number, green: number, blue: number) => `#${colorComponentToHex(red)}${colorComponentToHex(green)}${colorComponentToHex(blue)}`;
const toColorInputValue = (value: string | undefined) => /^#[0-9a-f]{6}$/i.test(value || '') ? value as string : '#000000';

const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const getHandlePoint = (bounds: ImageEditorObject['bounds'], handle: ResizeHandle) => {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;

  switch (handle) {
    case 'nw': return { x: bounds.x, y: bounds.y };
    case 'n': return { x: centerX, y: bounds.y };
    case 'ne': return { x: right, y: bounds.y };
    case 'e': return { x: right, y: centerY };
    case 'se': return { x: right, y: bottom };
    case 's': return { x: centerX, y: bottom };
    case 'sw': return { x: bounds.x, y: bottom };
    case 'w': return { x: bounds.x, y: centerY };
  }
};

const getResizeHandleAtPoint = (
  point: { x: number; y: number },
  bounds: ImageEditorObject['bounds'],
  tolerance: number,
): ResizeHandle | null => {
  for (const handle of RESIZE_HANDLES) {
    const handlePoint = getHandlePoint(bounds, handle);
    if (Math.abs(point.x - handlePoint.x) <= tolerance && Math.abs(point.y - handlePoint.y) <= tolerance) {
      return handle;
    }
  }
  return null;
};

const resizeBoundsFromHandle = (
  bounds: ImageEditorObject['bounds'],
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  canvasDimensions: { width: number; height: number },
  keepAspectRatio = false,
) => {
  const minSize = 8;
  const originalAspectRatio = bounds.width / Math.max(1, bounds.height);
  let x = bounds.x;
  let y = bounds.y;
  let width = bounds.width;
  let height = bounds.height;

  if (handle.includes('w')) {
    x += deltaX;
    width -= deltaX;
  }
  if (handle.includes('e')) {
    width += deltaX;
  }
  if (handle.includes('n')) {
    y += deltaY;
    height -= deltaY;
  }
  if (handle.includes('s')) {
    height += deltaY;
  }

  if (keepAspectRatio) {
    const widthFromHeight = Math.max(minSize, Math.abs(height)) * originalAspectRatio;
    const heightFromWidth = Math.max(minSize, Math.abs(width)) / originalAspectRatio;
    if (handle.length === 2) {
      if (Math.abs(deltaX) >= Math.abs(deltaY)) {
        height = heightFromWidth;
      } else {
        width = widthFromHeight;
      }
      if (handle.includes('w')) {
        x = bounds.x + bounds.width - width;
      }
      if (handle.includes('n')) {
        y = bounds.y + bounds.height - height;
      }
    } else if (handle === 'e' || handle === 'w') {
      height = heightFromWidth;
      y = bounds.y + (bounds.height - height) / 2;
      if (handle === 'w') {
        x = bounds.x + bounds.width - width;
      }
    } else {
      width = widthFromHeight;
      x = bounds.x + (bounds.width - width) / 2;
      if (handle === 'n') {
        y = bounds.y + bounds.height - height;
      }
    }
  }

  if (width < minSize) {
    if (handle.includes('w')) {
      x = bounds.x + bounds.width - minSize;
    }
    width = minSize;
  }
  if (height < minSize) {
    if (handle.includes('n')) {
      y = bounds.y + bounds.height - minSize;
    }
    height = minSize;
  }

  x = clamp(x, 0, Math.max(0, canvasDimensions.width - minSize));
  y = clamp(y, 0, Math.max(0, canvasDimensions.height - minSize));
  width = clamp(width, minSize, canvasDimensions.width - x);
  height = clamp(height, minSize, canvasDimensions.height - y);

  return { x, y, width, height };
};

const ImageEditorWorkspace: React.FC<ImageEditorWorkspaceProps> = ({
  image,
  navigationImages = [],
  directoryPath,
  onBack,
  onOpenComfyUIWorkflow,
}) => {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceReady, setSourceReady] = useState(false);
  const [documentState, setDocumentState] = useState<ImageEditorDocument | null>(null);
  const [activeTool, setActiveTool] = useState<ImageEditorTool>('select');
  const [activeStyle, setActiveStyle] = useState<ImageEditorObjectStyle>(DEFAULT_IMAGE_EDITOR_OBJECT_STYLE);
  const [history, setHistory] = useState<HistoryState>({ past: [], future: [] });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [zoom, setZoom] = useState(1);
  const [hydratedImage, setHydratedImage] = useState<IndexedImage | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);
  const sessionRef = useRef<EditorSessionState | null>(null);
  const panStateRef = useRef<PanState | null>(null);

  const directories = useImageStore((state) => state.directories);
  const addImages = useImageStore((state) => state.addImages);
  const mergeImages = useImageStore((state) => state.mergeImages);
  const setImageThumbnail = useImageStore((state) => state.setImageThumbnail);
  const setError = useImageStore((state) => state.setError);
  const setSuccess = useImageStore((state) => state.setSuccess);
  const scanSubfolders = useImageStore((state) => state.scanSubfolders);
  const allImages = useImageStore((state) => state.images);
  const comfyUIEnabled = useSettingsStore((state) => state.comfyUIEnabled);
  const comfyUIServerUrl = useSettingsStore((state) => state.comfyUIServerUrl);
  const { canUseComfyUI, showProModal } = useFeatureAccess();
  const { generateWithComfyUI, isGenerating: isUpscaling } = useGenerateWithComfyUI();

  const normalizedDocument = useMemo(
    () => documentState ? normalizeImageEditorDocument(documentState) : null,
    [documentState],
  );
  const basePreviewDocument = useMemo(
    () => normalizedDocument
      ? {
        ...normalizedDocument,
        objects: [],
        selectedObjectIds: [],
      }
      : null,
    [
      normalizedDocument?.background,
      normalizedDocument?.canvasDimensions.height,
      normalizedDocument?.canvasDimensions.width,
      normalizedDocument?.recipe,
      normalizedDocument?.sourceDimensions.height,
      normalizedDocument?.sourceDimensions.width,
      normalizedDocument?.sourceImageId,
      normalizedDocument?.sourceName,
    ],
  );
  const basePreviewKey = useMemo(
    () => basePreviewDocument
      ? JSON.stringify({
        background: basePreviewDocument.background,
        canvasDimensions: basePreviewDocument.canvasDimensions,
        recipe: basePreviewDocument.recipe,
        sourceDimensions: basePreviewDocument.sourceDimensions,
        sourceImageId: basePreviewDocument.sourceImageId,
      })
      : '',
    [basePreviewDocument],
  );
  const hasChanges = normalizedDocument ? hasImageEditorDocumentChanges(normalizedDocument) : false;
  const selectedObject = normalizedDocument?.objects.find((object) => normalizedDocument.selectedObjectIds.includes(object.id)) || null;
  const canOverwrite = getFileExtension(image.name) === '.png';
  const displayWidth = Math.max(160, Math.round(1080 * zoom));

  useEffect(() => {
    if (!documentState) {
      sessionRef.current = null;
      return;
    }
    sessionRef.current = {
      document: documentState,
      activeTool,
      activeStyle,
      history,
      zoom,
    };
  }, [activeStyle, activeTool, documentState, history, zoom]);

  const commitDocument = useCallback((updater: (current: ImageEditorDocument) => ImageEditorDocument, label: string) => {
    setDocumentState((current) => {
      if (!current) {
        return current;
      }
      const after = normalizeImageEditorDocument(updater(current));
      setHistory((historyState) => ({
        past: [...historyState.past, current].slice(-80),
        future: [],
      }));
      return after;
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    setSourceReady(false);
    setSourceUrl(null);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setDocumentState(null);
    setHistory({ past: [], future: [] });
    setHydratedImage(null);

    const load = async () => {
      try {
        const source = await mediaSourceCache.getOrLoad(image, directoryPath, { prioritize: true });
        if (!mounted) return;
        setSourceUrl(source);
        const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          const element = new Image();
          element.onload = () => resolve({ width: element.naturalWidth || element.width, height: element.naturalHeight || element.height });
          element.onerror = () => reject(new Error('Failed to load image dimensions.'));
          element.src = source;
        });
        if (!mounted) return;
        const cachedSession = editorSessionCache.get(image.id);
        if (cachedSession) {
          setDocumentState(cachedSession.document);
          setActiveTool(isEnabledEditorTool(cachedSession.activeTool) ? cachedSession.activeTool : 'select');
          setActiveStyle(cachedSession.activeStyle);
          setHistory(cachedSession.history);
          setZoom(cachedSession.zoom);
        } else {
          setDocumentState(createImageEditorDocument({
            imageId: image.id,
            name: image.name,
            width: dimensions.width,
            height: dimensions.height,
          }));
        }
        setSourceReady(true);
      } catch (error) {
        if (mounted) {
          setError(error instanceof Error ? error.message : 'Failed to open image editor.');
        }
      }
    };

    void load();
    return () => {
      mounted = false;
      if (sessionRef.current) {
        editorSessionCache.set(image.id, sessionRef.current);
      }
    };
  }, [directoryPath, image, setError]);

  useEffect(() => () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  }, [previewUrl]);

  useEffect(() => {
    if (!sourceUrl || !basePreviewDocument || !sourceReady) {
      return;
    }
    let canceled = false;
    setIsRendering(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const blob = await renderImageEditorDocumentToPngBlob(sourceUrl, basePreviewDocument);
        if (canceled) return;
        const nextUrl = URL.createObjectURL(blob);
        setPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return nextUrl;
        });
      } catch (error) {
        if (!canceled) {
          console.warn('[ImageEditorWorkspace] Failed to render preview:', error);
        }
      } finally {
        if (!canceled) {
          setIsRendering(false);
        }
      }
    }, 80);

    return () => {
      canceled = true;
      window.clearTimeout(timeoutId);
    };
  }, [basePreviewKey, sourceReady, sourceUrl]);

  const ensureHydratedImage = useCallback(async () => {
    if (hydratedImage?.id === image.id) {
      return hydratedImage;
    }
    if (!hasCompactedRuntimeMetadata(image)) {
      setHydratedImage(image);
      return image;
    }
    const hydrated = await hydrateImageRawMetadata(image, directoryPath);
    setHydratedImage(hydrated);
    return hydrated;
  }, [directoryPath, hydratedImage, image]);

  const findDirectoryForAbsolutePath = useCallback((filePath: string) => {
    const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const normalizedFile = normalize(filePath);
    return directories.find((directory) => normalizedFile.startsWith(`${normalize(directory.path)}/`)) ?? null;
  }, [directories]);

  const buildDefaultSavePath = useCallback(async () => {
    const relativePath = getRelativeImagePath(image);
    const { folderPath, fileName } = splitRelativePath(relativePath);
    const dotIndex = fileName.lastIndexOf('.');
    const basename = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    const editedRelativePath = folderPath ? `${folderPath}/${basename}-editor.png` : `${basename}-editor.png`;
    if (!directoryPath || !window.electronAPI?.joinPaths) {
      return `${basename}-editor.png`;
    }
    const joined = await window.electronAPI.joinPaths(directoryPath, editedRelativePath);
    return joined.success && joined.path ? joined.path : `${basename}-editor.png`;
  }, [directoryPath, image]);

  const renderExportBytes = useCallback(async () => {
    if (!sourceUrl || !normalizedDocument) {
      throw new Error('The editor source image is still loading.');
    }
    const bytes = await renderImageEditorDocumentToPngBytes(sourceUrl, normalizedDocument);
    const sourceImage = await ensureHydratedImage();
    const sourceMetadata = getUsableNormalizedMetadata(sourceImage);
    const rawMetadata = sourceImage.metadata as Record<string, unknown> | undefined;
    const outputDimensions = {
      width: normalizedDocument.canvasDimensions.width,
      height: normalizedDocument.canvasDimensions.height,
    };
    return embedMetaHubMetadataInPngBytes(
      bytes,
      sourceMetadata,
      normalizedDocument.recipe,
      rawMetadata,
      outputDimensions,
      {
        tool: 'image-editor-workspace-v1',
        annotationCount: normalizedDocument.objects.length,
        background: normalizedDocument.background,
        sourceImageId: normalizedDocument.sourceImageId,
      },
    );
  }, [ensureHydratedImage, normalizedDocument, sourceUrl]);

  const saveToPath = useCallback(async (targetPath: string, mode: 'save_as' | 'overwrite') => {
    if (!window.electronAPI?.writeFile) {
      throw new Error('Saving edited images is only available in the desktop app.');
    }
    const outputBytes = await renderExportBytes();
    const result = await window.electronAPI.writeFile(targetPath, outputBytes);
    if (!result.success) {
      throw new Error(result.error || 'Failed to write edited image.');
    }

    const sourceDirectory = mode === 'overwrite'
      ? directories.find((directory) => directory.id === image.directoryId) ?? null
      : findDirectoryForAbsolutePath(targetPath);
    if (!sourceDirectory) {
      return null;
    }

    const indexedImage = mode === 'overwrite'
      ? await reparseIndexedImage(image, sourceDirectory.path)
      : await indexImageFileAtPath(targetPath, sourceDirectory);
    if (!indexedImage) {
      return null;
    }

    if (mode === 'overwrite') {
      mergeImages([indexedImage]);
      setImageThumbnail(image.id, { thumbnailUrl: null, thumbnailHandle: null, status: 'pending', error: null });
      await cacheManager.updateCachedImages(sourceDirectory.path, sourceDirectory.name, [indexedImage], scanSubfolders);
    } else if (allImages.some((candidate) => candidate.id === indexedImage.id)) {
      mergeImages([indexedImage]);
      await cacheManager.updateCachedImages(sourceDirectory.path, sourceDirectory.name, [indexedImage], scanSubfolders);
    } else {
      addImages([indexedImage]);
      await cacheManager.appendToCache(sourceDirectory.path, sourceDirectory.name, [indexedImage], scanSubfolders);
    }
    return indexedImage;
  }, [
    addImages,
    allImages,
    directories,
    findDirectoryForAbsolutePath,
    image,
    mergeImages,
    renderExportBytes,
    scanSubfolders,
    setImageThumbnail,
  ]);

  const handleSaveAs = useCallback(async () => {
    if (!window.electronAPI?.showSaveDialog) {
      setError('Save As is only available in the desktop app.');
      return;
    }
    setIsSaving(true);
    try {
      const defaultPath = await buildDefaultSavePath();
      const saveResult = await window.electronAPI.showSaveDialog({
        title: 'Save edited image',
        defaultPath,
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
      });
      if (saveResult.canceled || !saveResult.path) {
        return;
      }
      await saveToPath(saveResult.path, 'save_as');
      setSuccess('Saved editor image.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save editor image.');
    } finally {
      setIsSaving(false);
    }
  }, [buildDefaultSavePath, saveToPath, setError, setSuccess]);

  const handleSave = useCallback(async () => {
    if (!canOverwrite) {
      await handleSaveAs();
      return;
    }
    if (!window.electronAPI?.joinPaths) {
      setError('Save is only available in the desktop app.');
      return;
    }
    const sourceDirectory = directories.find((directory) => directory.id === image.directoryId);
    if (!sourceDirectory) {
      setError('Cannot save because the source directory is unavailable.');
      return;
    }
    if (!window.confirm('Overwrite the original image with the editor output? This cannot be undone.')) {
      return;
    }
    setIsSaving(true);
    try {
      const joined = await window.electronAPI.joinPaths(sourceDirectory.path, getRelativeImagePath(image));
      if (!joined.success || !joined.path) {
        throw new Error(joined.error || 'Failed to resolve original image path.');
      }
      await saveToPath(joined.path, 'overwrite');
      setSuccess('Saved editor output over the original PNG.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to overwrite editor image.');
    } finally {
      setIsSaving(false);
    }
  }, [canOverwrite, directories, handleSaveAs, image, saveToPath, setError, setSuccess]);

  const handleCopy = useCallback(async () => {
    if (!sourceUrl || !normalizedDocument) return;
    try {
      const blob = await renderImageEditorDocumentToPngBlob(sourceUrl, normalizedDocument);
      const ClipboardItemCtor = window.ClipboardItem;
      if (!navigator.clipboard || !ClipboardItemCtor) {
        throw new Error('Image clipboard is not available in this browser.');
      }
      await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
      setSuccess('Copied editor image to clipboard.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to copy editor image.');
    }
  }, [normalizedDocument, setError, setSuccess, sourceUrl]);

  const handleAIUpscale = useCallback(async () => {
    if (!canUseComfyUI) {
      showProModal('comfyui');
      return;
    }
    if (!comfyUIEnabled || !comfyUIServerUrl) {
      setError('AI Upscale needs ComfyUI enabled and a server URL in Settings.');
      return;
    }
    if (!image.handle) {
      setError('AI Upscale needs desktop file access to upload the source image.');
      return;
    }
    await generateWithComfyUI(image, {
      workflowMode: 'upscale',
      customMetadata: { prompt: image.prompt || 'ComfyUI upscale' },
    });
  }, [canUseComfyUI, comfyUIEnabled, comfyUIServerUrl, generateWithComfyUI, image, setError, showProModal]);

  const handleBack = useCallback(() => {
    if (hasChanges && !window.confirm('Leave the image editor and discard the current editor state?')) {
      return;
    }
    onBack();
  }, [hasChanges, onBack]);

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past[current.past.length - 1];
      if (!previous || !documentState) return current;
      setDocumentState(previous);
      return {
        past: current.past.slice(0, -1),
        future: [documentState, ...current.future],
      };
    });
  }, [documentState]);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0];
      if (!next || !documentState) return current;
      setDocumentState(next);
      return {
        past: [...current.past, documentState],
        future: current.future.slice(1),
      };
    });
  }, [documentState]);

  const updateRecipe = useCallback((recipe: ImageEditorDocument['recipe']) => {
    commitDocument((current) => ({ ...current, recipe: normalizeImageEditRecipe(recipe, current.sourceDimensions) }), 'Edit recipe');
  }, [commitDocument]);

  const updateBackground = useCallback((background: Partial<ImageEditorDocument['background']>) => {
    commitDocument((current) => ({ ...current, background: { ...current.background, ...background } }), 'Background');
  }, [commitDocument]);

  const updateSelectedObjectStyle = useCallback((style: Partial<ImageEditorObjectStyle>) => {
    if (!selectedObject) return;
    commitDocument((current) => ({
      ...current,
      objects: current.objects.map((object) => object.id === selectedObject.id ? { ...object, style: { ...object.style, ...style } } : object),
    }), 'Object style');
  }, [commitDocument, selectedObject]);

  const deleteSelected = useCallback(() => {
    if (!normalizedDocument?.selectedObjectIds.length) return;
    const ids = new Set(normalizedDocument.selectedObjectIds);
    commitDocument((current) => ({
      ...current,
      objects: current.objects.filter((object) => !ids.has(object.id)),
      selectedObjectIds: [],
    }), 'Delete object');
  }, [commitDocument, normalizedDocument?.selectedObjectIds]);

  const flattenSelection = useCallback(() => {
    if (!normalizedDocument) return;
    commitDocument((current) => ({ ...current, selectedObjectIds: [] }), 'Flatten');
    setSuccess('Flatten will be applied in the saved PNG output.');
  }, [commitDocument, normalizedDocument, setSuccess]);

  const restoreOriginal = useCallback(() => {
    if (!normalizedDocument) return;
    if (!window.confirm('Restore the original image and discard all editor changes?')) {
      return;
    }
    setDocumentState(createImageEditorDocument({
      imageId: image.id,
      name: image.name,
      width: normalizedDocument.sourceDimensions.width,
      height: normalizedDocument.sourceDimensions.height,
    }));
    setHistory({ past: [], future: [] });
    setDragState(null);
  }, [image.id, image.name, normalizedDocument]);

  const pickColorAtPoint = useCallback((point: { x: number; y: number }) => {
    const imageElement = previewImageRef.current;
    if (!imageElement || !normalizedDocument) {
      return;
    }
    const sampleCanvas = document.createElement('canvas');
    const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!sampleContext) {
      return;
    }
    const width = imageElement.naturalWidth || imageElement.width;
    const height = imageElement.naturalHeight || imageElement.height;
    sampleCanvas.width = 1;
    sampleCanvas.height = 1;
    const sampleX = clamp(Math.round((point.x / normalizedDocument.canvasDimensions.width) * width), 0, Math.max(0, width - 1));
    const sampleY = clamp(Math.round((point.y / normalizedDocument.canvasDimensions.height) * height), 0, Math.max(0, height - 1));
    sampleContext.drawImage(imageElement, sampleX, sampleY, 1, 1, 0, 0, 1, 1);
    const [red, green, blue] = sampleContext.getImageData(0, 0, 1, 1).data;
    const color = rgbToHex(red, green, blue);
    setActiveStyle((current) => ({ ...current, strokeColor: color, textColor: color }));
    if (selectedObject) {
      updateSelectedObjectStyle(selectedObject.type === 'text' || selectedObject.type === 'step'
        ? { textColor: color }
        : { strokeColor: color });
    }
  }, [normalizedDocument, selectedObject, updateSelectedObjectStyle]);

  const pointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!normalizedDocument) return;
    if (event.button === 1) {
      event.preventDefault();
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      panStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        scrollLeft: scrollContainer.scrollLeft,
        scrollTop: scrollContainer.scrollTop,
      };
      return;
    }
    if (event.button !== 0) return;
    const point = getCanvasPoint(event, canvasRef.current, normalizedDocument);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (selectedObject && isResizableObjectType(selectedObject.type)) {
      const tolerance = Math.max(8, normalizedDocument.canvasDimensions.width / Math.max(1, displayWidth) * 10);
      const resizeHandle = getResizeHandleAtPoint(point, selectedObject.bounds, tolerance);
      if (resizeHandle) {
        setDragState({
          tool: 'select',
          start: point,
          current: point,
          movingObjectId: selectedObject.id,
          resizeHandle,
          keepAspectRatio: event.shiftKey,
        });
        return;
      }
    }

    if (activeTool === 'color-picker') {
      pickColorAtPoint(point);
      return;
    }

    const selected = [...normalizedDocument.objects]
      .reverse()
      .find((object) => point.x >= object.bounds.x && point.x <= object.bounds.x + object.bounds.width && point.y >= object.bounds.y && point.y <= object.bounds.y + object.bounds.height);

    if (selected && (activeTool === 'select' || activeTool === selected.type || normalizedDocument.selectedObjectIds.includes(selected.id))) {
      const selectedIds = normalizedDocument.selectedObjectIds.includes(selected.id)
        ? normalizedDocument.selectedObjectIds
        : [selected.id];
      setDragState({
        tool: 'select',
        start: point,
        current: point,
        movingObjectId: selected.id,
        movingObjectIds: selectedIds,
      });
      commitDocument((current) => ({ ...current, selectedObjectIds: selectedIds }), 'Select');
      return;
    }

    if (activeTool === 'select') {
      setDragState({
        tool: 'select',
        start: point,
        current: point,
      });
      return;
    }

    setDragState({
      tool: activeTool,
      start: point,
      current: point,
      points: activeTool === 'freehand' ? [point] : undefined,
    });
  }, [activeTool, commitDocument, displayWidth, normalizedDocument, pickColorAtPoint, selectedObject]);

  const pointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current;
    if (panState) {
      const scrollContainer = scrollContainerRef.current;
      if (scrollContainer) {
        scrollContainer.scrollLeft = panState.scrollLeft - (event.clientX - panState.startClientX);
        scrollContainer.scrollTop = panState.scrollTop - (event.clientY - panState.startClientY);
      }
      return;
    }
    if (!dragState || !normalizedDocument) return;
    const point = getCanvasPoint(event, canvasRef.current, normalizedDocument);
    setDragState((current) => current ? {
      ...current,
      current: point,
      keepAspectRatio: current.resizeHandle ? event.shiftKey : current.keepAspectRatio,
      points: current.points ? [...current.points, point] : undefined,
    } : current);
  }, [dragState, normalizedDocument]);

  const pointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (panStateRef.current?.pointerId === event.pointerId) {
      panStateRef.current = null;
      return;
    }
    if (!dragState || !normalizedDocument) return;
    const completedDrag = dragState;
    setDragState(null);

    if (completedDrag.tool === 'select' && !completedDrag.movingObjectId && !completedDrag.resizeHandle) {
      const selectionBounds = boundsFromDrag(completedDrag);
      const hasMarqueeSize = selectionBounds.width > 3 || selectionBounds.height > 3;
      commitDocument((current) => ({
        ...current,
        selectedObjectIds: hasMarqueeSize
          ? current.objects.filter((object) => boundsIntersect(selectionBounds, object.bounds)).map((object) => object.id)
          : [],
      }), 'Select objects');
      return;
    }

    if (completedDrag.tool === 'select' && completedDrag.movingObjectId) {
      const deltaX = completedDrag.current.x - completedDrag.start.x;
      const deltaY = completedDrag.current.y - completedDrag.start.y;
      const movingIds = new Set(completedDrag.movingObjectIds?.length ? completedDrag.movingObjectIds : [completedDrag.movingObjectId]);
      if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
        commitDocument((current) => ({
          ...current,
          objects: current.objects.map((object) => {
            if (!movingIds.has(object.id)) {
              return object;
            }
            if (completedDrag.resizeHandle && object.id === completedDrag.movingObjectId) {
              const resizedBounds = resizeBoundsFromHandle(
                object.bounds,
                completedDrag.resizeHandle,
                deltaX,
                deltaY,
                current.canvasDimensions,
                completedDrag.keepAspectRatio,
              );
              return {
                ...object,
                bounds: resizedBounds,
              };
            }
            const x = clamp(object.bounds.x + deltaX, 0, Math.max(0, current.canvasDimensions.width - object.bounds.width));
            const y = clamp(object.bounds.y + deltaY, 0, Math.max(0, current.canvasDimensions.height - object.bounds.height));
            const appliedDeltaX = x - object.bounds.x;
            const appliedDeltaY = y - object.bounds.y;
            return {
              ...object,
              bounds: { ...object.bounds, x, y },
              points: object.points?.map((point) => ({
                x: clamp(point.x + appliedDeltaX, 0, current.canvasDimensions.width),
                y: clamp(point.y + appliedDeltaY, 0, current.canvasDimensions.height),
              })),
            };
          }),
          selectedObjectIds: [...movingIds],
        }), 'Move object');
      }
      return;
    }

    if (completedDrag.tool === 'crop') {
      const x = Math.min(completedDrag.start.x, completedDrag.current.x);
      const y = Math.min(completedDrag.start.y, completedDrag.current.y);
      const width = Math.max(1, Math.abs(completedDrag.current.x - completedDrag.start.x));
      const height = Math.max(1, Math.abs(completedDrag.current.y - completedDrag.start.y));
      commitDocument((current) => ({
        ...current,
        recipe: {
          ...current.recipe,
          crop: {
            enabled: true,
            aspect: 'free',
            rect: { x, y, width, height },
          },
        },
      }), 'Crop');
      return;
    }

    const nextObject = objectFromDrag(
      completedDrag.tool,
      completedDrag,
      activeStyle,
      normalizedDocument.objects.filter((object) => object.type === 'step').length + 1,
    );
    if (!nextObject) return;

    commitDocument((current) => ({
      ...current,
      objects: [...current.objects, { ...nextObject, zIndex: current.objects.length + 1 }],
      selectedObjectIds: [nextObject.id],
    }), 'Add annotation');
  }, [activeStyle, commitDocument, dragState, normalizedDocument]);

  const moveSelected = useCallback((direction: 'front' | 'forward' | 'backward' | 'back') => {
    if (!selectedObject) return;
    commitDocument((current) => {
      const objects = current.objects.map((object) => ({ ...object }));
      const target = objects.find((object) => object.id === selectedObject.id);
      if (!target) return current;
      const zValues = objects.map((object) => object.zIndex);
      const min = Math.min(...zValues);
      const max = Math.max(...zValues);
      target.zIndex = direction === 'front'
        ? max + 1
        : direction === 'back'
          ? min - 1
          : target.zIndex + (direction === 'forward' ? 1 : -1);
      return { ...current, objects };
    }, 'Layer order');
  }, [commitDocument, selectedObject]);

  const duplicateSelected = useCallback(() => {
    if (!selectedObject) return;
    commitDocument((current) => {
      const source = current.objects.find((object) => object.id === selectedObject.id);
      if (!source) return current;
      const cloneId = createObjectId();
      const maxZIndex = current.objects.reduce((max, object) => Math.max(max, object.zIndex), 0);
      const clone: ImageEditorObject = {
        ...JSON.parse(JSON.stringify(source)) as ImageEditorObject,
        id: cloneId,
        zIndex: maxZIndex + 1,
        bounds: {
          ...source.bounds,
          x: clamp(source.bounds.x + 16, 0, Math.max(0, current.canvasDimensions.width - source.bounds.width)),
          y: clamp(source.bounds.y + 16, 0, Math.max(0, current.canvasDimensions.height - source.bounds.height)),
        },
        points: source.points?.map((point) => ({
          x: clamp(point.x + 16, 0, current.canvasDimensions.width),
          y: clamp(point.y + 16, 0, current.canvasDimensions.height),
        })),
      };
      return {
        ...current,
        objects: [...current.objects, clone],
        selectedObjectIds: [cloneId],
      };
    }, 'Duplicate object');
  }, [commitDocument, selectedObject]);

  const deleteAllObjects = useCallback(() => {
    if (!normalizedDocument?.objects.length) return;
    commitDocument((current) => ({ ...current, objects: [], selectedObjectIds: [] }), 'Delete all objects');
  }, [commitDocument, normalizedDocument?.objects.length]);

  const moveSelectedBy = useCallback((deltaX: number, deltaY: number) => {
    if (!selectedObject) return;
    commitDocument((current) => ({
      ...current,
      objects: current.objects.map((object) => {
        if (object.id !== selectedObject.id) {
          return object;
        }
        const x = clamp(object.bounds.x + deltaX, 0, Math.max(0, current.canvasDimensions.width - object.bounds.width));
        const y = clamp(object.bounds.y + deltaY, 0, Math.max(0, current.canvasDimensions.height - object.bounds.height));
        return {
          ...object,
          bounds: { ...object.bounds, x, y },
          points: object.points?.map((point) => ({
            x: clamp(point.x + deltaX, 0, current.canvasDimensions.width),
            y: clamp(point.y + deltaY, 0, current.canvasDimensions.height),
          })),
        };
      }),
    }), 'Move object');
  }, [commitDocument, selectedObject]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      const hasCommandModifier = event.ctrlKey || event.metaKey;

      if (hasCommandModifier) {
        if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) {
            redo();
          } else {
            undo();
          }
          return;
        }
        if (key === 'y') {
          event.preventDefault();
          redo();
          return;
        }
        if (key === 's') {
          event.preventDefault();
          if (event.shiftKey) {
            void handleSaveAs();
          } else {
            void handleSave();
          }
          return;
        }
        if (key === 'c') {
          event.preventDefault();
          void handleCopy();
          return;
        }
        if (key === 'd') {
          event.preventDefault();
          duplicateSelected();
          return;
        }
        if (key === 'a') {
          event.preventDefault();
          commitDocument((current) => ({
            ...current,
            selectedObjectIds: current.objects.map((object) => object.id),
          }), 'Select all');
          return;
        }
        if (key === 'f' && event.shiftKey) {
          event.preventDefault();
          flattenSelection();
          return;
        }
        if (key === '=' || key === '+') {
          event.preventDefault();
          setZoom((current) => clampZoom(current * 1.15));
          return;
        }
        if (key === '-' || key === '_') {
          event.preventDefault();
          setZoom((current) => clampZoom(current / 1.15));
          return;
        }
        if (key === '0' || key === '1') {
          event.preventDefault();
          setZoom(1);
          return;
        }
        if (key === ']' && event.shiftKey) {
          event.preventDefault();
          moveSelected('front');
          return;
        }
        if (key === '[' && event.shiftKey) {
          event.preventDefault();
          moveSelected('back');
          return;
        }
        if (key === ']') {
          event.preventDefault();
          moveSelected('forward');
          return;
        }
        if (key === '[') {
          event.preventDefault();
          moveSelected('backward');
          return;
        }
      }

      if (!event.altKey && !hasCommandModifier && !event.shiftKey && TOOL_SHORTCUTS[key]) {
        event.preventDefault();
        setActiveTool(TOOL_SHORTCUTS[key]);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (event.shiftKey) {
          deleteAllObjects();
        } else {
          deleteSelected();
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        if (dragState) {
          setDragState(null);
          return;
        }
        commitDocument((current) => ({ ...current, selectedObjectIds: [] }), 'Deselect');
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        moveSelected('front');
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        moveSelected('back');
        return;
      }
      if (event.key === 'PageUp') {
        event.preventDefault();
        moveSelected('forward');
        return;
      }
      if (event.key === 'PageDown') {
        event.preventDefault();
        moveSelected('backward');
        return;
      }
      if (event.key.startsWith('Arrow')) {
        const amount = event.shiftKey ? 10 : 1;
        const delta = {
          ArrowLeft: [-amount, 0],
          ArrowRight: [amount, 0],
          ArrowUp: [0, -amount],
          ArrowDown: [0, amount],
        }[event.key] as [number, number] | undefined;
        if (delta) {
          event.preventDefault();
          moveSelectedBy(delta[0], delta[1]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    commitDocument,
    deleteAllObjects,
    deleteSelected,
    dragState,
    duplicateSelected,
    flattenSelection,
    handleCopy,
    handleSave,
    handleSaveAs,
    moveSelected,
    moveSelectedBy,
    redo,
    undo,
  ]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const scrollContainer = scrollContainerRef.current;
    const anchorX = canvasRect ? event.clientX - canvasRect.left : 0;
    const anchorY = canvasRect ? event.clientY - canvasRect.top : 0;
    setZoom((current) => {
      const next = clampZoom(current * factor);
      const scale = next / current;
      if (scrollContainer && canvasRect && scale !== 1) {
        requestAnimationFrame(() => {
          scrollContainer.scrollLeft += anchorX * (scale - 1);
          scrollContainer.scrollTop += anchorY * (scale - 1);
        });
      }
      return next;
    });
  }, []);

  const activeOutputDimensions = normalizedDocument
    ? getImageEditOutputDimensions(normalizedDocument.recipe, normalizedDocument.sourceDimensions)
    : null;
  const selectedCount = normalizedDocument?.selectedObjectIds.length || 0;
  const canvasDimensionsForOverlay = normalizedDocument?.canvasDimensions ?? { width: 1, height: 1 };
  const selectedDragOffset = dragState?.tool === 'select' && !dragState.resizeHandle && selectedObject && (dragState.movingObjectIds?.includes(selectedObject.id) || dragState.movingObjectId === selectedObject.id)
    ? {
      x: dragState.current.x - dragState.start.x,
      y: dragState.current.y - dragState.start.y,
    }
    : { x: 0, y: 0 };
  const selectedDisplayBounds = selectedObject && dragState?.tool === 'select' && dragState.resizeHandle && dragState.movingObjectId === selectedObject.id
    ? resizeBoundsFromHandle(
      selectedObject.bounds,
      dragState.resizeHandle,
      dragState.current.x - dragState.start.x,
      dragState.current.y - dragState.start.y,
      canvasDimensionsForOverlay,
      dragState.keepAspectRatio,
    )
    : selectedObject
      ? {
      ...selectedObject.bounds,
      x: selectedObject.bounds.x + selectedDragOffset.x,
      y: selectedObject.bounds.y + selectedDragOffset.y,
      }
      : null;
  const selectedDisplayPoints = selectedObject?.points?.map((point) => ({
    x: point.x + selectedDragOffset.x,
    y: point.y + selectedDragOffset.y,
  }));
  const styleTargetType = selectedObject?.type ?? (isAnnotationTool(activeTool) ? activeTool : null);
  const displayedStyle = selectedObject?.style ?? activeStyle;
  const canUseStrokeColor = Boolean(styleTargetType && ['rectangle', 'ellipse', 'line', 'arrow', 'freehand', 'highlight', 'magnify'].includes(styleTargetType));
  const canUseFillColor = Boolean(styleTargetType && ['rectangle', 'ellipse', 'highlight', 'step'].includes(styleTargetType));
  const canUseTextColor = Boolean(styleTargetType && ['text', 'step'].includes(styleTargetType));
  const canUseStrokeWidth = Boolean(styleTargetType && styleTargetType !== 'text' && styleTargetType !== 'step');
  const canUseFontSize = Boolean(styleTargetType && ['text', 'step'].includes(styleTargetType));
  const displayedObjects = [...(normalizedDocument?.objects ?? [])]
    .sort((first, second) => first.zIndex - second.zIndex)
    .map((object) => {
      const shouldMoveWithSelection = dragState?.tool === 'select' && !dragState.resizeHandle && (dragState.movingObjectIds?.includes(object.id) || dragState.movingObjectId === object.id);
      if (object.id === selectedObject?.id) {
        return {
          ...object,
          bounds: selectedDisplayBounds ?? object.bounds,
          points: selectedDisplayPoints ?? object.points,
        };
      }
      if (shouldMoveWithSelection) {
        return {
          ...object,
          bounds: {
            ...object.bounds,
            x: object.bounds.x + selectedDragOffset.x,
            y: object.bounds.y + selectedDragOffset.y,
          },
          points: object.points?.map((point) => ({
            x: point.x + selectedDragOffset.x,
            y: point.y + selectedDragOffset.y,
          })),
        };
      }
      return object;
    });
  const selectedDisplayedObjects = displayedObjects.filter((object) => normalizedDocument?.selectedObjectIds.includes(object.id));

  if (!normalizedDocument || !sourceUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-950 text-gray-300">
        Opening editor...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-950 text-gray-100">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-800 bg-gray-900 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={handleBack} className="rounded-md p-2 text-gray-300 hover:bg-gray-800" title="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{image.name}</div>
            <div className="text-xs text-gray-500">
              {activeOutputDimensions?.width || normalizedDocument.canvasDimensions.width}x{activeOutputDimensions?.height || normalizedDocument.canvasDimensions.height}
              {hasChanges ? ' · Unsaved edits' : ' · Clean'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={undo} disabled={!history.past.length} className="rounded-md p-2 text-gray-300 hover:bg-gray-800 disabled:opacity-40" title="Undo">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={redo} disabled={!history.future.length} className="rounded-md p-2 text-gray-300 hover:bg-gray-800 disabled:opacity-40" title="Redo">
            <Redo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={flattenSelection} className="rounded-md p-2 text-gray-300 hover:bg-gray-800" title="Flatten">
            <Layers className="h-4 w-4" />
          </button>
          <button type="button" onClick={restoreOriginal} disabled={!hasChanges} className="inline-flex items-center gap-1 rounded-md px-2 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-40" title="Restore Original">
            <RotateCcw className="h-4 w-4" />
            Restore
          </button>
          <button type="button" onClick={handleCopy} className="rounded-md p-2 text-gray-300 hover:bg-gray-800" title="Copy image">
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" onClick={handleSave} disabled={isSaving || !hasChanges} className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:bg-gray-800 disabled:text-gray-500" title={canOverwrite ? 'Save' : 'Save As'}>
            <Save className="h-4 w-4" />
            Save
          </button>
          <button type="button" onClick={handleSaveAs} disabled={isSaving || !hasChanges} className="inline-flex items-center gap-1 rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-40">
            <Download className="h-4 w-4" />
            Save As
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-16 shrink-0 flex-col gap-1 border-r border-gray-800 bg-gray-900 p-2">
          {TOOL_DEFS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => setActiveTool(tool.id)}
              className={`flex h-10 w-10 items-center justify-center rounded-md border text-gray-300 transition-colors ${
                activeTool === tool.id ? 'border-cyan-400/40 bg-cyan-500/20 text-cyan-100' : 'border-transparent hover:bg-gray-800'
              }`}
              title={tool.label}
              aria-label={tool.label}
            >
              {tool.icon}
            </button>
          ))}
        </div>

        <div className="relative flex min-w-0 flex-1 flex-col bg-gray-950">
          <div ref={scrollContainerRef} className="flex flex-1 items-start justify-start overflow-auto p-8">
            <div
              ref={canvasRef}
              data-testid="image-editor-canvas"
              className="relative mx-auto my-auto flex-none touch-none select-none overflow-hidden rounded-sm border border-gray-800 bg-[linear-gradient(45deg,#1f2937_25%,transparent_25%),linear-gradient(-45deg,#1f2937_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1f2937_75%),linear-gradient(-45deg,transparent_75%,#1f2937_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]"
              style={{
                aspectRatio: `${Math.max(1, normalizedDocument.canvasDimensions.width)} / ${Math.max(1, normalizedDocument.canvasDimensions.height)}`,
                width: `${displayWidth}px`,
                maxWidth: 'none',
              }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={() => {
                setDragState(null);
                panStateRef.current = null;
              }}
              onAuxClick={(event) => event.preventDefault()}
              onWheel={handleWheel}
            >
              {previewUrl ? (
                <img ref={previewImageRef} src={previewUrl} alt={image.name} className="block h-full w-full object-contain" draggable={false} />
              ) : (
                <img ref={previewImageRef} src={sourceUrl} alt={image.name} className="block h-full w-full object-contain opacity-80" draggable={false} />
              )}
              <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${normalizedDocument.canvasDimensions.width} ${normalizedDocument.canvasDimensions.height}`} preserveAspectRatio="none">
                {displayedObjects.map((object) => {
                  const { bounds, style } = object;
                  if (object.type === 'rectangle' || object.type === 'highlight') {
                    return (
                      <rect
                        key={object.id}
                        x={bounds.x}
                        y={bounds.y}
                        width={bounds.width}
                        height={bounds.height}
                        fill={object.type === 'highlight' ? 'rgba(250, 204, 21, 0.28)' : style.fillColor}
                        stroke={object.type === 'rectangle' ? style.strokeColor : 'transparent'}
                        strokeWidth={object.type === 'rectangle' ? style.strokeWidth : 0}
                        opacity={style.opacity}
                      />
                    );
                  }
                  if (object.type === 'ellipse' || object.type === 'spotlight' || object.type === 'magnify') {
                    return (
                      <ellipse
                        key={object.id}
                        cx={bounds.x + bounds.width / 2}
                        cy={bounds.y + bounds.height / 2}
                        rx={bounds.width / 2}
                        ry={bounds.height / 2}
                        fill={object.type === 'ellipse' ? style.fillColor : 'rgba(0, 0, 0, 0.18)'}
                        stroke={style.strokeColor}
                        strokeWidth={style.strokeWidth}
                        opacity={style.opacity}
                        strokeDasharray={object.type === 'spotlight' || object.type === 'magnify' ? '10 8' : undefined}
                      />
                    );
                  }
                  if (object.type === 'line' || object.type === 'arrow') {
                    const start = object.points?.[0] ?? { x: bounds.x, y: bounds.y };
                    const end = object.points?.[1] ?? { x: bounds.x + bounds.width, y: bounds.y + bounds.height };
                    return (
                      <g key={object.id} opacity={style.opacity}>
                        <line
                          x1={start.x}
                          y1={start.y}
                          x2={end.x}
                          y2={end.y}
                          stroke={style.strokeColor}
                          strokeWidth={style.strokeWidth}
                          strokeLinecap="round"
                          markerEnd={object.type === 'arrow' ? `url(#image-editor-arrow-${object.id})` : undefined}
                        />
                        {object.type === 'arrow' && (
                          <defs>
                            <marker id={`image-editor-arrow-${object.id}`} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                              <path d="M 0 0 L 10 5 L 0 10 z" fill={style.strokeColor} />
                            </marker>
                          </defs>
                        )}
                      </g>
                    );
                  }
                  if (object.type === 'freehand' && object.points && object.points.length > 1) {
                    return (
                      <polyline
                        key={object.id}
                        points={object.points.map((point) => `${point.x},${point.y}`).join(' ')}
                        fill="none"
                        stroke={style.strokeColor}
                        strokeWidth={style.strokeWidth}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={style.opacity}
                      />
                    );
                  }
                  if (object.type === 'text') {
                    return (
                      <text
                        key={object.id}
                        x={bounds.x}
                        y={bounds.y + style.fontSize}
                        fill={style.textColor}
                        fontSize={style.fontSize}
                        fontFamily="system-ui, sans-serif"
                        opacity={style.opacity}
                      >
                        {object.text || 'Text'}
                      </text>
                    );
                  }
                  if (object.type === 'step') {
                    const radius = Math.max(16, Math.min(bounds.width, bounds.height) / 2);
                    return (
                      <g key={object.id} opacity={style.opacity}>
                        <circle cx={bounds.x + radius} cy={bounds.y + radius} r={radius} fill={style.strokeColor} />
                        <text
                          x={bounds.x + radius}
                          y={bounds.y + radius + 1}
                          fill={style.textColor}
                          fontSize={Math.round(radius)}
                          fontWeight={700}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontFamily="system-ui, sans-serif"
                        >
                          {object.stepNumber || 1}
                        </text>
                      </g>
                    );
                  }
                  if (object.type === 'blur' || object.type === 'pixelate') {
                    return (
                      <rect
                        key={object.id}
                        x={bounds.x}
                        y={bounds.y}
                        width={bounds.width}
                        height={bounds.height}
                        fill="rgba(103, 232, 249, 0.08)"
                        stroke={style.strokeColor}
                        strokeWidth={Math.max(2, style.strokeWidth / 2)}
                        strokeDasharray="10 8"
                        opacity={style.opacity}
                      />
                    );
                  }
                  return null;
                })}
              </svg>
              {dragState && (dragState.tool === 'line' || dragState.tool === 'arrow') ? (
                <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${normalizedDocument.canvasDimensions.width} ${normalizedDocument.canvasDimensions.height}`} preserveAspectRatio="none">
                  <line
                    x1={dragState.start.x}
                    y1={dragState.start.y}
                    x2={dragState.current.x}
                    y2={dragState.current.y}
                    stroke={activeStyle.strokeColor}
                    strokeWidth={activeStyle.strokeWidth}
                    strokeLinecap="round"
                    markerEnd={dragState.tool === 'arrow' ? 'url(#image-editor-arrow-preview)' : undefined}
                  />
                  <defs>
                    <marker id="image-editor-arrow-preview" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill={activeStyle.strokeColor} />
                    </marker>
                  </defs>
                </svg>
              ) : dragState?.tool === 'freehand' && dragState.points?.length ? (
                <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${normalizedDocument.canvasDimensions.width} ${normalizedDocument.canvasDimensions.height}`} preserveAspectRatio="none">
                  <polyline
                    points={dragState.points.map((point) => `${point.x},${point.y}`).join(' ')}
                    fill="none"
                    stroke={activeStyle.strokeColor}
                    strokeWidth={activeStyle.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : dragState && !(dragState.tool === 'select' && (dragState.movingObjectId || dragState.resizeHandle)) && (
                <div
                  className="pointer-events-none absolute border-2 border-cyan-300 bg-cyan-300/10"
                  style={{
                    left: `${(Math.min(dragState.start.x, dragState.current.x) / normalizedDocument.canvasDimensions.width) * 100}%`,
                    top: `${(Math.min(dragState.start.y, dragState.current.y) / normalizedDocument.canvasDimensions.height) * 100}%`,
                    width: `${(Math.abs(dragState.current.x - dragState.start.x) / normalizedDocument.canvasDimensions.width) * 100}%`,
                    height: `${(Math.abs(dragState.current.y - dragState.start.y) / normalizedDocument.canvasDimensions.height) * 100}%`,
                  }}
                />
              )}
              {selectedDisplayedObjects.map((object) => {
                if ((object.type === 'line' || object.type === 'arrow') && object.points?.[0] && object.points?.[1]) {
                  return (
                    <svg key={`selection-${object.id}`} className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${normalizedDocument.canvasDimensions.width} ${normalizedDocument.canvasDimensions.height}`} preserveAspectRatio="none">
                      <line
                        x1={object.points[0].x}
                        y1={object.points[0].y}
                        x2={object.points[1].x}
                        y2={object.points[1].y}
                        stroke="rgb(103 232 249)"
                        strokeWidth="2"
                        strokeDasharray="6 5"
                        strokeLinecap="round"
                      />
                    </svg>
                  );
                }

                return (
                  <div
                    key={`selection-${object.id}`}
                    className="pointer-events-none absolute border-2 border-cyan-300 bg-cyan-300/5"
                    style={{
                      left: `${(object.bounds.x / normalizedDocument.canvasDimensions.width) * 100}%`,
                      top: `${(object.bounds.y / normalizedDocument.canvasDimensions.height) * 100}%`,
                      width: `${(object.bounds.width / normalizedDocument.canvasDimensions.width) * 100}%`,
                      height: `${(object.bounds.height / normalizedDocument.canvasDimensions.height) * 100}%`,
                    }}
                  />
                );
              })}
              {selectedDisplayBounds && selectedObject && isResizableObjectType(selectedObject.type) && (
                <>
                  {RESIZE_HANDLES.map((handle) => {
                    const point = getHandlePoint(selectedDisplayBounds, handle);
                    return (
                      <div
                        key={handle}
                        className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-950 bg-cyan-300 shadow-sm shadow-black/50"
                        style={{
                          left: `${(point.x / normalizedDocument.canvasDimensions.width) * 100}%`,
                          top: `${(point.y / normalizedDocument.canvasDimensions.height) * 100}%`,
                        }}
                      />
                    );
                  })}
                </>
              )}
            </div>
          </div>
          <div className="flex h-9 shrink-0 items-center justify-between border-t border-gray-800 bg-gray-900 px-4 text-xs text-gray-400">
            <span>{TOOL_HINTS[activeTool]}</span>
            <span>{isRendering ? 'Rendering preview...' : `${Math.round(zoom * 100)}% · ${normalizedDocument.objects.length} objects · ${selectedCount} selected`}</span>
          </div>
        </div>

        <aside className="w-80 shrink-0 overflow-y-auto border-l border-gray-800 bg-gray-900 p-4">
          <div className="space-y-5">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-100">Tool</h3>
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3 text-sm">
                <div className="font-medium text-cyan-100">{TOOL_DEFS.find((tool) => tool.id === activeTool)?.label}</div>
                <p className="mt-1 text-xs text-gray-500">{TOOL_HINTS[activeTool]}</p>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-100">Local Edits</h3>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => updateRecipe({ ...normalizedDocument.recipe, transform: { ...normalizedDocument.recipe.transform, rotation: ((normalizedDocument.recipe.transform.rotation + 270) % 360) as 0 | 90 | 180 | 270 } })} className="inline-flex items-center justify-center gap-1 rounded-md border border-gray-700 px-2 py-2 text-xs hover:bg-gray-800">
                  <RotateCcw className="h-3.5 w-3.5" /> Left
                </button>
                <button type="button" onClick={() => updateRecipe({ ...normalizedDocument.recipe, transform: { ...normalizedDocument.recipe.transform, rotation: ((normalizedDocument.recipe.transform.rotation + 90) % 360) as 0 | 90 | 180 | 270 } })} className="inline-flex items-center justify-center gap-1 rounded-md border border-gray-700 px-2 py-2 text-xs hover:bg-gray-800">
                  <RotateCw className="h-3.5 w-3.5" /> Right
                </button>
                <button type="button" onClick={() => updateRecipe({ ...normalizedDocument.recipe, transform: { ...normalizedDocument.recipe.transform, flipHorizontal: !normalizedDocument.recipe.transform.flipHorizontal } })} className="inline-flex items-center justify-center gap-1 rounded-md border border-gray-700 px-2 py-2 text-xs hover:bg-gray-800">
                  <FlipHorizontal className="h-3.5 w-3.5" /> Flip H
                </button>
                <button type="button" onClick={() => updateRecipe({ ...normalizedDocument.recipe, transform: { ...normalizedDocument.recipe.transform, flipVertical: !normalizedDocument.recipe.transform.flipVertical } })} className="inline-flex items-center justify-center gap-1 rounded-md border border-gray-700 px-2 py-2 text-xs hover:bg-gray-800">
                  <FlipVertical className="h-3.5 w-3.5" /> Flip V
                </button>
              </div>
              {(['brightness', 'contrast', 'saturation'] as const).map((key) => (
                <label key={key} className="block space-y-1 text-xs text-gray-400">
                  <span className="capitalize">{key}</span>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    value={normalizedDocument.recipe.adjustments[key]}
                    onChange={(event) => updateRecipe({
                      ...normalizedDocument.recipe,
                      adjustments: {
                        ...normalizedDocument.recipe.adjustments,
                        [key]: clampImageAdjustment(key, Number(event.target.value)),
                      },
                    })}
                    className="w-full accent-cyan-500"
                  />
                </label>
              ))}
              <div className="grid grid-cols-2 gap-2">
                {(['sharpen', 'blur'] as const).map((key) => (
                  <label key={key} className="space-y-1 text-xs text-gray-400">
                    <span className="capitalize">{key}</span>
                    <input
                      type="number"
                      value={normalizedDocument.recipe.effects[key]}
                      min={0}
                      max={key === 'blur' ? 20 : 100}
                      onChange={(event) => updateRecipe({
                        ...normalizedDocument.recipe,
                        effects: {
                          ...normalizedDocument.recipe.effects,
                          [key]: clampImageEditEffect(key, Number(event.target.value)),
                        },
                      })}
                      className="h-8 w-full rounded-md border border-gray-700 bg-gray-950 px-2 text-right text-xs text-gray-100"
                    />
                  </label>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-100">{selectedObject ? 'Selected Object' : 'Tool Style'}</h3>
              {styleTargetType ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {canUseStrokeColor && (
                      <label className="space-y-1 text-xs text-gray-400">
                        <span>Stroke</span>
                        <input
                          type="color"
                          value={displayedStyle.strokeColor}
                          onChange={(event) => {
                            setActiveStyle({ ...activeStyle, strokeColor: event.target.value });
                            updateSelectedObjectStyle({ strokeColor: event.target.value });
                          }}
                          className="h-8 w-full rounded border border-gray-700 bg-gray-950"
                        />
                      </label>
                    )}
                    {canUseFillColor && (
                      <label className="space-y-1 text-xs text-gray-400">
                        <span>Fill</span>
                        <input
                          type="color"
                          value={toColorInputValue(displayedStyle.fillColor)}
                          onChange={(event) => {
                            setActiveStyle({ ...activeStyle, fillColor: event.target.value });
                            updateSelectedObjectStyle({ fillColor: event.target.value });
                          }}
                          className="h-8 w-full rounded border border-gray-700 bg-gray-950"
                        />
                      </label>
                    )}
                    {canUseTextColor && (
                      <label className="space-y-1 text-xs text-gray-400">
                        <span>Text</span>
                        <input
                          type="color"
                          value={displayedStyle.textColor}
                          onChange={(event) => {
                            setActiveStyle({ ...activeStyle, textColor: event.target.value });
                            updateSelectedObjectStyle({ textColor: event.target.value });
                          }}
                          className="h-8 w-full rounded border border-gray-700 bg-gray-950"
                        />
                      </label>
                    )}
                    {canUseStrokeWidth && (
                      <label className="space-y-1 text-xs text-gray-400">
                        <span>{styleTargetType === 'blur' || styleTargetType === 'pixelate' ? 'Strength' : 'Width'}</span>
                        <input
                          type="number"
                          value={displayedStyle.strokeWidth}
                          min={1}
                          max={80}
                          onChange={(event) => {
                            const value = clamp(Math.round(Number(event.target.value) || 1), 1, 80);
                            setActiveStyle({ ...activeStyle, strokeWidth: value });
                            updateSelectedObjectStyle({ strokeWidth: value });
                          }}
                          className="h-8 w-full rounded-md border border-gray-700 bg-gray-950 px-2 text-right text-xs text-gray-100"
                        />
                      </label>
                    )}
                    {canUseFontSize && (
                      <label className="space-y-1 text-xs text-gray-400">
                        <span>Font</span>
                        <input
                          type="number"
                          value={displayedStyle.fontSize}
                          min={8}
                          max={240}
                          onChange={(event) => {
                            const value = clamp(Math.round(Number(event.target.value) || 32), 8, 240);
                            setActiveStyle({ ...activeStyle, fontSize: value });
                            updateSelectedObjectStyle({ fontSize: value });
                          }}
                          className="h-8 w-full rounded-md border border-gray-700 bg-gray-950 px-2 text-right text-xs text-gray-100"
                        />
                      </label>
                    )}
                  </div>
                  {selectedObject && (
                    <>
                      <div className="grid grid-cols-4 gap-1">
                        <button type="button" onClick={() => moveSelected('front')} className="rounded border border-gray-700 px-1 py-1 text-xs hover:bg-gray-800">Front</button>
                        <button type="button" onClick={() => moveSelected('forward')} className="rounded border border-gray-700 px-1 py-1 text-xs hover:bg-gray-800">Up</button>
                        <button type="button" onClick={() => moveSelected('backward')} className="rounded border border-gray-700 px-1 py-1 text-xs hover:bg-gray-800">Down</button>
                        <button type="button" onClick={() => moveSelected('back')} className="rounded border border-gray-700 px-1 py-1 text-xs hover:bg-gray-800">Back</button>
                      </div>
                      <button type="button" onClick={deleteSelected} className="w-full rounded-md border border-red-500/30 bg-red-500/10 px-2 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/20">
                        Delete Selected
                      </button>
                    </>
                  )}
                </>
              ) : (
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3 text-xs text-gray-500">
                  Pick an annotation tool or select an object to edit its style.
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-100">Background</h3>
              <select value={normalizedDocument.background.kind} onChange={(event) => updateBackground({ kind: event.target.value as ImageEditorDocument['background']['kind'] })} className="h-9 w-full rounded-md border border-gray-700 bg-gray-950 px-2 text-sm">
                <option value="transparent">Transparent</option>
                <option value="color">Color</option>
                <option value="gradient">Gradient</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs text-gray-400">
                  <span>Color</span>
                  <input type="color" value={normalizedDocument.background.color} onChange={(event) => updateBackground({ color: event.target.value })} className="h-8 w-full rounded border border-gray-700 bg-gray-950" />
                </label>
                <label className="space-y-1 text-xs text-gray-400">
                  <span>Shadow</span>
                  <input type="number" value={normalizedDocument.background.shadowRadius} min={0} max={500} onChange={(event) => updateBackground({ shadowRadius: Number(event.target.value) })} className="h-8 w-full rounded-md border border-gray-700 bg-gray-950 px-2 text-right text-xs text-gray-100" />
                </label>
                <label className="space-y-1 text-xs text-gray-400">
                  <span>Margin</span>
                  <input type="number" value={normalizedDocument.background.margin} min={0} max={2000} onChange={(event) => updateBackground({ margin: Number(event.target.value) })} className="h-8 w-full rounded-md border border-gray-700 bg-gray-950 px-2 text-right text-xs text-gray-100" />
                </label>
                <label className="space-y-1 text-xs text-gray-400">
                  <span>Padding</span>
                  <input type="number" value={normalizedDocument.background.padding} min={0} max={2000} onChange={(event) => updateBackground({ padding: Number(event.target.value) })} className="h-8 w-full rounded-md border border-gray-700 bg-gray-950 px-2 text-right text-xs text-gray-100" />
                </label>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-gray-300">
                <input type="checkbox" checked={normalizedDocument.background.smartPadding} onChange={(event) => updateBackground({ smartPadding: event.target.checked })} className="h-4 w-4 accent-cyan-500" />
                Smart padding
              </label>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-100">AI Transform</h3>
              <button type="button" onClick={handleAIUpscale} disabled={isUpscaling} className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-purple-400/30 bg-purple-500/15 px-3 py-2 text-xs font-semibold text-purple-100 hover:bg-purple-500/25 disabled:opacity-50">
                <Sparkles className="h-4 w-4" />
                {isUpscaling ? 'Queueing...' : 'AI Upscale'}
              </button>
              <div className="grid grid-cols-2 gap-1 text-xs">
                {['Detail Restore', 'Face Restore', 'Img2Img', 'Inpaint', 'Outpaint'].map((label) => (
                  <button key={label} type="button" disabled className="rounded-md border border-gray-800 px-2 py-1.5 text-gray-600">
                    {label}
                  </button>
                ))}
              </div>
              {onOpenComfyUIWorkflow && (
                <button type="button" onClick={() => onOpenComfyUIWorkflow(image)} className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 hover:bg-gray-800">
                  <Workflow className="h-4 w-4" />
                  Open Workflow
                </button>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-100">Source</h3>
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3 text-xs text-gray-400">
                <div className="flex items-center gap-2 text-gray-200">
                  <ImageIcon className="h-4 w-4 text-cyan-300" />
                  <span className="truncate">{image.name}</span>
                </div>
                <div className="mt-2">{normalizedDocument.sourceDimensions.width}x{normalizedDocument.sourceDimensions.height}</div>
                {navigationImages.length > 1 && <div>{navigationImages.length} images in navigation scope</div>}
              </div>
            </section>

            <button type="button" onClick={restoreOriginal} disabled={!hasChanges} className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-40">
              <RotateCcw className="h-4 w-4" />
              Restore Original
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default ImageEditorWorkspace;

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
  Pencil,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Search,
  Shield,
  Sparkles,
  Square,
  Type,
  Undo2,
  Workflow,
  ZoomIn,
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
  DEFAULT_IMAGE_EDIT_RECIPE,
  DEFAULT_IMAGE_EDITOR_BACKGROUND,
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

type DragState = {
  tool: ImageEditorTool;
  start: { x: number; y: number };
  current: { x: number; y: number };
  points?: { x: number; y: number }[];
};

const TOOL_DEFS: Array<{ id: ImageEditorTool; label: string; icon: React.ReactNode }> = [
  { id: 'select', label: 'Select', icon: <MousePointer2 className="h-4 w-4" /> },
  { id: 'crop', label: 'Crop', icon: <Crop className="h-4 w-4" /> },
  { id: 'rectangle', label: 'Rectangle', icon: <Square className="h-4 w-4" /> },
  { id: 'ellipse', label: 'Ellipse', icon: <Circle className="h-4 w-4" /> },
  { id: 'line', label: 'Line', icon: <Minus className="h-4 w-4" /> },
  { id: 'arrow', label: 'Arrow', icon: <ArrowLeft className="h-4 w-4 rotate-180" /> },
  { id: 'freehand', label: 'Freehand', icon: <Pencil className="h-4 w-4" /> },
  { id: 'text', label: 'Text', icon: <Type className="h-4 w-4" /> },
  { id: 'step', label: 'Step', icon: <span className="text-xs font-bold">1</span> },
  { id: 'highlight', label: 'Highlight', icon: <Highlighter className="h-4 w-4" /> },
  { id: 'blur', label: 'Blur', icon: <Eye className="h-4 w-4" /> },
  { id: 'pixelate', label: 'Pixelate', icon: <Shield className="h-4 w-4" /> },
  { id: 'spotlight', label: 'Spotlight', icon: <Search className="h-4 w-4" /> },
  { id: 'magnify', label: 'Magnify', icon: <ZoomIn className="h-4 w-4" /> },
];

const TOOL_HINTS: Record<ImageEditorTool, string> = {
  select: 'Click an object to select it.',
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

const cloneDocument = (document: ImageEditorDocument): ImageEditorDocument => JSON.parse(JSON.stringify(document));

const createObjectId = () => `editor_obj_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

const isEditableShortcutTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
};

const isAnnotationTool = (tool: ImageEditorTool): tool is ImageEditorObject['type'] => (
  tool !== 'select' && tool !== 'crop'
);

const TOOL_SHORTCUTS: Partial<Record<string, ImageEditorTool>> = {
  v: 'select',
  c: 'crop',
  r: 'rectangle',
  e: 'ellipse',
  l: 'line',
  a: 'arrow',
  f: 'freehand',
  t: 'text',
  n: 'step',
  h: 'highlight',
  b: 'blur',
  p: 'pixelate',
  s: 'spotlight',
  m: 'magnify',
};

const getUsableNormalizedMetadata = (image: IndexedImage): BaseMetadata | undefined => (
  image.metadata?.normalizedMetadata as BaseMetadata | undefined
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

  const x = Math.min(drag.start.x, drag.current.x);
  const y = Math.min(drag.start.y, drag.current.y);
  const width = Math.max(1, Math.abs(drag.current.x - drag.start.x));
  const height = Math.max(1, Math.abs(drag.current.y - drag.start.y));
  const isPointTool = tool === 'text' || tool === 'step';
  const resolvedBounds = isPointTool
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
  const hasChanges = normalizedDocument ? hasImageEditorDocumentChanges(normalizedDocument) : false;
  const selectedObject = normalizedDocument?.objects.find((object) => normalizedDocument.selectedObjectIds.includes(object.id)) || null;
  const canOverwrite = getFileExtension(image.name) === '.png';
  const displayWidth = Math.max(160, Math.round(1080 * zoom));

  const commitDocument = useCallback((updater: (current: ImageEditorDocument) => ImageEditorDocument, label: string) => {
    setDocumentState((current) => {
      if (!current) {
        return current;
      }
      const before = cloneDocument(current);
      const after = normalizeImageEditorDocument(updater(before));
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
        setDocumentState(createImageEditorDocument({
          imageId: image.id,
          name: image.name,
          width: dimensions.width,
          height: dimensions.height,
        }));
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
    };
  }, [directoryPath, image, setError]);

  useEffect(() => () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  }, [previewUrl]);

  useEffect(() => {
    if (!sourceUrl || !normalizedDocument || !sourceReady) {
      return;
    }
    let canceled = false;
    setIsRendering(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const blob = await renderImageEditorDocumentToPngBlob(sourceUrl, normalizedDocument);
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
  }, [normalizedDocument, sourceReady, sourceUrl]);

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

  const resetDocument = useCallback(() => {
    if (!normalizedDocument) return;
    commitDocument(() => createImageEditorDocument({
      imageId: image.id,
      name: image.name,
      width: normalizedDocument.sourceDimensions.width,
      height: normalizedDocument.sourceDimensions.height,
    }), 'Reset');
  }, [commitDocument, image, normalizedDocument]);

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

  const pointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!normalizedDocument || event.button !== 0) return;
    const point = getCanvasPoint(event, canvasRef.current, normalizedDocument);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (activeTool === 'select') {
      const selected = [...normalizedDocument.objects]
        .reverse()
        .find((object) => point.x >= object.bounds.x && point.x <= object.bounds.x + object.bounds.width && point.y >= object.bounds.y && point.y <= object.bounds.y + object.bounds.height);
      commitDocument((current) => ({ ...current, selectedObjectIds: selected ? [selected.id] : [] }), 'Select');
      return;
    }

    setDragState({
      tool: activeTool,
      start: point,
      current: point,
      points: activeTool === 'freehand' ? [point] : undefined,
    });
  }, [activeTool, commitDocument, normalizedDocument]);

  const pointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState || !normalizedDocument) return;
    const point = getCanvasPoint(event, canvasRef.current, normalizedDocument);
    setDragState((current) => current ? {
      ...current,
      current: point,
      points: current.points ? [...current.points, point] : undefined,
    } : current);
  }, [dragState, normalizedDocument]);

  const pointerUp = useCallback(() => {
    if (!dragState || !normalizedDocument) return;
    const completedDrag = dragState;
    setDragState(null);

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
    setZoom((current) => clampZoom(current * factor));
  }, []);

  const activeOutputDimensions = normalizedDocument
    ? getImageEditOutputDimensions(normalizedDocument.recipe, normalizedDocument.sourceDimensions)
    : null;
  const selectedCount = normalizedDocument?.selectedObjectIds.length || 0;

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
          <div className="flex flex-1 items-center justify-center overflow-auto p-8">
            <div
              ref={canvasRef}
              data-testid="image-editor-canvas"
              className="relative max-h-full max-w-full touch-none select-none overflow-hidden rounded-sm border border-gray-800 bg-[linear-gradient(45deg,#1f2937_25%,transparent_25%),linear-gradient(-45deg,#1f2937_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1f2937_75%),linear-gradient(-45deg,transparent_75%,#1f2937_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]"
              style={{
                aspectRatio: `${Math.max(1, normalizedDocument.canvasDimensions.width)} / ${Math.max(1, normalizedDocument.canvasDimensions.height)}`,
                width: `${displayWidth}px`,
              }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={() => setDragState(null)}
              onWheel={handleWheel}
            >
              {previewUrl ? (
                <img src={previewUrl} alt={image.name} className="block h-full w-full object-contain" draggable={false} />
              ) : (
                <img src={sourceUrl} alt={image.name} className="block h-full w-full object-contain opacity-80" draggable={false} />
              )}
              {dragState && (dragState.tool === 'line' || dragState.tool === 'arrow') ? (
                <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                  <line
                    x1={`${(dragState.start.x / normalizedDocument.canvasDimensions.width) * 100}%`}
                    y1={`${(dragState.start.y / normalizedDocument.canvasDimensions.height) * 100}%`}
                    x2={`${(dragState.current.x / normalizedDocument.canvasDimensions.width) * 100}%`}
                    y2={`${(dragState.current.y / normalizedDocument.canvasDimensions.height) * 100}%`}
                    stroke="rgb(103 232 249)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    markerEnd={dragState.tool === 'arrow' ? 'url(#image-editor-arrow-preview)' : undefined}
                  />
                  <defs>
                    <marker id="image-editor-arrow-preview" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(103 232 249)" />
                    </marker>
                  </defs>
                </svg>
              ) : dragState && (
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
              {selectedObject && (selectedObject.type === 'line' || selectedObject.type === 'arrow') && selectedObject.points?.[0] && selectedObject.points?.[1] ? (
                <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                  <line
                    x1={`${(selectedObject.points[0].x / normalizedDocument.canvasDimensions.width) * 100}%`}
                    y1={`${(selectedObject.points[0].y / normalizedDocument.canvasDimensions.height) * 100}%`}
                    x2={`${(selectedObject.points[1].x / normalizedDocument.canvasDimensions.width) * 100}%`}
                    y2={`${(selectedObject.points[1].y / normalizedDocument.canvasDimensions.height) * 100}%`}
                    stroke="rgb(103 232 249)"
                    strokeWidth="2"
                    strokeDasharray="6 5"
                    strokeLinecap="round"
                  />
                </svg>
              ) : selectedObject && (
                <div
                  className="pointer-events-none absolute border-2 border-cyan-300"
                  style={{
                    left: `${(selectedObject.bounds.x / normalizedDocument.canvasDimensions.width) * 100}%`,
                    top: `${(selectedObject.bounds.y / normalizedDocument.canvasDimensions.height) * 100}%`,
                    width: `${(selectedObject.bounds.width / normalizedDocument.canvasDimensions.width) * 100}%`,
                    height: `${(selectedObject.bounds.height / normalizedDocument.canvasDimensions.height) * 100}%`,
                  }}
                />
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
              <h3 className="text-sm font-semibold text-gray-100">Object Style</h3>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs text-gray-400">
                  <span>Stroke</span>
                  <input type="color" value={activeStyle.strokeColor} onChange={(event) => { setActiveStyle({ ...activeStyle, strokeColor: event.target.value }); updateSelectedObjectStyle({ strokeColor: event.target.value }); }} className="h-8 w-full rounded border border-gray-700 bg-gray-950" />
                </label>
                <label className="space-y-1 text-xs text-gray-400">
                  <span>Text</span>
                  <input type="color" value={activeStyle.textColor} onChange={(event) => { setActiveStyle({ ...activeStyle, textColor: event.target.value }); updateSelectedObjectStyle({ textColor: event.target.value }); }} className="h-8 w-full rounded border border-gray-700 bg-gray-950" />
                </label>
                <label className="space-y-1 text-xs text-gray-400">
                  <span>Width</span>
                  <input type="number" value={activeStyle.strokeWidth} min={1} max={80} onChange={(event) => { const value = clamp(Math.round(Number(event.target.value) || 1), 1, 80); setActiveStyle({ ...activeStyle, strokeWidth: value }); updateSelectedObjectStyle({ strokeWidth: value }); }} className="h-8 w-full rounded-md border border-gray-700 bg-gray-950 px-2 text-right text-xs text-gray-100" />
                </label>
                <label className="space-y-1 text-xs text-gray-400">
                  <span>Font</span>
                  <input type="number" value={activeStyle.fontSize} min={8} max={240} onChange={(event) => { const value = clamp(Math.round(Number(event.target.value) || 32), 8, 240); setActiveStyle({ ...activeStyle, fontSize: value }); updateSelectedObjectStyle({ fontSize: value }); }} className="h-8 w-full rounded-md border border-gray-700 bg-gray-950 px-2 text-right text-xs text-gray-100" />
                </label>
              </div>
              <div className="grid grid-cols-4 gap-1">
                <button type="button" onClick={() => moveSelected('front')} disabled={!selectedObject} className="rounded border border-gray-700 px-1 py-1 text-xs hover:bg-gray-800 disabled:opacity-40">Front</button>
                <button type="button" onClick={() => moveSelected('forward')} disabled={!selectedObject} className="rounded border border-gray-700 px-1 py-1 text-xs hover:bg-gray-800 disabled:opacity-40">Up</button>
                <button type="button" onClick={() => moveSelected('backward')} disabled={!selectedObject} className="rounded border border-gray-700 px-1 py-1 text-xs hover:bg-gray-800 disabled:opacity-40">Down</button>
                <button type="button" onClick={() => moveSelected('back')} disabled={!selectedObject} className="rounded border border-gray-700 px-1 py-1 text-xs hover:bg-gray-800 disabled:opacity-40">Back</button>
              </div>
              <button type="button" onClick={deleteSelected} disabled={!selectedObject} className="w-full rounded-md border border-red-500/30 bg-red-500/10 px-2 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-40">
                Delete Selected
              </button>
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

            <button type="button" onClick={resetDocument} disabled={!hasChanges} className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-40">
              <Scissors className="h-4 w-4" />
              Reset Editor
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default ImageEditorWorkspace;

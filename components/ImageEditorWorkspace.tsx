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
  Shield,
  Square,
  Type,
  Undo2,
  Workflow,
  X,
} from 'lucide-react';
import type {
  BaseMetadata,
  ImageEditCropAspect,
  ImageEditorDocument,
  ImageEditorObject,
  ImageEditorObjectStyle,
  ImageEditorTool,
  IndexedImage,
} from '../types';
import {
  CROP_ASPECTS,
  DEFAULT_IMAGE_EDITOR_OBJECT_STYLE,
  clampImageAdjustment,
  clampImageEditCropRect,
  clampImageEditEffect,
  createDefaultCropRect,
  createImageEditorDocument,
  embedMetaHubMetadataInPngBytes,
  getImageEditOutputDimensions,
  getRecipeBaseOutputDimensions,
  hasImageEditorDocumentChanges,
  normalizeImageEditRotation,
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

type InspectorTab = 'edit' | 'style' | 'ai';

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
];

const readPngDimensions = (bytes: Uint8Array): { width: number; height: number } | null => {
  const isPng = bytes.byteLength >= 24
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[12] === 0x49
    && bytes[13] === 0x48
    && bytes[14] === 0x44
    && bytes[15] === 0x52;
  if (!isPng) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset + 16, 8);
  const width = view.getUint32(0, false);
  const height = view.getUint32(4, false);
  return width > 0 && height > 0 ? { width, height } : null;
};

const INSPECTOR_TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'edit', label: 'Edit' },
  { id: 'style', label: 'Style' },
  { id: 'ai', label: 'AI' },
];

const ASPECT_LABELS: Record<ImageEditCropAspect, string> = {
  free: 'Free',
  original: 'Original',
  '1:1': '1:1',
  '4:3': '4:3',
  '3:2': '3:2',
  '16:9': '16:9',
  '9:16': '9:16',
};

const FONT_FAMILY_OPTIONS = [
  { label: 'System', value: 'system-ui, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times', value: '"Times New Roman", serif' },
  { label: 'Courier', value: '"Courier New", monospace' },
  { label: 'Impact', value: 'Impact, sans-serif' },
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
  spotlight: 'Spotlight annotations can be edited when opening older documents.',
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
};

const parseDimensions = (value?: string): { width: number; height: number } => {
  const match = String(value || '').match(/(\d+)\s*x\s*(\d+)/i);
  return {
    width: match ? Number(match[1]) : 0,
    height: match ? Number(match[2]) : 0,
  };
};

const getUsableNormalizedMetadata = (image: IndexedImage): BaseMetadata | undefined => {
  const normalized = image.metadata?.normalizedMetadata as BaseMetadata | undefined;
  if (normalized) {
    return normalized;
  }

  const hasFlattenedMetadata = Boolean(
    image.prompt ||
    image.negativePrompt ||
    image.models?.length ||
    image.loras?.length ||
    image.sampler ||
    image.scheduler ||
    image.seed !== undefined ||
    image.steps !== undefined ||
    image.cfgScale !== undefined ||
    image.dimensions
  );

  if (!hasFlattenedMetadata) {
    return undefined;
  }

  const dimensions = parseDimensions(image.dimensions);
  const model = image.models?.[0] || '';
  return {
    prompt: image.prompt || '',
    negativePrompt: image.negativePrompt || '',
    model,
    models: image.models || [],
    loras: image.loras || [],
    sampler: image.sampler || '',
    scheduler: image.scheduler || '',
    seed: image.seed,
    steps: image.steps || 0,
    cfgScale: image.cfgScale,
    cfg_scale: image.cfgScale,
    width: dimensions.width,
    height: dimensions.height,
    dimensions: image.dimensions || `${dimensions.width}x${dimensions.height}`,
  };
};

const scheduleEditedImageCacheUpsert = (
  directory: { path: string; name: string },
  image: IndexedImage,
  scanSubfolders: boolean,
) => {
  window.setTimeout(() => {
    const cacheModes = Array.from(new Set([scanSubfolders, !scanSubfolders]));
    Promise.all(
      cacheModes.map((scanSubfoldersMode) =>
        cacheManager.applyChunkedCacheDelta(
          directory.path,
          directory.name,
          [image],
          [],
          [],
          scanSubfoldersMode,
        )
      )
    ).catch((error) => {
      console.error('Failed to update cache after editor image save:', error);
    });
  }, 0);
};

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

  const text = tool === 'text' ? 'Text' : undefined;
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
  event: { clientX: number; clientY: number },
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
const isTransparentColor = (value: string | undefined) => {
  const normalized = String(value || '').replace(/\s+/g, '').toLowerCase();
  return normalized === 'transparent' || normalized === 'rgba(0,0,0,0)' || normalized === '#00000000';
};
const toCanvasPercentBounds = (bounds: ImageEditorObject['bounds'], dimensions: { width: number; height: number }) => ({
  left: `${(bounds.x / dimensions.width) * 100}%`,
  top: `${(bounds.y / dimensions.height) * 100}%`,
  width: `${(bounds.width / dimensions.width) * 100}%`,
  height: `${(bounds.height / dimensions.height) * 100}%`,
});

const areDimensionsEqual = (
  first: { width: number; height: number },
  second: { width: number; height: number },
) => first.width === second.width && first.height === second.height;

const remapObjectToCanvasDimensions = (
  object: ImageEditorObject,
  from: { width: number; height: number },
  to: { width: number; height: number },
): ImageEditorObject => {
  const scaleX = to.width / Math.max(1, from.width);
  const scaleY = to.height / Math.max(1, from.height);
  const bounds = {
    x: clamp(object.bounds.x * scaleX, 0, Math.max(0, to.width - 1)),
    y: clamp(object.bounds.y * scaleY, 0, Math.max(0, to.height - 1)),
    width: clamp(object.bounds.width * scaleX, 1, to.width),
    height: clamp(object.bounds.height * scaleY, 1, to.height),
  };
  bounds.width = clamp(bounds.width, 1, Math.max(1, to.width - bounds.x));
  bounds.height = clamp(bounds.height, 1, Math.max(1, to.height - bounds.y));

  return {
    ...object,
    bounds,
    points: object.points?.map((point) => ({
      x: clamp(point.x * scaleX, 0, to.width),
      y: clamp(point.y * scaleY, 0, to.height),
    })),
  };
};

const getEditorCursor = (tool: ImageEditorTool, isPanning: boolean) => {
  if (isPanning) return 'grabbing';
  switch (tool) {
    case 'select': return 'default';
    case 'color-picker': return 'crosshair';
    case 'crop': return 'crosshair';
    case 'text': return 'text';
    case 'freehand': return 'crosshair';
    case 'line':
    case 'arrow':
    case 'rectangle':
    case 'ellipse':
    case 'highlight':
    case 'blur':
    case 'pixelate':
    case 'spotlight':
      return 'crosshair';
    default:
      return 'crosshair';
  }
};

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

const PixelatePreview: React.FC<{
  sourceUrl: string;
  bounds: ImageEditorObject['bounds'];
  canvasDimensions: { width: number; height: number };
  strength: number;
}> = ({ sourceUrl, bounds, canvasDimensions, strength }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || bounds.width <= 0 || bounds.height <= 0) {
      return;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    canvas.width = width;
    canvas.height = height;

    const image = new Image();
    image.onload = () => {
      const pixelSize = Math.max(6, strength * 3);
      const smallWidth = Math.max(1, Math.round(width / pixelSize));
      const smallHeight = Math.max(1, Math.round(height / pixelSize));
      const scratch = document.createElement('canvas');
      const scratchContext = scratch.getContext('2d');
      if (!scratchContext) {
        return;
      }
      scratch.width = smallWidth;
      scratch.height = smallHeight;
      scratchContext.imageSmoothingEnabled = false;
      scratchContext.drawImage(
        image,
        (bounds.x / canvasDimensions.width) * image.width,
        (bounds.y / canvasDimensions.height) * image.height,
        (bounds.width / canvasDimensions.width) * image.width,
        (bounds.height / canvasDimensions.height) * image.height,
        0,
        0,
        smallWidth,
        smallHeight,
      );
      context.clearRect(0, 0, width, height);
      context.imageSmoothingEnabled = false;
      context.drawImage(scratch, 0, 0, smallWidth, smallHeight, 0, 0, width, height);
    };
    image.src = sourceUrl;
  }, [bounds.height, bounds.width, bounds.x, bounds.y, canvasDimensions.height, canvasDimensions.width, sourceUrl, strength]);

  return <canvas ref={canvasRef} className="h-full w-full" />;
};

const ImageEditorWorkspace: React.FC<ImageEditorWorkspaceProps> = ({
  image,
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
  const [isPanning, setIsPanning] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hydratedImage, setHydratedImage] = useState<IndexedImage | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('edit');
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [editingTextObjectId, setEditingTextObjectId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);
  const textEditorRef = useRef<HTMLTextAreaElement>(null);
  const sessionRef = useRef<EditorSessionState | null>(null);
  const shouldSkipSessionCacheRef = useRef(false);
  const panStateRef = useRef<PanState | null>(null);

  const directories = useImageStore((state) => state.directories);
  const addImages = useImageStore((state) => state.addImages);
  const mergeImages = useImageStore((state) => state.mergeImages);
  const setImageThumbnail = useImageStore((state) => state.setImageThumbnail);
  const setError = useImageStore((state) => state.setError);
  const setSuccess = useImageStore((state) => state.setSuccess);
  const scanSubfolders = useImageStore((state) => state.scanSubfolders);
  const allImages = useImageStore((state) => state.images);

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
    if (!normalizedDocument) {
      setInspectorTab('edit');
      return;
    }
    if (activeTool === 'crop') {
      setInspectorTab('edit');
      return;
    }
    if (normalizedDocument.selectedObjectIds.length > 0 || isAnnotationTool(activeTool)) {
      setInspectorTab('style');
      return;
    }
    if (activeTool === 'select' || activeTool === 'color-picker') {
      setInspectorTab('edit');
    }
  }, [activeTool, normalizedDocument?.selectedObjectIds.length]);

  useEffect(() => {
    if (!editingTextObjectId || !textEditorRef.current) {
      return;
    }
    textEditorRef.current.focus();
    textEditorRef.current.select();
  }, [editingTextObjectId]);

  useEffect(() => {
    if (!editingTextObjectId || normalizedDocument?.objects.some((object) => object.id === editingTextObjectId)) {
      return;
    }
    setEditingTextObjectId(null);
  }, [editingTextObjectId, normalizedDocument?.objects]);

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
      shouldSkipSessionCacheRef.current = false;
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
      if (!shouldSkipSessionCacheRef.current && sessionRef.current) {
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
    const outputDimensions = readPngDimensions(bytes) || {
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
    } else if (allImages.some((candidate) => candidate.id === indexedImage.id)) {
      mergeImages([indexedImage]);
    } else {
      addImages([indexedImage]);
    }
    scheduleEditedImageCacheUpsert(sourceDirectory, indexedImage, scanSubfolders);
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

  const handleBack = useCallback(() => {
    if (hasChanges && !window.confirm('Leave the image editor and discard the current editor state?')) {
      return;
    }
    shouldSkipSessionCacheRef.current = true;
    editorSessionCache.delete(image.id);
    sessionRef.current = null;
    onBack();
  }, [hasChanges, image.id, onBack]);

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
    commitDocument((current) => {
      const normalizedRecipe = normalizeImageEditRecipe(recipe, current.sourceDimensions);
      const nextCanvasDimensions = getImageEditOutputDimensions(normalizedRecipe, current.sourceDimensions);
      const currentCanvasDimensions = current.canvasDimensions;

      if (areDimensionsEqual(currentCanvasDimensions, nextCanvasDimensions)) {
        return {
          ...current,
          recipe: normalizedRecipe,
          canvasDimensions: nextCanvasDimensions,
        };
      }

      return {
        ...current,
        recipe: normalizedRecipe,
        canvasDimensions: nextCanvasDimensions,
        objects: current.objects.map((object) => remapObjectToCanvasDimensions(
          object,
          currentCanvasDimensions,
          nextCanvasDimensions,
        )),
      };
    }, 'Edit recipe');
  }, [commitDocument]);

  const updateSelectedObjectStyle = useCallback((style: Partial<ImageEditorObjectStyle>) => {
    if (!selectedObject) return;
    commitDocument((current) => ({
      ...current,
      objects: current.objects.map((object) => object.id === selectedObject.id ? { ...object, style: { ...object.style, ...style } } : object),
    }), 'Object style');
  }, [commitDocument, selectedObject]);

  const updateSelectedObjectText = useCallback((text: string) => {
    if (!selectedObject || selectedObject.type !== 'text') return;
    commitDocument((current) => ({
      ...current,
      objects: current.objects.map((object) => object.id === selectedObject.id ? { ...object, text } : object),
    }), 'Text');
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
    shouldSkipSessionCacheRef.current = true;
    editorSessionCache.delete(image.id);
    sessionRef.current = null;
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
    setActiveStyle((current) => ({ ...current, strokeColor: color, fillColor: color, textColor: color }));
    if (selectedObject) {
      updateSelectedObjectStyle(selectedObject.type === 'text' || selectedObject.type === 'step'
        ? { textColor: color }
        : { strokeColor: color, fillColor: color });
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
      setIsPanning(true);
      return;
    }
    if (event.button !== 0) return;
    const point = getCanvasPoint(event, canvasRef.current, normalizedDocument);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (editingTextObjectId && activeTool === 'text') {
      setEditingTextObjectId(null);
      setActiveTool('select');
      commitDocument((current) => ({ ...current, selectedObjectIds: [] }), 'Deselect');
      return;
    }

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
      const isMultiSelectClick = activeTool === 'select' && (event.ctrlKey || event.metaKey);
      const isAlreadySelected = normalizedDocument.selectedObjectIds.includes(selected.id);
      const selectedIds = isMultiSelectClick
        ? isAlreadySelected
          ? normalizedDocument.selectedObjectIds.filter((id) => id !== selected.id)
          : [...normalizedDocument.selectedObjectIds, selected.id]
        : isAlreadySelected
          ? normalizedDocument.selectedObjectIds
          : [selected.id];
      if (isMultiSelectClick) {
        commitDocument((current) => ({ ...current, selectedObjectIds: selectedIds }), 'Select');
        return;
      }
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
  }, [activeTool, commitDocument, displayWidth, editingTextObjectId, normalizedDocument, pickColorAtPoint, selectedObject]);

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
      setIsPanning(false);
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
    if (nextObject.type === 'text') {
      setEditingTextObjectId(nextObject.id);
      setActiveTool('select');
    }
  }, [activeStyle, commitDocument, dragState, normalizedDocument]);

  const handleCanvasDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!normalizedDocument) return;
    const point = getCanvasPoint(event, canvasRef.current, normalizedDocument);
    const textObject = [...normalizedDocument.objects]
      .reverse()
      .find((object) => object.type === 'text' && point.x >= object.bounds.x && point.x <= object.bounds.x + object.bounds.width && point.y >= object.bounds.y && point.y <= object.bounds.y + object.bounds.height);
    if (!textObject) return;
    event.preventDefault();
    commitDocument((current) => ({ ...current, selectedObjectIds: [textObject.id] }), 'Select');
    setEditingTextObjectId(textObject.id);
    setActiveTool('select');
  }, [commitDocument, normalizedDocument]);

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

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
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
    };

    canvasElement.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvasElement.removeEventListener('wheel', handleWheel);
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
  const canUseFontFamily = styleTargetType === 'text';
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
  const effectOverlayObjects = displayedObjects.filter((object) => object.type === 'blur' || object.type === 'pixelate');
  const dragPreviewBounds = dragState ? boundsFromDrag(dragState) : null;
  const basePreviewSource = previewUrl || sourceUrl;
  const editorCursor = getEditorCursor(activeTool, isPanning);
  const cropRect = normalizedDocument?.recipe.crop.rect ?? null;
  const baseOutputDimensions = normalizedDocument
    ? getRecipeBaseOutputDimensions(normalizedDocument.recipe, normalizedDocument.sourceDimensions)
    : null;

  const setActiveOrSelectedStyle = (style: Partial<ImageEditorObjectStyle>) => {
    setActiveStyle((current) => ({ ...current, ...style }));
    updateSelectedObjectStyle(style);
  };

  const renderSliderRow = (
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (value: number) => void,
    suffix?: string,
  ) => (
    <label className="block space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-300">{label}</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className="h-7 w-16 rounded-md border border-gray-700 bg-gray-950 px-2 text-right text-xs text-gray-100 outline-none focus:border-cyan-500"
            aria-label={label}
          />
          {suffix && <span className="w-7 text-xs text-gray-500">{suffix}</span>}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-cyan-500"
        aria-label={`${label} slider`}
      />
    </label>
  );

  const renderColorSwatch = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    options?: { allowTransparent?: boolean },
  ) => {
    const isTransparent = isTransparentColor(value);
    return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-gray-800 bg-gray-950 px-2 py-2 text-xs text-gray-300">
      <span>{label}</span>
      <span className="flex items-center gap-1.5">
        {options?.allowTransparent && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              onChange('rgba(0, 0, 0, 0)');
            }}
            className={`h-6 rounded border px-2 text-[11px] font-medium ${
              isTransparent
                ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-100'
                : 'border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            Transparent
          </button>
        )}
        <input
          type="color"
          value={toColorInputValue(value)}
          onChange={(event) => onChange(event.target.value)}
          className="h-6 w-8 cursor-pointer rounded border border-gray-700 bg-gray-950 p-0.5"
          aria-label={label}
        />
      </span>
    </label>
    );
  };

  const renderInspectorContent = () => {
    if (!normalizedDocument) return null;

    if (inspectorTab === 'edit') {
      return (
        <div className="space-y-4">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-100">Local Edits</h3>
              <button type="button" onClick={restoreOriginal} disabled={!hasChanges} className="rounded-md border border-gray-700 px-2 py-1 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-40">
                Reset
              </button>
            </div>
            {(['brightness', 'contrast', 'saturation'] as const).map((key) => (
              <React.Fragment key={key}>
                {renderSliderRow(
                  key[0].toUpperCase() + key.slice(1),
                  normalizedDocument.recipe.adjustments[key],
                  0,
                  200,
                  (value) => updateRecipe({
                    ...normalizedDocument.recipe,
                    adjustments: {
                      ...normalizedDocument.recipe.adjustments,
                      [key]: clampImageAdjustment(key, value),
                    },
                  }),
                  '%',
                )}
              </React.Fragment>
            ))}
            {renderSliderRow('Hue', normalizedDocument.recipe.adjustments.hue, -180, 180, (value) => updateRecipe({
              ...normalizedDocument.recipe,
              adjustments: {
                ...normalizedDocument.recipe.adjustments,
                hue: clampImageAdjustment('hue', value),
              },
            }), 'deg')}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-100">Crop</h3>
            <div className="flex items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-300">
                <input
                  type="checkbox"
                  checked={normalizedDocument.recipe.crop.enabled}
                  onChange={(event) => updateRecipe({
                    ...normalizedDocument.recipe,
                    crop: {
                      ...normalizedDocument.recipe.crop,
                      enabled: event.target.checked,
                      rect: event.target.checked
                        ? normalizedDocument.recipe.crop.rect || createDefaultCropRect(normalizedDocument.sourceDimensions, normalizedDocument.recipe.crop.aspect)
                        : normalizedDocument.recipe.crop.rect,
                    },
                  })}
                  className="h-4 w-4 accent-cyan-500"
                />
                Enable
              </label>
              <select
                value={normalizedDocument.recipe.crop.aspect}
                onChange={(event) => updateRecipe({
                  ...normalizedDocument.recipe,
                  crop: {
                    enabled: normalizedDocument.recipe.crop.enabled,
                    aspect: event.target.value as ImageEditCropAspect,
                    rect: normalizedDocument.recipe.crop.enabled
                      ? createDefaultCropRect(normalizedDocument.sourceDimensions, event.target.value as ImageEditCropAspect)
                      : normalizedDocument.recipe.crop.rect,
                  },
                })}
                className="h-8 rounded-md border border-gray-700 bg-gray-950 px-2 text-xs text-gray-100 outline-none focus:border-cyan-500"
                aria-label="Crop aspect ratio"
              >
                {CROP_ASPECTS.map((aspect) => <option key={aspect} value={aspect}>{ASPECT_LABELS[aspect]}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['x', 'y', 'width', 'height'] as const).map((key) => (
                <label key={key} className="space-y-1 text-xs text-gray-400">
                  <span className="capitalize">{key}</span>
                  <input
                    type="number"
                    min={key === 'x' || key === 'y' ? 0 : 1}
                    value={cropRect?.[key] ?? 0}
                    disabled={!normalizedDocument.recipe.crop.enabled}
                    onChange={(event) => updateRecipe({
                      ...normalizedDocument.recipe,
                      crop: {
                        ...normalizedDocument.recipe.crop,
                        enabled: true,
                        rect: clampImageEditCropRect({
                          ...(cropRect || createDefaultCropRect(normalizedDocument.sourceDimensions, normalizedDocument.recipe.crop.aspect) || { x: 0, y: 0, width: 1, height: 1 }),
                          [key]: Number(event.target.value),
                        }, normalizedDocument.sourceDimensions),
                      },
                    })}
                    className="h-8 w-full rounded-md border border-gray-700 bg-gray-950 px-2 text-right text-xs text-gray-100 outline-none focus:border-cyan-500 disabled:opacity-50"
                    aria-label={`Crop ${key}`}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-100">Transform</h3>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => updateRecipe({ ...normalizedDocument.recipe, transform: { ...normalizedDocument.recipe.transform, rotation: normalizeImageEditRotation(normalizedDocument.recipe.transform.rotation - 90) } })} className="inline-flex items-center justify-center gap-1 rounded-md border border-gray-700 px-2 py-2 text-xs hover:bg-gray-800">
                <RotateCcw className="h-3.5 w-3.5" /> Left
              </button>
              <button type="button" onClick={() => updateRecipe({ ...normalizedDocument.recipe, transform: { ...normalizedDocument.recipe.transform, rotation: normalizeImageEditRotation(normalizedDocument.recipe.transform.rotation + 90) } })} className="inline-flex items-center justify-center gap-1 rounded-md border border-gray-700 px-2 py-2 text-xs hover:bg-gray-800">
                <RotateCw className="h-3.5 w-3.5" /> Right
              </button>
              <button type="button" onClick={() => updateRecipe({ ...normalizedDocument.recipe, transform: { ...normalizedDocument.recipe.transform, flipHorizontal: !normalizedDocument.recipe.transform.flipHorizontal } })} className={`inline-flex items-center justify-center gap-1 rounded-md border px-2 py-2 text-xs ${normalizedDocument.recipe.transform.flipHorizontal ? 'border-cyan-400/40 bg-cyan-500/20 text-cyan-100' : 'border-gray-700 hover:bg-gray-800'}`}>
                <FlipHorizontal className="h-3.5 w-3.5" /> Flip H
              </button>
              <button type="button" onClick={() => updateRecipe({ ...normalizedDocument.recipe, transform: { ...normalizedDocument.recipe.transform, flipVertical: !normalizedDocument.recipe.transform.flipVertical } })} className={`inline-flex items-center justify-center gap-1 rounded-md border px-2 py-2 text-xs ${normalizedDocument.recipe.transform.flipVertical ? 'border-cyan-400/40 bg-cyan-500/20 text-cyan-100' : 'border-gray-700 hover:bg-gray-800'}`}>
                <FlipVertical className="h-3.5 w-3.5" /> Flip V
              </button>
            </div>
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
            <h3 className="text-sm font-semibold text-gray-100">Resize</h3>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-300">
              <input
                type="checkbox"
                checked={normalizedDocument.recipe.resize.enabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  const base = baseOutputDimensions || normalizedDocument.sourceDimensions;
                  updateRecipe({
                    ...normalizedDocument.recipe,
                    resize: {
                      ...normalizedDocument.recipe.resize,
                      enabled,
                      width: enabled ? Math.max(1, Math.round(base.width)) : normalizedDocument.recipe.resize.width,
                      height: enabled ? Math.max(1, Math.round(base.height)) : normalizedDocument.recipe.resize.height,
                    },
                  });
                }}
                className="h-4 w-4 accent-cyan-500"
              />
              Enable
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['width', 'height'] as const).map((key) => (
                <label key={key} className="space-y-1 text-xs text-gray-400">
                  <span className="capitalize">{key}</span>
                  <input
                    type="number"
                    min={1}
                    value={normalizedDocument.recipe.resize[key]}
                    onChange={(event) => {
                      const nextValue = Math.max(1, Math.round(Number(event.target.value)) || 1);
                      const base = baseOutputDimensions || normalizedDocument.sourceDimensions;
                      const ratio = base.width / Math.max(1, base.height);
                      const width = key === 'width'
                        ? nextValue
                        : normalizedDocument.recipe.resize.lockAspectRatio
                          ? Math.max(1, Math.round(nextValue * ratio))
                          : normalizedDocument.recipe.resize.width;
                      const height = key === 'height'
                        ? nextValue
                        : normalizedDocument.recipe.resize.lockAspectRatio
                          ? Math.max(1, Math.round(nextValue / ratio))
                          : normalizedDocument.recipe.resize.height;
                      updateRecipe({ ...normalizedDocument.recipe, resize: { ...normalizedDocument.recipe.resize, enabled: true, width, height } });
                    }}
                    className="h-8 w-full rounded-md border border-gray-700 bg-gray-950 px-2 text-right text-xs text-gray-100"
                  />
                </label>
              ))}
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={normalizedDocument.recipe.resize.lockAspectRatio}
                onChange={(event) => updateRecipe({ ...normalizedDocument.recipe, resize: { ...normalizedDocument.recipe.resize, lockAspectRatio: event.target.checked } })}
                className="h-4 w-4 accent-cyan-500"
              />
              Lock ratio
            </label>
          </section>
        </div>
      );
    }

    if (inspectorTab === 'style') {
      if (selectedCount > 1) {
        return (
          <div className="space-y-4">
            <section className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <h3 className="text-sm font-semibold text-gray-100">{selectedCount} objects selected</h3>
              <p className="mt-1 text-xs text-gray-500">Shared style controls are hidden for mixed selections.</p>
            </section>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={flattenSelection} className="rounded-md border border-gray-700 px-2 py-2 text-xs font-medium text-gray-200 hover:bg-gray-800">Flatten</button>
              <button type="button" onClick={deleteSelected} className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/20">Delete</button>
            </div>
          </div>
        );
      }

      if (!styleTargetType) {
        return (
          <div className="rounded-md border border-gray-800 bg-gray-950 p-3 text-xs text-gray-500">
            Select an object or choose an annotation tool to show its style.
          </div>
        );
      }

      return (
        <div className="space-y-4">
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-100">{selectedObject ? `${selectedObject.type} style` : `${styleTargetType} defaults`}</h3>
              <p className="mt-1 text-xs text-gray-500">{selectedObject ? 'Editing the selected object.' : 'Applies to the next object you draw.'}</p>
            </div>
            {selectedObject?.type === 'text' && (
              <label className="block space-y-1 text-xs text-gray-400">
                <span>Content</span>
                <input
                  type="text"
                  value={selectedObject.text || ''}
                  onChange={(event) => updateSelectedObjectText(event.target.value)}
                  className="h-9 w-full rounded-md border border-gray-700 bg-gray-950 px-2 text-sm text-gray-100 outline-none focus:border-cyan-500"
                />
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              {canUseStrokeColor && renderColorSwatch('Stroke', displayedStyle.strokeColor, (value) => setActiveOrSelectedStyle({ strokeColor: value }))}
              {canUseFillColor && renderColorSwatch('Fill', displayedStyle.fillColor, (value) => setActiveOrSelectedStyle({ fillColor: value }), { allowTransparent: true })}
              {canUseTextColor && renderColorSwatch('Text', displayedStyle.textColor, (value) => setActiveOrSelectedStyle({ textColor: value }))}
            </div>
            {canUseStrokeWidth && renderSliderRow(
              styleTargetType === 'blur' || styleTargetType === 'pixelate' ? 'Strength' : 'Width',
              displayedStyle.strokeWidth,
              1,
              80,
              (value) => setActiveOrSelectedStyle({ strokeWidth: clamp(Math.round(value) || 1, 1, 80) }),
            )}
            {canUseFontSize && renderSliderRow(
              'Font',
              displayedStyle.fontSize,
              8,
              240,
              (value) => setActiveOrSelectedStyle({ fontSize: clamp(Math.round(value) || 32, 8, 240) }),
              'px',
            )}
            {canUseFontFamily && (
              <label className="block space-y-1.5 text-xs text-gray-400">
                <span>Font family</span>
                <select
                  value={displayedStyle.fontFamily}
                  onChange={(event) => setActiveOrSelectedStyle({ fontFamily: event.target.value })}
                  className="h-9 w-full rounded-md border border-gray-700 bg-gray-950 px-2 text-sm text-gray-100 outline-none focus:border-cyan-500"
                >
                  {FONT_FAMILY_OPTIONS.map((font) => (
                    <option key={font.value} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {styleTargetType === 'spotlight' && renderSliderRow(
              'Intensity',
              Math.round(displayedStyle.opacity * 100),
              10,
              100,
              (value) => setActiveOrSelectedStyle({ opacity: clamp(value, 10, 100) / 100 }),
              '%',
            )}
          </section>

          {selectedObject && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-100">Object</h3>
              <div className="grid grid-cols-4 gap-1">
                <button type="button" onClick={() => moveSelected('front')} className="rounded border border-gray-700 px-1 py-1 text-xs hover:bg-gray-800">Front</button>
                <button type="button" onClick={() => moveSelected('forward')} className="rounded border border-gray-700 px-1 py-1 text-xs hover:bg-gray-800">Up</button>
                <button type="button" onClick={() => moveSelected('backward')} className="rounded border border-gray-700 px-1 py-1 text-xs hover:bg-gray-800">Down</button>
                <button type="button" onClick={() => moveSelected('back')} className="rounded border border-gray-700 px-1 py-1 text-xs hover:bg-gray-800">Back</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={duplicateSelected} className="rounded-md border border-gray-700 px-2 py-2 text-xs font-medium text-gray-200 hover:bg-gray-800">Duplicate</button>
                <button type="button" onClick={deleteSelected} className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/20">Delete</button>
              </div>
            </section>
          )}
        </div>
      );
    }

    if (inspectorTab === 'ai') {
      return (
        <div className="space-y-4">
          <section className="rounded-md border border-gray-800 bg-gray-950 p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-100">AI Transform</h3>
              <span className="rounded-full border border-purple-400/30 bg-purple-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase text-purple-200">
                Planned
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-gray-400">
              AI-assisted editor tools are being prepared for a later update.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-1 text-xs">
              {['Upscale', 'Detail Restore', 'Face Restore', 'Inpaint', 'Outpaint'].map((label) => (
                <div key={label} className="rounded-md border border-gray-800 px-2 py-1.5 text-gray-500">
                  {label}
                </div>
              ))}
            </div>
          </section>
          <section className="space-y-3">
            {onOpenComfyUIWorkflow && (
              <button type="button" onClick={() => onOpenComfyUIWorkflow(image)} className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 hover:bg-gray-800">
                <Workflow className="h-4 w-4" />
                Open Workflow
              </button>
            )}
          </section>
        </div>
      );
    }
    return null;
  };

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
          <button type="button" onClick={handleBack} className="rounded-md p-2 text-gray-300 hover:bg-gray-800" title="Back" aria-label="Back">
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
          <button type="button" onClick={undo} disabled={!history.past.length} className="rounded-md p-2 text-gray-300 hover:bg-gray-800 disabled:opacity-40" title={!history.past.length ? 'Nothing to undo' : 'Undo'} aria-label={!history.past.length ? 'Nothing to undo' : 'Undo'}>
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={redo} disabled={!history.future.length} className="rounded-md p-2 text-gray-300 hover:bg-gray-800 disabled:opacity-40" title={!history.future.length ? 'Nothing to redo' : 'Redo'} aria-label={!history.future.length ? 'Nothing to redo' : 'Redo'}>
            <Redo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={flattenSelection} className="rounded-md p-2 text-gray-300 hover:bg-gray-800" title="Flatten" aria-label="Flatten">
            <Layers className="h-4 w-4" />
          </button>
          <button type="button" onClick={handleCopy} className="rounded-md p-2 text-gray-300 hover:bg-gray-800" title="Copy image" aria-label="Copy image">
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setIsInspectorOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-gray-700 px-2 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800 xl:hidden" title="Open inspector">
            <Layers className="h-4 w-4" />
            Inspector
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
                cursor: editorCursor,
              }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={() => {
                setDragState(null);
                panStateRef.current = null;
                setIsPanning(false);
              }}
              onDoubleClick={handleCanvasDoubleClick}
              onAuxClick={(event) => event.preventDefault()}
            >
              {previewUrl ? (
                <img ref={previewImageRef} src={previewUrl} alt={image.name} className="block h-full w-full object-contain" draggable={false} />
              ) : (
                <img ref={previewImageRef} src={sourceUrl} alt={image.name} className="block h-full w-full object-contain opacity-80" draggable={false} />
              )}
              {effectOverlayObjects.map((object) => {
                const boundsStyle = toCanvasPercentBounds(object.bounds, normalizedDocument.canvasDimensions);
                return (
                  <div
                    key={`effect-${object.id}`}
                    className="pointer-events-none absolute overflow-hidden"
                    style={{
                      ...boundsStyle,
                      backdropFilter: object.type === 'blur' ? `blur(${Math.max(4, object.style.strokeWidth * 2)}px)` : undefined,
                    }}
                  >
                    {object.type === 'pixelate' && basePreviewSource && (
                      <PixelatePreview
                        sourceUrl={basePreviewSource}
                        bounds={object.bounds}
                        canvasDimensions={normalizedDocument.canvasDimensions}
                        strength={object.style.strokeWidth}
                      />
                    )}
                  </div>
                );
              })}
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
                  if (object.type === 'spotlight') {
                    const maskId = `image-editor-spotlight-${object.id}`;
                    return (
                      <g key={object.id}>
                        <defs>
                          <mask id={maskId}>
                            <rect x={0} y={0} width={normalizedDocument.canvasDimensions.width} height={normalizedDocument.canvasDimensions.height} fill="white" />
                            <ellipse
                              cx={bounds.x + bounds.width / 2}
                              cy={bounds.y + bounds.height / 2}
                              rx={bounds.width / 2}
                              ry={bounds.height / 2}
                              fill="black"
                            />
                          </mask>
                        </defs>
                        <rect
                          x={0}
                          y={0}
                          width={normalizedDocument.canvasDimensions.width}
                          height={normalizedDocument.canvasDimensions.height}
                          fill="rgba(0, 0, 0, 0.48)"
                          mask={`url(#${maskId})`}
                        />
                        <ellipse
                          cx={bounds.x + bounds.width / 2}
                          cy={bounds.y + bounds.height / 2}
                          rx={bounds.width / 2}
                          ry={bounds.height / 2}
                          fill="none"
                          stroke={style.strokeColor}
                          strokeWidth={style.strokeWidth}
                          opacity={style.opacity}
                          strokeDasharray="10 8"
                        />
                      </g>
                    );
                  }
                  if (object.type === 'ellipse' || object.type === 'magnify') {
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
                        strokeDasharray={object.type === 'magnify' ? '10 8' : undefined}
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
                        fontFamily={style.fontFamily}
                        opacity={style.opacity}
                      >
                        {object.text || (editingTextObjectId === object.id ? '' : 'Text')}
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
                          fontFamily={style.fontFamily}
                        >
                          {object.stepNumber || 1}
                        </text>
                      </g>
                    );
                  }
                  if (object.type === 'blur' || object.type === 'pixelate') return null;
                  return null;
                })}
              </svg>
              {dragPreviewBounds && dragState && (dragState.tool === 'rectangle' || dragState.tool === 'highlight' || dragState.tool === 'ellipse' || dragState.tool === 'blur' || dragState.tool === 'pixelate' || dragState.tool === 'spotlight') ? (
                <>
                  {(dragState.tool === 'blur' || dragState.tool === 'pixelate') && (
                    <div
                      className="pointer-events-none absolute overflow-hidden"
                      style={{
                        ...toCanvasPercentBounds(dragPreviewBounds, normalizedDocument.canvasDimensions),
                        backdropFilter: dragState.tool === 'blur' ? `blur(${Math.max(4, activeStyle.strokeWidth * 2)}px)` : undefined,
                      }}
                    >
                      {dragState.tool === 'pixelate' && basePreviewSource && (
                        <PixelatePreview
                          sourceUrl={basePreviewSource}
                          bounds={dragPreviewBounds}
                          canvasDimensions={normalizedDocument.canvasDimensions}
                          strength={activeStyle.strokeWidth}
                        />
                      )}
                    </div>
                  )}
                  <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${normalizedDocument.canvasDimensions.width} ${normalizedDocument.canvasDimensions.height}`} preserveAspectRatio="none">
                    {dragState.tool === 'ellipse' || dragState.tool === 'spotlight' ? (
                      dragState.tool === 'spotlight' ? (
                        <g>
                          <defs>
                            <mask id="image-editor-spotlight-preview">
                              <rect x={0} y={0} width={normalizedDocument.canvasDimensions.width} height={normalizedDocument.canvasDimensions.height} fill="white" />
                              <ellipse cx={dragPreviewBounds.x + dragPreviewBounds.width / 2} cy={dragPreviewBounds.y + dragPreviewBounds.height / 2} rx={dragPreviewBounds.width / 2} ry={dragPreviewBounds.height / 2} fill="black" />
                            </mask>
                          </defs>
                          <rect x={0} y={0} width={normalizedDocument.canvasDimensions.width} height={normalizedDocument.canvasDimensions.height} fill="rgba(0, 0, 0, 0.48)" mask="url(#image-editor-spotlight-preview)" />
                          <ellipse
                            cx={dragPreviewBounds.x + dragPreviewBounds.width / 2}
                            cy={dragPreviewBounds.y + dragPreviewBounds.height / 2}
                            rx={dragPreviewBounds.width / 2}
                            ry={dragPreviewBounds.height / 2}
                            fill="none"
                            stroke={activeStyle.strokeColor}
                            strokeWidth={activeStyle.strokeWidth}
                            strokeDasharray="10 8"
                          />
                        </g>
                      ) : (
                        <ellipse
                          cx={dragPreviewBounds.x + dragPreviewBounds.width / 2}
                          cy={dragPreviewBounds.y + dragPreviewBounds.height / 2}
                          rx={dragPreviewBounds.width / 2}
                          ry={dragPreviewBounds.height / 2}
                          fill={activeStyle.fillColor}
                          stroke={activeStyle.strokeColor}
                          strokeWidth={activeStyle.strokeWidth}
                        />
                      )
                    ) : (
                      <rect
                        x={dragPreviewBounds.x}
                        y={dragPreviewBounds.y}
                        width={dragPreviewBounds.width}
                        height={dragPreviewBounds.height}
                        fill={dragState.tool === 'highlight' ? 'rgba(250, 204, 21, 0.28)' : dragState.tool === 'rectangle' ? activeStyle.fillColor : 'none'}
                        stroke={activeStyle.strokeColor}
                        strokeWidth={dragState.tool === 'blur' || dragState.tool === 'pixelate' ? 0 : dragState.tool === 'rectangle' ? activeStyle.strokeWidth : Math.max(2, activeStyle.strokeWidth / 2)}
                        strokeDasharray={dragState.tool === 'blur' || dragState.tool === 'pixelate' ? '10 8' : undefined}
                      />
                    )}
                  </svg>
                </>
              ) : dragState && (dragState.tool === 'line' || dragState.tool === 'arrow') ? (
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
              {editingTextObjectId && selectedObject?.type === 'text' && (
                <textarea
                  ref={textEditorRef}
                  value={selectedObject.text || ''}
                  onChange={(event) => updateSelectedObjectText(event.target.value)}
                  onBlur={() => setEditingTextObjectId(null)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      setEditingTextObjectId(null);
                      return;
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setEditingTextObjectId(null);
                    }
                    event.stopPropagation();
                  }}
                  className="absolute resize-none overflow-hidden border border-cyan-300/70 bg-gray-950/80 px-1 py-0 text-gray-100 outline-none ring-2 ring-cyan-400/20"
                  style={{
                    left: `${(selectedObject.bounds.x / normalizedDocument.canvasDimensions.width) * 100}%`,
                    top: `${(selectedObject.bounds.y / normalizedDocument.canvasDimensions.height) * 100}%`,
                    width: `${(selectedObject.bounds.width / normalizedDocument.canvasDimensions.width) * 100}%`,
                    height: `${(selectedObject.bounds.height / normalizedDocument.canvasDimensions.height) * 100}%`,
                    color: selectedObject.style.textColor,
                    fontSize: `${selectedObject.style.fontSize * (displayWidth / normalizedDocument.canvasDimensions.width)}px`,
                    fontFamily: selectedObject.style.fontFamily,
                    opacity: selectedObject.style.opacity,
                  }}
                  aria-label="Edit text annotation"
                />
              )}
            </div>
          </div>
          <div className="flex h-9 shrink-0 items-center justify-between border-t border-gray-800 bg-gray-900 px-4 text-xs text-gray-400">
            <span>{TOOL_HINTS[activeTool]}</span>
            <span>{isRendering ? 'Rendering preview...' : `${Math.round(zoom * 100)}% · ${normalizedDocument.objects.length} objects · ${selectedCount} selected`}</span>
          </div>
        </div>

        {isInspectorOpen && (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-black/60 xl:hidden"
            onClick={() => setIsInspectorOpen(false)}
            aria-label="Close inspector overlay"
          />
        )}
        <aside className={`fixed inset-y-0 right-0 z-40 flex w-[min(22rem,calc(100vw-4rem))] shrink-0 flex-col border-l border-gray-800 bg-gray-900 transition-transform xl:static xl:z-auto xl:w-80 xl:translate-x-0 ${
          isInspectorOpen ? 'translate-x-0' : 'translate-x-full'
        }`}>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-800 px-3 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-100">Inspector</div>
              <div className="truncate text-xs text-gray-500">
                {selectedCount > 1
                  ? `${selectedCount} selected`
                  : selectedObject
                    ? selectedObject.type
                    : TOOL_DEFS.find((tool) => tool.id === activeTool)?.label}
              </div>
            </div>
            <button type="button" onClick={() => setIsInspectorOpen(false)} className="rounded-md p-2 text-gray-300 hover:bg-gray-800 xl:hidden" title="Close inspector" aria-label="Close inspector">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid shrink-0 grid-cols-3 gap-1 border-b border-gray-800 bg-gray-900 p-2">
            {INSPECTOR_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setInspectorTab(tab.id)}
                className={`rounded-md px-1.5 py-1.5 text-xs font-medium transition-colors ${
                  inspectorTab === tab.id
                    ? 'bg-cyan-500/20 text-cyan-100'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {renderInspectorContent()}
          </div>
          <div className="shrink-0 border-t border-gray-800 bg-gray-950/60 px-4 py-3 text-xs text-gray-400">
            <div className="flex min-w-0 items-center gap-2 text-gray-200">
              <ImageIcon className="h-4 w-4 shrink-0 text-cyan-300" />
              <span className="truncate">{image.name}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              <span>Source {normalizedDocument.sourceDimensions.width}x{normalizedDocument.sourceDimensions.height}</span>
              <span>Output {activeOutputDimensions?.width || normalizedDocument.canvasDimensions.width}x{activeOutputDimensions?.height || normalizedDocument.canvasDimensions.height}</span>
              <span>{normalizedDocument.objects.length} objects</span>
              <span>{hasChanges ? 'Unsaved edits' : 'No editor changes'}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default ImageEditorWorkspace;

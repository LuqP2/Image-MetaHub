import type {
  BaseMetadata,
  ImageAdjustments,
  ImageEditCrop,
  ImageEditCropAspect,
  ImageEditCropRect,
  ImageEditEffects,
  ImageEditRecipe,
  ImageEditResize,
  ImageEditRotation,
  ImageEditTransform,
  ImageEditorBackground,
  ImageEditorDocument,
  ImageEditorObject,
  ImageEditorObjectStyle,
  LoRAInfo,
} from '../types';

export const DEFAULT_IMAGE_ADJUSTMENTS: ImageAdjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
};

export const DEFAULT_IMAGE_EDIT_RECIPE: ImageEditRecipe = {
  adjustments: DEFAULT_IMAGE_ADJUSTMENTS,
  transform: {
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
  },
  crop: {
    enabled: false,
    aspect: 'free',
    rect: null,
  },
  resize: {
    enabled: false,
    width: 0,
    height: 0,
    lockAspectRatio: true,
  },
  effects: {
    sharpen: 0,
    blur: 0,
  },
};

export const DEFAULT_IMAGE_EDITOR_OBJECT_STYLE: ImageEditorObjectStyle = {
  strokeColor: '#22d3ee',
  fillColor: 'rgba(0, 0, 0, 0)',
  textColor: '#f8fafc',
  strokeWidth: 4,
  fontSize: 32,
  fontFamily: 'system-ui, sans-serif',
  opacity: 1,
};

export const DEFAULT_IMAGE_EDITOR_BACKGROUND: ImageEditorBackground = {
  kind: 'transparent',
  color: '#111827',
  gradientFrom: '#111827',
  gradientTo: '#374151',
  margin: 0,
  padding: 0,
  smartPadding: false,
  roundedCorner: 0,
  shadowRadius: 0,
};

const ADJUSTMENT_RANGES: Record<keyof ImageAdjustments, { min: number; max: number }> = {
  brightness: { min: 0, max: 200 },
  contrast: { min: 0, max: 200 },
  saturation: { min: 0, max: 200 },
  hue: { min: -180, max: 180 },
};

const EFFECT_RANGES: Record<keyof ImageEditEffects, { min: number; max: number }> = {
  sharpen: { min: 0, max: 100 },
  blur: { min: 0, max: 20 },
};

const ALLOWED_IMAGE_EDITOR_FONT_FAMILIES = new Set([
  'system-ui, sans-serif',
  'Arial, sans-serif',
  'Verdana, sans-serif',
  'Georgia, serif',
  '"Times New Roman", serif',
  '"Courier New", monospace',
  'Impact, sans-serif',
]);

const normalizeImageEditorFontFamily = (value: unknown): string => {
  const fontFamily = typeof value === 'string' ? value : '';
  return ALLOWED_IMAGE_EDITOR_FONT_FAMILIES.has(fontFamily)
    ? fontFamily
    : DEFAULT_IMAGE_EDITOR_OBJECT_STYLE.fontFamily;
};

const MAX_OUTPUT_DIMENSION = 20000;
const ROTATIONS: ImageEditRotation[] = [0, 90, 180, 270];
export const CROP_ASPECTS: ImageEditCropAspect[] = ['free', 'original', '1:1', '4:3', '3:2', '16:9', '9:16'];

export const clampImageAdjustment = (
  key: keyof ImageAdjustments,
  value: number,
): number => {
  const range = ADJUSTMENT_RANGES[key];
  if (!Number.isFinite(value)) {
    return DEFAULT_IMAGE_ADJUSTMENTS[key];
  }

  return Math.min(range.max, Math.max(range.min, Math.round(value)));
};

export const normalizeImageAdjustments = (
  adjustments: Partial<ImageAdjustments>,
): ImageAdjustments => ({
  brightness: clampImageAdjustment('brightness', adjustments.brightness ?? DEFAULT_IMAGE_ADJUSTMENTS.brightness),
  contrast: clampImageAdjustment('contrast', adjustments.contrast ?? DEFAULT_IMAGE_ADJUSTMENTS.contrast),
  saturation: clampImageAdjustment('saturation', adjustments.saturation ?? DEFAULT_IMAGE_ADJUSTMENTS.saturation),
  hue: clampImageAdjustment('hue', adjustments.hue ?? DEFAULT_IMAGE_ADJUSTMENTS.hue),
});

export const hasImageAdjustments = (adjustments: Partial<ImageAdjustments>): boolean => {
  const normalized = normalizeImageAdjustments(adjustments);
  return (
    normalized.brightness !== DEFAULT_IMAGE_ADJUSTMENTS.brightness ||
    normalized.contrast !== DEFAULT_IMAGE_ADJUSTMENTS.contrast ||
    normalized.saturation !== DEFAULT_IMAGE_ADJUSTMENTS.saturation ||
    normalized.hue !== DEFAULT_IMAGE_ADJUSTMENTS.hue
  );
};

export const buildImageAdjustmentFilter = (adjustments: Partial<ImageAdjustments>): string => {
  const normalized = normalizeImageAdjustments(adjustments);
  return [
    `brightness(${normalized.brightness}%)`,
    `contrast(${normalized.contrast}%)`,
    `saturate(${normalized.saturation}%)`,
    `hue-rotate(${normalized.hue}deg)`,
  ].join(' ');
};

const clampNumber = (value: number, min: number, max: number, fallback: number): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
};

const clampInteger = (value: number, min: number, max: number, fallback: number): number => (
  Math.round(clampNumber(value, min, max, fallback))
);

export const normalizeImageEditRotation = (value: number): ImageEditRotation => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const normalized = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  return (ROTATIONS.includes(normalized as ImageEditRotation) ? normalized : 0) as ImageEditRotation;
};

export const normalizeImageEditTransform = (
  transform?: Partial<ImageEditTransform>,
): ImageEditTransform => ({
  rotation: normalizeImageEditRotation(transform?.rotation ?? DEFAULT_IMAGE_EDIT_RECIPE.transform.rotation),
  flipHorizontal: Boolean(transform?.flipHorizontal),
  flipVertical: Boolean(transform?.flipVertical),
});

export const clampImageEditEffect = (
  key: keyof ImageEditEffects,
  value: number,
): number => {
  const range = EFFECT_RANGES[key];
  return clampInteger(value, range.min, range.max, DEFAULT_IMAGE_EDIT_RECIPE.effects[key]);
};

export const normalizeImageEditEffects = (
  effects?: Partial<ImageEditEffects>,
): ImageEditEffects => ({
  sharpen: clampImageEditEffect('sharpen', effects?.sharpen ?? DEFAULT_IMAGE_EDIT_RECIPE.effects.sharpen),
  blur: clampImageEditEffect('blur', effects?.blur ?? DEFAULT_IMAGE_EDIT_RECIPE.effects.blur),
});

export const getCropAspectRatio = (
  aspect: ImageEditCropAspect,
  sourceDimensions?: { width: number; height: number },
): number | null => {
  if (aspect === 'free') {
    return null;
  }
  if (aspect === 'original') {
    const width = sourceDimensions?.width || 0;
    const height = sourceDimensions?.height || 0;
    return width > 0 && height > 0 ? width / height : null;
  }

  const [width, height] = aspect.split(':').map(Number);
  return width > 0 && height > 0 ? width / height : null;
};

export const clampImageEditCropRect = (
  rect: Partial<ImageEditCropRect> | null | undefined,
  sourceDimensions?: { width: number; height: number },
): ImageEditCropRect | null => {
  const sourceWidth = sourceDimensions?.width || 0;
  const sourceHeight = sourceDimensions?.height || 0;
  if (!rect || sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const width = clampInteger(rect.width ?? sourceWidth, 1, sourceWidth, sourceWidth);
  const height = clampInteger(rect.height ?? sourceHeight, 1, sourceHeight, sourceHeight);
  const x = clampInteger(rect.x ?? 0, 0, Math.max(0, sourceWidth - width), 0);
  const y = clampInteger(rect.y ?? 0, 0, Math.max(0, sourceHeight - height), 0);
  return { x, y, width, height };
};

export const createDefaultCropRect = (
  sourceDimensions?: { width: number; height: number },
  aspect: ImageEditCropAspect = 'free',
): ImageEditCropRect | null => {
  const sourceWidth = sourceDimensions?.width || 0;
  const sourceHeight = sourceDimensions?.height || 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const ratio = getCropAspectRatio(aspect, sourceDimensions);
  let width = Math.round(sourceWidth * 0.85);
  let height = Math.round(sourceHeight * 0.85);

  if (ratio) {
    if (width / height > ratio) {
      width = Math.round(height * ratio);
    } else {
      height = Math.round(width / ratio);
    }
  }

  width = Math.max(1, Math.min(sourceWidth, width));
  height = Math.max(1, Math.min(sourceHeight, height));
  return {
    x: Math.round((sourceWidth - width) / 2),
    y: Math.round((sourceHeight - height) / 2),
    width,
    height,
  };
};

export const normalizeImageEditCrop = (
  crop?: Partial<ImageEditCrop>,
  sourceDimensions?: { width: number; height: number },
): ImageEditCrop => {
  const aspect = CROP_ASPECTS.includes(crop?.aspect as ImageEditCropAspect)
    ? crop?.aspect as ImageEditCropAspect
    : DEFAULT_IMAGE_EDIT_RECIPE.crop.aspect;
  if ((!sourceDimensions || sourceDimensions.width <= 0 || sourceDimensions.height <= 0) && crop?.rect) {
    const rect = {
      x: Math.max(0, Math.round(crop.rect.x || 0)),
      y: Math.max(0, Math.round(crop.rect.y || 0)),
      width: Math.max(1, Math.round(crop.rect.width || 1)),
      height: Math.max(1, Math.round(crop.rect.height || 1)),
    };
    return {
      enabled: Boolean(crop.enabled),
      aspect,
      rect,
    };
  }

  const rect = clampImageEditCropRect(crop?.rect, sourceDimensions);
  return {
    enabled: Boolean(crop?.enabled && rect),
    aspect,
    rect,
  };
};

export const getRecipeSourceRect = (
  recipe: ImageEditRecipe,
  sourceDimensions: { width: number; height: number },
): ImageEditCropRect => (
  recipe.crop.enabled && recipe.crop.rect
    ? recipe.crop.rect
    : { x: 0, y: 0, width: sourceDimensions.width, height: sourceDimensions.height }
);

export const getRecipeBaseOutputDimensions = (
  recipe: ImageEditRecipe,
  sourceDimensions: { width: number; height: number },
): { width: number; height: number } => {
  const sourceRect = getRecipeSourceRect(recipe, sourceDimensions);
  const rotated = recipe.transform.rotation === 90 || recipe.transform.rotation === 270;
  return {
    width: rotated ? sourceRect.height : sourceRect.width,
    height: rotated ? sourceRect.width : sourceRect.height,
  };
};

export const normalizeImageEditResize = (
  resize?: Partial<ImageEditResize>,
  baseDimensions?: { width: number; height: number },
): ImageEditResize => {
  const hasBaseDimensions = Boolean(baseDimensions && baseDimensions.width > 0 && baseDimensions.height > 0);
  if (!hasBaseDimensions && !resize?.enabled) {
    return {
      enabled: false,
      width: clampInteger(resize?.width ?? DEFAULT_IMAGE_EDIT_RECIPE.resize.width, 0, MAX_OUTPUT_DIMENSION, DEFAULT_IMAGE_EDIT_RECIPE.resize.width),
      height: clampInteger(resize?.height ?? DEFAULT_IMAGE_EDIT_RECIPE.resize.height, 0, MAX_OUTPUT_DIMENSION, DEFAULT_IMAGE_EDIT_RECIPE.resize.height),
      lockAspectRatio: resize?.lockAspectRatio !== false,
    };
  }

  const baseWidth = Math.max(1, Math.round(baseDimensions?.width || resize?.width || 1));
  const baseHeight = Math.max(1, Math.round(baseDimensions?.height || resize?.height || 1));
  const width = clampInteger(resize?.width ?? baseWidth, 1, MAX_OUTPUT_DIMENSION, baseWidth);
  const height = clampInteger(resize?.height ?? baseHeight, 1, MAX_OUTPUT_DIMENSION, baseHeight);
  return {
    enabled: Boolean(resize?.enabled && width > 0 && height > 0 && (width !== baseWidth || height !== baseHeight)),
    width,
    height,
    lockAspectRatio: resize?.lockAspectRatio !== false,
  };
};

const isRecipeLike = (
  value: Partial<ImageEditRecipe> | Partial<ImageAdjustments> | undefined,
): value is Partial<ImageEditRecipe> => (
  Boolean(value) && (
    'adjustments' in value ||
    'transform' in value ||
    'crop' in value ||
    'resize' in value ||
    'effects' in value
  )
);

export const normalizeImageEditRecipe = (
  recipeOrAdjustments?: Partial<ImageEditRecipe> | Partial<ImageAdjustments>,
  sourceDimensions?: { width: number; height: number },
): ImageEditRecipe => {
  const recipeInput = isRecipeLike(recipeOrAdjustments) ? recipeOrAdjustments : {};
  const adjustmentsInput = isRecipeLike(recipeOrAdjustments)
    ? recipeInput.adjustments
    : recipeOrAdjustments;
  const adjustments = normalizeImageAdjustments(adjustmentsInput || DEFAULT_IMAGE_ADJUSTMENTS);
  const transform = normalizeImageEditTransform(recipeInput.transform);
  const crop = normalizeImageEditCrop(recipeInput.crop, sourceDimensions);
  const baseDimensions = sourceDimensions
    ? getRecipeBaseOutputDimensions({ ...DEFAULT_IMAGE_EDIT_RECIPE, adjustments, transform, crop }, sourceDimensions)
    : undefined;
  const resize = normalizeImageEditResize(recipeInput.resize, baseDimensions);
  const effects = normalizeImageEditEffects(recipeInput.effects);

  return {
    adjustments,
    transform,
    crop,
    resize,
    effects,
  };
};

export const getImageEditOutputDimensions = (
  recipeOrAdjustments: Partial<ImageEditRecipe> | Partial<ImageAdjustments>,
  sourceDimensions: { width: number; height: number },
): { width: number; height: number } => {
  const recipe = normalizeImageEditRecipe(recipeOrAdjustments, sourceDimensions);
  const base = getRecipeBaseOutputDimensions(recipe, sourceDimensions);
  return recipe.resize.enabled
    ? { width: recipe.resize.width, height: recipe.resize.height }
    : base;
};

export const hasImageEditRecipeChanges = (
  recipeOrAdjustments: Partial<ImageEditRecipe> | Partial<ImageAdjustments>,
): boolean => {
  const recipe = normalizeImageEditRecipe(recipeOrAdjustments);
  return (
    hasImageAdjustments(recipe.adjustments) ||
    recipe.transform.rotation !== DEFAULT_IMAGE_EDIT_RECIPE.transform.rotation ||
    recipe.transform.flipHorizontal !== DEFAULT_IMAGE_EDIT_RECIPE.transform.flipHorizontal ||
    recipe.transform.flipVertical !== DEFAULT_IMAGE_EDIT_RECIPE.transform.flipVertical ||
    recipe.crop.enabled ||
    recipe.resize.enabled ||
    recipe.effects.sharpen !== DEFAULT_IMAGE_EDIT_RECIPE.effects.sharpen ||
    recipe.effects.blur !== DEFAULT_IMAGE_EDIT_RECIPE.effects.blur
  );
};

export const buildImageEditFilter = (
  recipeOrAdjustments: Partial<ImageEditRecipe> | Partial<ImageAdjustments>,
): string => {
  const recipe = normalizeImageEditRecipe(recipeOrAdjustments);
  const filters = [buildImageAdjustmentFilter(recipe.adjustments)];
  if (recipe.effects.blur > 0) {
    filters.push(`blur(${recipe.effects.blur}px)`);
  }
  return filters.join(' ');
};

export const normalizeImageEditorBounds = (
  bounds: Partial<ImageEditorObject['bounds']> | undefined,
  canvasDimensions?: { width: number; height: number },
): ImageEditorObject['bounds'] => {
  const maxWidth = Math.max(1, canvasDimensions?.width || MAX_OUTPUT_DIMENSION);
  const maxHeight = Math.max(1, canvasDimensions?.height || MAX_OUTPUT_DIMENSION);
  const width = clampInteger(bounds?.width ?? 1, 1, maxWidth, 1);
  const height = clampInteger(bounds?.height ?? 1, 1, maxHeight, 1);
  return {
    x: clampInteger(bounds?.x ?? 0, 0, Math.max(0, maxWidth - width), 0),
    y: clampInteger(bounds?.y ?? 0, 0, Math.max(0, maxHeight - height), 0),
    width,
    height,
  };
};

export const normalizeImageEditorBackground = (
  background?: Partial<ImageEditorBackground>,
): ImageEditorBackground => ({
  kind: background?.kind === 'color' || background?.kind === 'gradient' || background?.kind === 'transparent'
    ? background.kind
    : DEFAULT_IMAGE_EDITOR_BACKGROUND.kind,
  color: background?.color || DEFAULT_IMAGE_EDITOR_BACKGROUND.color,
  gradientFrom: background?.gradientFrom || DEFAULT_IMAGE_EDITOR_BACKGROUND.gradientFrom,
  gradientTo: background?.gradientTo || DEFAULT_IMAGE_EDITOR_BACKGROUND.gradientTo,
  margin: clampInteger(background?.margin ?? DEFAULT_IMAGE_EDITOR_BACKGROUND.margin, 0, 2000, DEFAULT_IMAGE_EDITOR_BACKGROUND.margin),
  padding: clampInteger(background?.padding ?? DEFAULT_IMAGE_EDITOR_BACKGROUND.padding, 0, 2000, DEFAULT_IMAGE_EDITOR_BACKGROUND.padding),
  smartPadding: Boolean(background?.smartPadding),
  roundedCorner: clampInteger(background?.roundedCorner ?? DEFAULT_IMAGE_EDITOR_BACKGROUND.roundedCorner, 0, 500, DEFAULT_IMAGE_EDITOR_BACKGROUND.roundedCorner),
  shadowRadius: clampInteger(background?.shadowRadius ?? DEFAULT_IMAGE_EDITOR_BACKGROUND.shadowRadius, 0, 500, DEFAULT_IMAGE_EDITOR_BACKGROUND.shadowRadius),
});

export const normalizeImageEditorObject = (
  object: Partial<ImageEditorObject>,
  canvasDimensions?: { width: number; height: number },
): ImageEditorObject | null => {
  const allowedTypes: ImageEditorObject['type'][] = [
    'rectangle',
    'ellipse',
    'line',
    'arrow',
    'freehand',
    'text',
    'step',
    'highlight',
    'blur',
    'pixelate',
    'spotlight',
    'magnify',
  ];
  if (!object.id || !object.type || !allowedTypes.includes(object.type)) {
    return null;
  }

  return {
    id: object.id,
    type: object.type,
    bounds: normalizeImageEditorBounds(object.bounds, canvasDimensions),
    points: Array.isArray(object.points)
      ? object.points
          .map((point) => ({
            x: clampInteger(point.x, 0, canvasDimensions?.width || MAX_OUTPUT_DIMENSION, 0),
            y: clampInteger(point.y, 0, canvasDimensions?.height || MAX_OUTPUT_DIMENSION, 0),
          }))
      : undefined,
    text: object.text || '',
    stepNumber: Number.isFinite(object.stepNumber) ? Math.max(1, Math.round(object.stepNumber || 1)) : undefined,
    zIndex: Number.isFinite(object.zIndex) ? Math.round(object.zIndex || 0) : 0,
    style: {
      strokeColor: object.style?.strokeColor || DEFAULT_IMAGE_EDITOR_OBJECT_STYLE.strokeColor,
      fillColor: object.style?.fillColor || DEFAULT_IMAGE_EDITOR_OBJECT_STYLE.fillColor,
      textColor: object.style?.textColor || DEFAULT_IMAGE_EDITOR_OBJECT_STYLE.textColor,
      strokeWidth: clampInteger(object.style?.strokeWidth ?? DEFAULT_IMAGE_EDITOR_OBJECT_STYLE.strokeWidth, 1, 80, DEFAULT_IMAGE_EDITOR_OBJECT_STYLE.strokeWidth),
      fontSize: clampInteger(object.style?.fontSize ?? DEFAULT_IMAGE_EDITOR_OBJECT_STYLE.fontSize, 8, 240, DEFAULT_IMAGE_EDITOR_OBJECT_STYLE.fontSize),
      fontFamily: normalizeImageEditorFontFamily(object.style?.fontFamily),
      opacity: clampNumber(object.style?.opacity ?? DEFAULT_IMAGE_EDITOR_OBJECT_STYLE.opacity, 0, 1, DEFAULT_IMAGE_EDITOR_OBJECT_STYLE.opacity),
    },
  };
};

export const createImageEditorDocument = (
  source: {
    imageId: string;
    name: string;
    width: number;
    height: number;
  },
): ImageEditorDocument => ({
  sourceImageId: source.imageId,
  sourceName: source.name,
  sourceDimensions: {
    width: Math.max(1, Math.round(source.width || 1)),
    height: Math.max(1, Math.round(source.height || 1)),
  },
  canvasDimensions: {
    width: Math.max(1, Math.round(source.width || 1)),
    height: Math.max(1, Math.round(source.height || 1)),
  },
  recipe: normalizeImageEditRecipe(DEFAULT_IMAGE_EDIT_RECIPE, { width: source.width, height: source.height }),
  background: DEFAULT_IMAGE_EDITOR_BACKGROUND,
  objects: [],
  selectedObjectIds: [],
});

export const normalizeImageEditorDocument = (
  document: Partial<ImageEditorDocument>,
): ImageEditorDocument => {
  const sourceDimensions = {
    width: Math.max(1, Math.round(document.sourceDimensions?.width || document.canvasDimensions?.width || 1)),
    height: Math.max(1, Math.round(document.sourceDimensions?.height || document.canvasDimensions?.height || 1)),
  };
  const recipe = normalizeImageEditRecipe(document.recipe || DEFAULT_IMAGE_EDIT_RECIPE, sourceDimensions);
  const outputDimensions = getImageEditOutputDimensions(recipe, sourceDimensions);
  const canvasDimensions = {
    width: Math.max(1, Math.round(document.canvasDimensions?.width || outputDimensions.width)),
    height: Math.max(1, Math.round(document.canvasDimensions?.height || outputDimensions.height)),
  };
  const objects = (document.objects || [])
    .map((object) => normalizeImageEditorObject(object, canvasDimensions))
    .filter((object): object is ImageEditorObject => Boolean(object))
    .sort((left, right) => left.zIndex - right.zIndex);
  const objectIds = new Set(objects.map((object) => object.id));

  return {
    sourceImageId: document.sourceImageId || '',
    sourceName: document.sourceName || 'image.png',
    sourceDimensions,
    canvasDimensions,
    recipe,
    background: normalizeImageEditorBackground(document.background),
    objects,
    selectedObjectIds: (document.selectedObjectIds || []).filter((id) => objectIds.has(id)),
  };
};

export const hasImageEditorDocumentChanges = (
  document: Partial<ImageEditorDocument>,
): boolean => {
  const normalized = normalizeImageEditorDocument(document);
  const background = normalized.background;
  return (
    hasImageEditRecipeChanges(normalized.recipe) ||
    normalized.objects.length > 0 ||
    background.kind !== DEFAULT_IMAGE_EDITOR_BACKGROUND.kind ||
    background.margin !== DEFAULT_IMAGE_EDITOR_BACKGROUND.margin ||
    background.padding !== DEFAULT_IMAGE_EDITOR_BACKGROUND.padding ||
    background.smartPadding !== DEFAULT_IMAGE_EDITOR_BACKGROUND.smartPadding ||
    background.roundedCorner !== DEFAULT_IMAGE_EDITOR_BACKGROUND.roundedCorner ||
    background.shadowRadius !== DEFAULT_IMAGE_EDITOR_BACKGROUND.shadowRadius
  );
};

const loadImageElement = (sourceUrl: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Failed to load image for editing.'));
  image.decoding = 'async';
  image.src = sourceUrl;
});

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) {
      resolve(blob);
    } else {
      reject(new Error('Failed to encode edited image as PNG.'));
    }
  }, 'image/png');
});

export async function renderAdjustedImageToPngBlob(
  sourceUrl: string,
  adjustments: Partial<ImageAdjustments>,
): Promise<Blob> {
  return renderEditedImageToPngBlob(sourceUrl, { adjustments: normalizeImageAdjustments(adjustments) });
}

const applySharpen = (context: CanvasRenderingContext2D, width: number, height: number, amount: number): void => {
  if (amount <= 0 || width <= 1 || height <= 1 || typeof context.getImageData !== 'function') {
    return;
  }

  const strength = amount / 100;
  const imageData = context.getImageData(0, 0, width, height);
  const source = imageData.data;
  const output = new Uint8ClampedArray(source);
  const centerWeight = 1 + (4 * strength);
  const sideWeight = -strength;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const value =
          source[index + channel] * centerWeight +
          source[index - 4 + channel] * sideWeight +
          source[index + 4 + channel] * sideWeight +
          source[index - (width * 4) + channel] * sideWeight +
          source[index + (width * 4) + channel] * sideWeight;
        output[index + channel] = Math.min(255, Math.max(0, Math.round(value)));
      }
    }
  }

  imageData.data.set(output);
  context.putImageData(imageData, 0, 0);
};

export async function renderEditedImageToPngBlob(
  sourceUrl: string,
  recipeOrAdjustments: Partial<ImageEditRecipe> | Partial<ImageAdjustments>,
): Promise<Blob> {
  const image = await loadImageElement(sourceUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  if (!width || !height) {
    throw new Error('Edited image has invalid dimensions.');
  }

  const recipe = normalizeImageEditRecipe(recipeOrAdjustments, { width, height });
  const sourceRect = getRecipeSourceRect(recipe, { width, height });
  const baseDimensions = getRecipeBaseOutputDimensions(recipe, { width, height });
  const outputDimensions = recipe.resize.enabled
    ? { width: recipe.resize.width, height: recipe.resize.height }
    : baseDimensions;

  const canvas = document.createElement('canvas');
  canvas.width = outputDimensions.width;
  canvas.height = outputDimensions.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas rendering is not available in this browser.');
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.filter = buildImageEditFilter(recipe);
  context.translate(outputDimensions.width / 2, outputDimensions.height / 2);
  context.rotate((recipe.transform.rotation * Math.PI) / 180);
  context.scale(recipe.transform.flipHorizontal ? -1 : 1, recipe.transform.flipVertical ? -1 : 1);

  const drawWidth = recipe.transform.rotation === 90 || recipe.transform.rotation === 270
    ? outputDimensions.height
    : outputDimensions.width;
  const drawHeight = recipe.transform.rotation === 90 || recipe.transform.rotation === 270
    ? outputDimensions.width
    : outputDimensions.height;

  context.drawImage(
    image,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    -drawWidth / 2,
    -drawHeight / 2,
    drawWidth,
    drawHeight,
  );

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.filter = 'none';
  applySharpen(context, outputDimensions.width, outputDimensions.height, recipe.effects.sharpen);
  return canvasToBlob(canvas);
}

export async function renderAdjustedImageToPngBytes(
  sourceUrl: string,
  adjustments: Partial<ImageAdjustments>,
): Promise<Uint8Array> {
  const blob = await renderEditedImageToPngBlob(sourceUrl, { adjustments: normalizeImageAdjustments(adjustments) });
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }

  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read edited PNG bytes.'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read edited PNG bytes.'));
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buffer);
}

export async function renderEditedImageToPngBytes(
  sourceUrl: string,
  recipeOrAdjustments: Partial<ImageEditRecipe> | Partial<ImageAdjustments>,
): Promise<Uint8Array> {
  const blob = await renderEditedImageToPngBlob(sourceUrl, recipeOrAdjustments);
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }

  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read edited PNG bytes.'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read edited PNG bytes.'));
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buffer);
}

const loadImageFromBlob = (blob: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Failed to load rendered editor image.'));
  };
  image.decoding = 'async';
  image.src = url;
});

const roundedRectPath = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  const resolvedRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + resolvedRadius, y);
  context.lineTo(x + width - resolvedRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + resolvedRadius);
  context.lineTo(x + width, y + height - resolvedRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - resolvedRadius, y + height);
  context.lineTo(x + resolvedRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - resolvedRadius);
  context.lineTo(x, y + resolvedRadius);
  context.quadraticCurveTo(x, y, x + resolvedRadius, y);
  context.closePath();
};

const drawArrowHead = (
  context: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  size: number,
) => {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  context.beginPath();
  context.moveTo(toX, toY);
  context.lineTo(toX - size * Math.cos(angle - Math.PI / 6), toY - size * Math.sin(angle - Math.PI / 6));
  context.lineTo(toX - size * Math.cos(angle + Math.PI / 6), toY - size * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fill();
};

const drawPixelatedRegion = (
  context: CanvasRenderingContext2D,
  bounds: ImageEditorObject['bounds'],
  pixelSize: number,
) => {
  const scratch = document.createElement('canvas');
  const scratchContext = scratch.getContext('2d');
  if (!scratchContext) {
    return;
  }
  const smallWidth = Math.max(1, Math.round(bounds.width / pixelSize));
  const smallHeight = Math.max(1, Math.round(bounds.height / pixelSize));
  scratch.width = smallWidth;
  scratch.height = smallHeight;
  scratchContext.imageSmoothingEnabled = false;
  scratchContext.drawImage(context.canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, smallWidth, smallHeight);
  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(scratch, 0, 0, smallWidth, smallHeight, bounds.x, bounds.y, bounds.width, bounds.height);
  context.restore();
};

const drawEditorObject = (
  context: CanvasRenderingContext2D,
  object: ImageEditorObject,
) => {
  const { bounds, style } = object;
  context.save();
  context.globalAlpha = style.opacity;
  context.strokeStyle = style.strokeColor;
  context.fillStyle = style.fillColor;
  context.lineWidth = style.strokeWidth;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (object.type === 'blur') {
    const scratch = document.createElement('canvas');
    const scratchContext = scratch.getContext('2d');
    if (scratchContext) {
      scratch.width = bounds.width;
      scratch.height = bounds.height;
      scratchContext.filter = `blur(${Math.max(4, style.strokeWidth * 2)}px)`;
      scratchContext.drawImage(context.canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
      context.drawImage(scratch, bounds.x, bounds.y);
    }
    context.restore();
    return;
  }

  if (object.type === 'pixelate') {
    drawPixelatedRegion(context, bounds, Math.max(6, style.strokeWidth * 3));
    context.restore();
    return;
  }

  if (object.type === 'spotlight') {
    context.fillStyle = 'rgba(0, 0, 0, 0.48)';
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    context.globalCompositeOperation = 'destination-out';
    context.beginPath();
    context.ellipse(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width / 2, bounds.height / 2, 0, 0, Math.PI * 2);
    context.fill();
    context.globalCompositeOperation = 'source-over';
    context.strokeStyle = style.strokeColor;
    context.stroke();
    context.restore();
    return;
  }

  if (object.type === 'magnify') {
    context.save();
    context.beginPath();
    context.ellipse(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width / 2, bounds.height / 2, 0, 0, Math.PI * 2);
    context.clip();
    context.drawImage(
      context.canvas,
      bounds.x + bounds.width * 0.2,
      bounds.y + bounds.height * 0.2,
      bounds.width * 0.6,
      bounds.height * 0.6,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
    );
    context.restore();
    context.beginPath();
    context.ellipse(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width / 2, bounds.height / 2, 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();
    return;
  }

  if (object.type === 'rectangle' || object.type === 'highlight') {
    context.fillStyle = object.type === 'highlight' ? 'rgba(250, 204, 21, 0.28)' : style.fillColor;
    context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    if (object.type === 'rectangle') {
      context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }
  } else if (object.type === 'ellipse') {
    context.beginPath();
    context.ellipse(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width / 2, bounds.height / 2, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  } else if (object.type === 'line' || object.type === 'arrow') {
    const start = object.points?.[0] ?? { x: bounds.x, y: bounds.y };
    const end = object.points?.[1] ?? { x: bounds.x + bounds.width, y: bounds.y + bounds.height };
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    if (object.type === 'arrow') {
      context.fillStyle = style.strokeColor;
      drawArrowHead(context, start.x, start.y, end.x, end.y, Math.max(12, style.strokeWidth * 4));
    }
  } else if (object.type === 'freehand' && object.points && object.points.length > 1) {
    context.beginPath();
    context.moveTo(object.points[0].x, object.points[0].y);
    object.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.stroke();
  } else if (object.type === 'text') {
    context.fillStyle = style.textColor;
    context.font = `${style.fontSize}px ${style.fontFamily}`;
    context.fillText(object.text || 'Text', bounds.x, bounds.y + style.fontSize);
  } else if (object.type === 'step') {
    const radius = Math.max(16, Math.min(bounds.width, bounds.height) / 2);
    context.fillStyle = style.strokeColor;
    context.beginPath();
    context.arc(bounds.x + radius, bounds.y + radius, radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = style.textColor;
    context.font = `700 ${Math.round(radius)}px ${style.fontFamily}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(object.stepNumber || 1), bounds.x + radius, bounds.y + radius + 1);
  }

  context.restore();
};

const drawImageEditorBackground = (
  context: CanvasRenderingContext2D,
  background: ImageEditorBackground,
  width: number,
  height: number,
) => {
  if (background.kind === 'transparent') {
    return;
  }

  if (background.kind === 'gradient') {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, background.gradientFrom);
    gradient.addColorStop(1, background.gradientTo);
    context.fillStyle = gradient;
  } else {
    context.fillStyle = background.color;
  }
  context.fillRect(0, 0, width, height);
};

export async function renderImageEditorDocumentToPngBlob(
  sourceUrl: string,
  editorDocument: Partial<ImageEditorDocument>,
): Promise<Blob> {
  const normalized = normalizeImageEditorDocument(editorDocument);
  const baseBlob = await renderEditedImageToPngBlob(sourceUrl, normalized.recipe);
  const baseImage = await loadImageFromBlob(baseBlob);
  const background = normalized.background;
  const spacing = background.padding + (background.smartPadding ? Math.round(Math.min(baseImage.width, baseImage.height) * 0.06) : 0);
  const outerMargin = background.margin;
  const contentX = outerMargin + spacing;
  const contentY = outerMargin + spacing;
  const canvas = document.createElement('canvas');
  canvas.width = baseImage.width + (outerMargin + spacing) * 2;
  canvas.height = baseImage.height + (outerMargin + spacing) * 2;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas rendering is not available in this browser.');
  }

  drawImageEditorBackground(context, background, canvas.width, canvas.height);
  context.save();
  if (background.shadowRadius > 0) {
    context.shadowColor = 'rgba(0, 0, 0, 0.42)';
    context.shadowBlur = background.shadowRadius;
    context.shadowOffsetY = Math.round(background.shadowRadius / 3);
  }
  if (background.roundedCorner > 0) {
    roundedRectPath(context, contentX, contentY, baseImage.width, baseImage.height, background.roundedCorner);
    context.clip();
  }
  context.drawImage(baseImage, contentX, contentY);
  context.restore();

  if (contentX || contentY) {
    context.translate(contentX, contentY);
  }
  normalized.objects.forEach((object) => drawEditorObject(context, object));
  if (contentX || contentY) {
    context.setTransform(1, 0, 0, 1, 0, 0);
  }

  return canvasToBlob(canvas);
}

export async function renderImageEditorDocumentToPngBytes(
  sourceUrl: string,
  document: Partial<ImageEditorDocument>,
): Promise<Uint8Array> {
  const blob = await renderImageEditorDocumentToPngBlob(sourceUrl, document);
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }

  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read edited PNG bytes.'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read edited PNG bytes.'));
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buffer);
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const createCrc32Table = () => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
};

const CRC32_TABLE = createCrc32Table();
const textEncoder = new TextEncoder();

const computeCrc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const concatBytes = (parts: Uint8Array[]): Uint8Array => {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};

const writeUInt32BE = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value >>> 0, false);
  return bytes;
};

const createPngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = textEncoder.encode(type);
  const crcBytes = concatBytes([typeBytes, data]);
  return concatBytes([
    writeUInt32BE(data.byteLength),
    typeBytes,
    data,
    writeUInt32BE(computeCrc32(crcBytes)),
  ]);
};

const createPngTextChunk = (keyword: string, text: string): Uint8Array => (
  createPngChunk('tEXt', concatBytes([
    textEncoder.encode(keyword),
    new Uint8Array([0]),
    textEncoder.encode(text),
  ]))
);

const createPngInternationalTextChunk = (keyword: string, text: string): Uint8Array => (
  createPngChunk('iTXt', concatBytes([
    textEncoder.encode(keyword),
    new Uint8Array([0, 0, 0, 0, 0]),
    textEncoder.encode(text),
  ]))
);

const ensurePngBytes = (pngBytes: Uint8Array): void => {
  if (pngBytes.byteLength < PNG_SIGNATURE.byteLength + 12) {
    throw new Error('Invalid PNG buffer.');
  }

  for (let index = 0; index < PNG_SIGNATURE.byteLength; index += 1) {
    if (pngBytes[index] !== PNG_SIGNATURE[index]) {
      throw new Error('PNG signature missing.');
    }
  }
};

export const appendChunksToPngBytes = (pngBytes: Uint8Array, chunks: Uint8Array[]): Uint8Array => {
  ensurePngBytes(pngBytes);

  let offset = PNG_SIGNATURE.byteLength;
  while (offset + 12 <= pngBytes.byteLength) {
    const view = new DataView(pngBytes.buffer, pngBytes.byteOffset + offset, 8);
    const chunkLength = view.getUint32(0, false);
    const chunkType = String.fromCharCode(
      pngBytes[offset + 4],
      pngBytes[offset + 5],
      pngBytes[offset + 6],
      pngBytes[offset + 7],
    );
    const chunkTotalLength = chunkLength + 12;
    if (offset + chunkTotalLength > pngBytes.byteLength) {
      break;
    }

    if (chunkType === 'IEND') {
      return concatBytes([
        pngBytes.slice(0, offset),
        ...chunks,
        pngBytes.slice(offset),
      ]);
    }

    offset += chunkTotalLength;
  }

  throw new Error('PNG IEND chunk not found.');
};

const toLoraPayload = (loras: BaseMetadata['loras']) => {
  if (!Array.isArray(loras)) {
    return [];
  }

  return loras
    .map((entry) => {
      if (typeof entry === 'string') {
        const name = entry.trim();
        return name ? { name } : null;
      }

      const lora = entry as LoRAInfo;
      const name = typeof lora.name === 'string' && lora.name.trim()
        ? lora.name.trim()
        : (typeof lora.model_name === 'string' ? lora.model_name.trim() : '');
      if (!name) {
        return null;
      }

      const weight = Number.isFinite(lora.weight)
        ? lora.weight
        : Number.isFinite(lora.model_weight)
          ? lora.model_weight
          : undefined;

      return weight !== undefined ? { name, weight } : { name };
    })
    .filter(Boolean);
};

const formatMetadataForA1111Compat = (metadata: BaseMetadata): string => {
  const lines = [metadata.prompt?.trim() || ''];
  if (metadata.negativePrompt?.trim()) {
    lines.push(`Negative prompt: ${metadata.negativePrompt.trim()}`);
  }

  const params: string[] = [];
  if (Number.isFinite(metadata.steps)) {
    params.push(`Steps: ${metadata.steps}`);
  }
  const sampler = metadata.sampler || metadata.scheduler;
  if (sampler?.trim()) {
    params.push(`Sampler: ${sampler.trim()}`);
  }
  const cfg = metadata.cfg_scale ?? metadata.cfgScale;
  if (Number.isFinite(cfg)) {
    params.push(`CFG scale: ${cfg}`);
  }
  if (Number.isFinite(metadata.seed)) {
    params.push(`Seed: ${metadata.seed}`);
  }
  if (Number.isFinite(metadata.width) && Number.isFinite(metadata.height) && metadata.width > 0 && metadata.height > 0) {
    params.push(`Size: ${metadata.width}x${metadata.height}`);
  }
  if (metadata.model?.trim()) {
    params.push(`Model: ${metadata.model.trim()}`);
  }
  if (params.length > 0) {
    lines.push(params.join(', '));
  }

  return lines.join('\n');
};

const buildMetaHubEditPayload = (
  metadata: BaseMetadata,
  recipe: ImageEditRecipe,
  preservedWorkflow?: PreservedComfyWorkflow,
  outputDimensions?: { width: number; height: number },
  editInfo?: {
    tool?: string;
    annotationCount?: number;
    background?: ImageEditorBackground;
    sourceImageId?: string;
  },
) => {
  const payloadWidth = Number.isFinite(outputDimensions?.width)
    ? outputDimensions?.width
    : Number.isFinite(metadata.width)
      ? metadata.width
      : 0;
  const payloadHeight = Number.isFinite(outputDimensions?.height)
    ? outputDimensions?.height
    : Number.isFinite(metadata.height)
      ? metadata.height
      : 0;
  const payload: Record<string, unknown> = {
    generator: 'Image MetaHub',
    source_generator: typeof metadata.generator === 'string' ? metadata.generator : null,
    edited_at: new Date().toISOString(),
    edit: {
      tool: editInfo?.tool || 'image-editor-v2',
      recipe,
      output_dimensions: outputDimensions,
      annotation_count: editInfo?.annotationCount,
      background: editInfo?.background,
      source_image_id: editInfo?.sourceImageId,
    },
    prompt: metadata.prompt || '',
    negativePrompt: metadata.negativePrompt || '',
    seed: Number.isFinite(metadata.seed) ? metadata.seed : undefined,
    steps: Number.isFinite(metadata.steps) ? metadata.steps : undefined,
    cfg: Number.isFinite(metadata.cfg_scale ?? metadata.cfgScale) ? (metadata.cfg_scale ?? metadata.cfgScale) : undefined,
    sampler_name: metadata.sampler || '',
    scheduler: metadata.scheduler || '',
    model: metadata.model || metadata.models?.[0] || '',
    width: payloadWidth,
    height: payloadHeight,
    loras: toLoraPayload(metadata.loras),
    imh_pro: {
      notes: typeof metadata.notes === 'string' ? metadata.notes : '',
      user_tags: Array.isArray(metadata.tags) ? metadata.tags.join(', ') : '',
    },
  };

  if (preservedWorkflow?.workflow !== undefined) {
    payload.workflow = preservedWorkflow.workflow;
  }
  if (preservedWorkflow?.prompt !== undefined) {
    payload.prompt_api = preservedWorkflow.prompt;
  }

  return payload;
};

type PreservedComfyWorkflow = {
  workflow?: unknown;
  prompt?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const parseMaybeRecord = (value: unknown): Record<string, unknown> | null => {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const stringifyPngTextValue = (value: unknown): string => (
  typeof value === 'string' ? value : JSON.stringify(value)
);

const extractPreservedComfyWorkflow = (
  rawMetadata?: Record<string, unknown>,
): PreservedComfyWorkflow | undefined => {
  if (!rawMetadata) {
    return undefined;
  }

  const metaHubPayload = parseMaybeRecord(rawMetadata.imagemetahub_data);
  const workflow = metaHubPayload?.workflow ?? rawMetadata.workflow;
  const prompt = metaHubPayload?.prompt_api ?? metaHubPayload?.prompt ?? rawMetadata.prompt_api ?? rawMetadata.prompt;

  if (workflow === undefined && prompt === undefined) {
    return undefined;
  }

  return { workflow, prompt };
};

export const embedMetaHubMetadataInPngBytes = (
  pngBytes: Uint8Array,
  metadata: BaseMetadata | undefined,
  recipeOrAdjustments: Partial<ImageEditRecipe> | Partial<ImageAdjustments>,
  rawMetadata?: Record<string, unknown>,
  outputDimensions?: { width: number; height: number },
  editInfo?: {
    tool?: string;
    annotationCount?: number;
    background?: ImageEditorBackground;
    sourceImageId?: string;
  },
): Uint8Array => {
  const preservedWorkflow = extractPreservedComfyWorkflow(rawMetadata);
  if (!metadata && !preservedWorkflow) {
    return pngBytes;
  }

  const normalizedRecipe = normalizeImageEditRecipe(recipeOrAdjustments);
  const chunks: Uint8Array[] = [];

  if (metadata) {
    chunks.push(
      createPngTextChunk('parameters', formatMetadataForA1111Compat(metadata)),
      createPngInternationalTextChunk(
        'imagemetahub_data',
        JSON.stringify(buildMetaHubEditPayload(metadata, normalizedRecipe, preservedWorkflow, outputDimensions, editInfo)),
      ),
    );
  }

  if (preservedWorkflow?.workflow !== undefined) {
    chunks.push(createPngTextChunk('workflow', stringifyPngTextValue(preservedWorkflow.workflow)));
  }
  if (preservedWorkflow?.prompt !== undefined) {
    chunks.push(createPngTextChunk('prompt', stringifyPngTextValue(preservedWorkflow.prompt)));
  }

  return appendChunksToPngBytes(pngBytes, chunks);
};

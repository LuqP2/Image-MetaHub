import React from 'react';
import {
  Crop,
  FlipHorizontal,
  FlipVertical,
  Maximize2,
  RotateCcw,
  RotateCw,
  Save,
  SaveAll,
  Sparkles,
} from 'lucide-react';
import type {
  ImageAdjustments,
  ImageEditCropAspect,
  ImageEditRecipe,
} from '../types';
import {
  CROP_ASPECTS,
  DEFAULT_IMAGE_EDIT_RECIPE,
  clampImageAdjustment,
  clampImageEditCropRect,
  clampImageEditEffect,
  createDefaultCropRect,
  getRecipeBaseOutputDimensions,
  getImageEditOutputDimensions,
  hasImageEditRecipeChanges,
  normalizeImageEditRecipe,
  normalizeImageEditRotation,
} from '../services/imageEditingService';

type EditorTab = 'adjust' | 'crop' | 'transform' | 'enhance';

interface ImageAdjustmentPanelProps {
  recipe: ImageEditRecipe;
  onChange: (recipe: ImageEditRecipe) => void;
  onReset: () => void;
  onSaveAs: () => void;
  onOverwrite: () => void;
  sourceDimensions?: { width: number; height: number };
  activeTab?: EditorTab;
  onActiveTabChange?: (tab: EditorTab) => void;
  canOverwrite?: boolean;
  overwriteUnavailableReason?: string;
  isSaving?: boolean;
  disabled?: boolean;
  onAIUpscale?: () => void;
  canAIUpscale?: boolean;
  aiUpscaleDisabledReason?: string;
  isAIUpscaling?: boolean;
}

const ADJUSTMENT_CONTROLS: Array<{
  key: keyof ImageAdjustments;
  label: string;
  min: number;
  max: number;
  unit: string;
}> = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 200, unit: '%' },
  { key: 'contrast', label: 'Contrast', min: 0, max: 200, unit: '%' },
  { key: 'saturation', label: 'Saturation', min: 0, max: 200, unit: '%' },
  { key: 'hue', label: 'Hue', min: -180, max: 180, unit: 'deg' },
];

const TABS: Array<{ key: EditorTab; label: string }> = [
  { key: 'adjust', label: 'Adjust' },
  { key: 'crop', label: 'Crop' },
  { key: 'transform', label: 'Transform' },
  { key: 'enhance', label: 'Enhance' },
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

const ImageAdjustmentPanel: React.FC<ImageAdjustmentPanelProps> = ({
  recipe,
  onChange,
  onReset,
  onSaveAs,
  onOverwrite,
  sourceDimensions,
  activeTab = 'adjust',
  onActiveTabChange,
  canOverwrite = true,
  overwriteUnavailableReason = 'Overwrite original file',
  isSaving = false,
  disabled = false,
  onAIUpscale,
  canAIUpscale = true,
  aiUpscaleDisabledReason = 'Connect ComfyUI to use AI Upscale.',
  isAIUpscaling = false,
}) => {
  const normalizedRecipe = normalizeImageEditRecipe(recipe, sourceDimensions);
  const hasChanges = hasImageEditRecipeChanges(normalizedRecipe);
  const controlsDisabled = disabled || isSaving;
  const overwriteDisabled = controlsDisabled || !hasChanges || !canOverwrite;
  const cropRect = normalizedRecipe.crop.rect;
  const outputDimensions = sourceDimensions
    ? getImageEditOutputDimensions(normalizedRecipe, sourceDimensions)
    : null;
  const baseOutputDimensions = sourceDimensions
    ? getRecipeBaseOutputDimensions(normalizedRecipe, sourceDimensions)
    : null;

  const emit = (nextRecipe: ImageEditRecipe) => {
    onChange(normalizeImageEditRecipe(nextRecipe, sourceDimensions));
  };

  const updateAdjustment = (key: keyof ImageAdjustments, rawValue: number) => {
    emit({
      ...normalizedRecipe,
      adjustments: {
        ...normalizedRecipe.adjustments,
        [key]: clampImageAdjustment(key, rawValue),
      },
    });
  };

  const setCropAspect = (aspect: ImageEditCropAspect) => {
    const rect = normalizedRecipe.crop.enabled
      ? createDefaultCropRect(sourceDimensions, aspect)
      : normalizedRecipe.crop.rect;
    emit({
      ...normalizedRecipe,
      crop: {
        enabled: normalizedRecipe.crop.enabled,
        aspect,
        rect,
      },
    });
  };

  const setCropEnabled = (enabled: boolean) => {
    emit({
      ...normalizedRecipe,
      crop: {
        ...normalizedRecipe.crop,
        enabled,
        rect: enabled
          ? normalizedRecipe.crop.rect || createDefaultCropRect(sourceDimensions, normalizedRecipe.crop.aspect)
          : normalizedRecipe.crop.rect,
      },
    });
  };

  const updateCropValue = (key: 'x' | 'y' | 'width' | 'height', value: number) => {
    emit({
      ...normalizedRecipe,
      crop: {
        ...normalizedRecipe.crop,
        enabled: true,
        rect: clampImageEditCropRect({
          ...(cropRect || createDefaultCropRect(sourceDimensions, normalizedRecipe.crop.aspect) || { x: 0, y: 0, width: 1, height: 1 }),
          [key]: value,
        }, sourceDimensions),
      },
    });
  };

  const updateResizeDimension = (key: 'width' | 'height', value: number) => {
    const nextValue = Math.max(1, Math.round(value) || 1);
    const base = baseOutputDimensions || sourceDimensions || { width: 1, height: 1 };
    let width = key === 'width' ? nextValue : normalizedRecipe.resize.width || base.width;
    let height = key === 'height' ? nextValue : normalizedRecipe.resize.height || base.height;
    if (normalizedRecipe.resize.lockAspectRatio && base.width > 0 && base.height > 0) {
      const ratio = base.width / base.height;
      if (key === 'width') {
        height = Math.max(1, Math.round(width / ratio));
      } else {
        width = Math.max(1, Math.round(height * ratio));
      }
    }

    emit({
      ...normalizedRecipe,
      resize: {
        ...normalizedRecipe.resize,
        enabled: true,
        width,
        height,
      },
    });
  };

  const setResizeEnabled = (enabled: boolean) => {
    const base = baseOutputDimensions || sourceDimensions || { width: 1, height: 1 };
    const shouldSeedFromBase = enabled && !normalizedRecipe.resize.enabled;
    emit({
      ...normalizedRecipe,
      resize: {
        ...normalizedRecipe.resize,
        enabled,
        width: shouldSeedFromBase ? base.width : normalizedRecipe.resize.width,
        height: shouldSeedFromBase ? base.height : normalizedRecipe.resize.height,
      },
    });
  };

  const applyResizePreset = (scale: number) => {
    const base = baseOutputDimensions || sourceDimensions;
    if (!base) {
      return;
    }
    emit({
      ...normalizedRecipe,
      resize: {
        ...normalizedRecipe.resize,
        enabled: scale !== 1,
        width: Math.max(1, Math.round(base.width * scale)),
        height: Math.max(1, Math.round(base.height * scale)),
      },
    });
  };

  return (
    <div className="space-y-4 rounded-lg border border-cyan-500/20 bg-gray-950/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">Edit</h3>
          <p className="text-xs text-gray-500">
            PNG output{outputDimensions ? ` · ${outputDimensions.width}x${outputDimensions.height}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={controlsDisabled || !hasChanges}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs font-medium text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          title="Reset edits"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1 rounded-lg border border-gray-800 bg-gray-900/70 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onActiveTabChange?.(tab.key)}
            className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-cyan-500/20 text-cyan-100'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'adjust' && (
        <div className="space-y-3">
          {ADJUSTMENT_CONTROLS.map((control) => (
            <label key={control.key} className="block space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-gray-300">{control.label}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={control.min}
                    max={control.max}
                    value={normalizedRecipe.adjustments[control.key]}
                    disabled={controlsDisabled}
                    onChange={(event) => updateAdjustment(control.key, Number(event.target.value))}
                    className="h-7 w-16 rounded-md border border-gray-700 bg-gray-900 px-2 text-right text-xs text-gray-100 outline-none transition-colors focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={control.label}
                  />
                  <span className="w-7 text-xs text-gray-500">{control.unit}</span>
                </div>
              </div>
              <input
                type="range"
                aria-label={`${control.label} slider`}
                min={control.min}
                max={control.max}
                value={normalizedRecipe.adjustments[control.key]}
                disabled={controlsDisabled}
                onChange={(event) => updateAdjustment(control.key, Number(event.target.value))}
                className="w-full accent-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
          ))}
        </div>
      )}

      {activeTab === 'crop' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-300">
              <input
                type="checkbox"
                checked={normalizedRecipe.crop.enabled}
                disabled={controlsDisabled || !sourceDimensions}
                onChange={(event) => setCropEnabled(event.target.checked)}
                className="h-4 w-4 accent-cyan-500"
              />
              Enable crop
            </label>
            <select
              value={normalizedRecipe.crop.aspect}
              disabled={controlsDisabled || !sourceDimensions}
              onChange={(event) => setCropAspect(event.target.value as ImageEditCropAspect)}
              className="h-8 rounded-md border border-gray-700 bg-gray-900 px-2 text-xs text-gray-100 outline-none focus:border-cyan-500"
              aria-label="Crop aspect ratio"
            >
              {CROP_ASPECTS.map((aspect) => (
                <option key={aspect} value={aspect}>{ASPECT_LABELS[aspect]}</option>
              ))}
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
                  disabled={controlsDisabled || !normalizedRecipe.crop.enabled}
                  onChange={(event) => updateCropValue(key, Number(event.target.value))}
                  className="h-8 w-full rounded-md border border-gray-700 bg-gray-900 px-2 text-right text-xs text-gray-100 outline-none focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={`Crop ${key}`}
                />
              </label>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setCropEnabled(true)}
              disabled={controlsDisabled || !sourceDimensions}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-medium text-gray-300 hover:border-gray-600 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Crop className="h-3.5 w-3.5" />
              Center Crop
            </button>
            <button
              type="button"
              onClick={() => emit({ ...normalizedRecipe, crop: { ...normalizedRecipe.crop, enabled: false, rect: null } })}
              disabled={controlsDisabled || !normalizedRecipe.crop.enabled}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-medium text-gray-300 hover:border-gray-600 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Full Image
            </button>
          </div>
          <p className="text-xs text-gray-500">Drag the crop box on the image to reposition it.</p>
        </div>
      )}

      {activeTab === 'transform' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => emit({ ...normalizedRecipe, transform: { ...normalizedRecipe.transform, rotation: normalizeImageEditRotation(normalizedRecipe.transform.rotation - 90) } })}
              disabled={controlsDisabled}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-700 bg-gray-900 px-2 py-2 text-xs font-medium text-gray-300 hover:border-gray-600 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Rotate Left
            </button>
            <button
              type="button"
              onClick={() => emit({ ...normalizedRecipe, transform: { ...normalizedRecipe.transform, rotation: normalizeImageEditRotation(normalizedRecipe.transform.rotation + 90) } })}
              disabled={controlsDisabled}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-700 bg-gray-900 px-2 py-2 text-xs font-medium text-gray-300 hover:border-gray-600 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Rotate Right
            </button>
            <button
              type="button"
              onClick={() => emit({ ...normalizedRecipe, transform: { ...normalizedRecipe.transform, flipHorizontal: !normalizedRecipe.transform.flipHorizontal } })}
              disabled={controlsDisabled}
              className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                normalizedRecipe.transform.flipHorizontal ? 'border-cyan-400/40 bg-cyan-500/20 text-cyan-100' : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600 hover:bg-gray-800'
              }`}
            >
              <FlipHorizontal className="h-3.5 w-3.5" />
              Flip H
            </button>
            <button
              type="button"
              onClick={() => emit({ ...normalizedRecipe, transform: { ...normalizedRecipe.transform, flipVertical: !normalizedRecipe.transform.flipVertical } })}
              disabled={controlsDisabled}
              className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                normalizedRecipe.transform.flipVertical ? 'border-cyan-400/40 bg-cyan-500/20 text-cyan-100' : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600 hover:bg-gray-800'
              }`}
            >
              <FlipVertical className="h-3.5 w-3.5" />
              Flip V
            </button>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-300">
                <input
                  type="checkbox"
                  checked={normalizedRecipe.resize.enabled}
                  disabled={controlsDisabled || !sourceDimensions}
                  onChange={(event) => setResizeEnabled(event.target.checked)}
                  className="h-4 w-4 accent-cyan-500"
                />
                Resize
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                <input
                  type="checkbox"
                  checked={normalizedRecipe.resize.lockAspectRatio}
                  disabled={controlsDisabled || !sourceDimensions}
                  onChange={(event) => emit({ ...normalizedRecipe, resize: { ...normalizedRecipe.resize, lockAspectRatio: event.target.checked } })}
                  className="h-4 w-4 accent-cyan-500"
                />
                Lock
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-gray-400">
                <span>Width</span>
                <input
                  type="number"
                  min={1}
                  value={normalizedRecipe.resize.width}
                  disabled={controlsDisabled || !sourceDimensions}
                  onChange={(event) => updateResizeDimension('width', Number(event.target.value))}
                  className="h-8 w-full rounded-md border border-gray-700 bg-gray-900 px-2 text-right text-xs text-gray-100 outline-none focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Resize width"
                />
              </label>
              <label className="space-y-1 text-xs text-gray-400">
                <span>Height</span>
                <input
                  type="number"
                  min={1}
                  value={normalizedRecipe.resize.height}
                  disabled={controlsDisabled || !sourceDimensions}
                  onChange={(event) => updateResizeDimension('height', Number(event.target.value))}
                  className="h-8 w-full rounded-md border border-gray-700 bg-gray-900 px-2 text-right text-xs text-gray-100 outline-none focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Resize height"
                />
              </label>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1">
              {[0.5, 1, 2].map((scale) => (
                <button
                  key={scale}
                  type="button"
                  onClick={() => applyResizePreset(scale)}
                  disabled={controlsDisabled || !sourceDimensions}
                  className="rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs font-medium text-gray-300 hover:border-gray-600 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {Math.round(scale * 100)}%
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'enhance' && (
        <div className="space-y-4">
          {(['sharpen', 'blur'] as const).map((key) => (
            <label key={key} className="block space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium capitalize text-gray-300">{key}</span>
                <input
                  type="number"
                  min={0}
                  max={key === 'blur' ? 20 : 100}
                  value={normalizedRecipe.effects[key]}
                  disabled={controlsDisabled}
                  onChange={(event) => emit({
                    ...normalizedRecipe,
                    effects: {
                      ...normalizedRecipe.effects,
                      [key]: clampImageEditEffect(key, Number(event.target.value)),
                    },
                  })}
                  className="h-7 w-16 rounded-md border border-gray-700 bg-gray-900 px-2 text-right text-xs text-gray-100 outline-none transition-colors focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={key}
                />
              </div>
              <input
                type="range"
                aria-label={`${key} slider`}
                min={0}
                max={key === 'blur' ? 20 : 100}
                value={normalizedRecipe.effects[key]}
                disabled={controlsDisabled}
                onChange={(event) => emit({
                  ...normalizedRecipe,
                  effects: {
                    ...normalizedRecipe.effects,
                    [key]: clampImageEditEffect(key, Number(event.target.value)),
                  },
                })}
                className="w-full accent-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
          ))}

          <div className="rounded-lg border border-purple-500/20 bg-purple-500/10 p-2">
            <button
              type="button"
              onClick={onAIUpscale}
              disabled={controlsDisabled || isAIUpscaling || !canAIUpscale}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-purple-400/30 bg-purple-500/15 px-3 py-2 text-xs font-semibold text-purple-100 transition-colors hover:border-purple-300/50 hover:bg-purple-500/25 disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-gray-900 disabled:text-gray-600"
              title={canAIUpscale ? 'Queue a ComfyUI upscale workflow' : aiUpscaleDisabledReason}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isAIUpscaling ? 'Queueing...' : 'AI Upscale'}
            </button>
            <p className="mt-1.5 text-xs text-purple-200/70">ComfyUI transform</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onSaveAs}
          disabled={controlsDisabled || !hasChanges}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-gray-900 disabled:text-gray-600"
          title="Save edited copy"
        >
          <Save className="h-3.5 w-3.5" />
          Save As
        </button>
        <button
          type="button"
          onClick={onOverwrite}
          disabled={overwriteDisabled}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors hover:border-amber-400/50 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-gray-900 disabled:text-gray-600"
          title={canOverwrite ? 'Overwrite original file' : overwriteUnavailableReason}
        >
          <SaveAll className="h-3.5 w-3.5" />
          Overwrite
        </button>
      </div>

      {isSaving && <div className="text-xs text-gray-400">Saving edited image...</div>}
      {!hasChanges && (
        <div className="text-xs text-gray-500">
          Neutral: {DEFAULT_IMAGE_EDIT_RECIPE.adjustments.brightness}/{DEFAULT_IMAGE_EDIT_RECIPE.adjustments.contrast}/{DEFAULT_IMAGE_EDIT_RECIPE.adjustments.saturation}/{DEFAULT_IMAGE_EDIT_RECIPE.adjustments.hue}
        </div>
      )}
    </div>
  );
};

export default ImageAdjustmentPanel;

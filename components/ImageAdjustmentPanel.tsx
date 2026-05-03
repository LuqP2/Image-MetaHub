import React from 'react';
import { RotateCcw, Save, SaveAll } from 'lucide-react';
import type { ImageAdjustments } from '../types';
import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  clampImageAdjustment,
  hasImageAdjustments,
} from '../services/imageEditingService';

interface ImageAdjustmentPanelProps {
  adjustments: ImageAdjustments;
  onChange: (adjustments: ImageAdjustments) => void;
  onReset: () => void;
  onSaveAs: () => void;
  onOverwrite: () => void;
  isSaving?: boolean;
  disabled?: boolean;
}

const CONTROLS: Array<{
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

const ImageAdjustmentPanel: React.FC<ImageAdjustmentPanelProps> = ({
  adjustments,
  onChange,
  onReset,
  onSaveAs,
  onOverwrite,
  isSaving = false,
  disabled = false,
}) => {
  const hasChanges = hasImageAdjustments(adjustments);
  const controlsDisabled = disabled || isSaving;

  const updateAdjustment = (key: keyof ImageAdjustments, rawValue: number) => {
    onChange({
      ...adjustments,
      [key]: clampImageAdjustment(key, rawValue),
    });
  };

  return (
    <div className="space-y-4 rounded-lg border border-cyan-500/20 bg-gray-950/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">Adjust</h3>
          <p className="text-xs text-gray-500">PNG output</p>
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={controlsDisabled || !hasChanges}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs font-medium text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          title="Reset adjustments"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>

      <div className="space-y-3">
        {CONTROLS.map((control) => (
          <label key={control.key} className="block space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-300">{control.label}</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={control.min}
                  max={control.max}
                  value={adjustments[control.key]}
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
              value={adjustments[control.key]}
              disabled={controlsDisabled}
              onChange={(event) => updateAdjustment(control.key, Number(event.target.value))}
              className="w-full accent-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
        ))}
      </div>

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
          disabled={controlsDisabled || !hasChanges}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors hover:border-amber-400/50 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-gray-900 disabled:text-gray-600"
          title="Overwrite original file"
        >
          <SaveAll className="h-3.5 w-3.5" />
          Overwrite
        </button>
      </div>

      {isSaving && (
        <div className="text-xs text-gray-400">Saving edited image...</div>
      )}
      {!hasChanges && (
        <div className="text-xs text-gray-500">
          Neutral: {DEFAULT_IMAGE_ADJUSTMENTS.brightness}/{DEFAULT_IMAGE_ADJUSTMENTS.contrast}/{DEFAULT_IMAGE_ADJUSTMENTS.saturation}/{DEFAULT_IMAGE_ADJUSTMENTS.hue}
        </div>
      )}
    </div>
  );
};

export default ImageAdjustmentPanel;

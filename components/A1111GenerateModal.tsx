import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { IndexedImage } from '../types';

interface A1111GenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  image: IndexedImage;
  onGenerate: (params: GenerationParams) => Promise<void>;
  isGenerating: boolean;
}

export interface GenerationParams {
  prompt: string;
  negativePrompt: string;
  cfgScale: number;
  steps: number;
  seed: number;
  randomSeed: boolean;
}

export const A1111GenerateModal: React.FC<A1111GenerateModalProps> = ({
  isOpen,
  onClose,
  image,
  onGenerate,
  isGenerating,
}) => {
  const [params, setParams] = useState<GenerationParams>({
    prompt: '',
    negativePrompt: '',
    cfgScale: 7.0,
    steps: 20,
    seed: -1,
    randomSeed: false,
  });

  const [validationError, setValidationError] = useState<string>('');

  // Initialize form with image metadata when modal opens
  useEffect(() => {
    if (isOpen && image.metadata?.normalizedMetadata) {
      const meta = image.metadata.normalizedMetadata;
      setParams({
        prompt: meta.prompt || '',
        negativePrompt: meta.negativePrompt || '',
        cfgScale: meta.cfg_scale || 7.0,
        steps: meta.steps || 20,
        seed: meta.seed !== undefined ? meta.seed : -1,
        randomSeed: false,
      });
      setValidationError('');
    }
  }, [isOpen, image]);

  const handleGenerate = async () => {
    // Validation
    if (!params.prompt.trim()) {
      setValidationError('Prompt cannot be empty');
      return;
    }

    if (params.cfgScale <= 0) {
      setValidationError('CFG Scale must be greater than 0');
      return;
    }

    if (params.steps <= 0) {
      setValidationError('Steps must be greater than 0');
      return;
    }

    setValidationError('');

    // Call parent handler
    await onGenerate(params);
  };

  const handleClose = () => {
    if (isGenerating) {
      if (window.confirm('Generation in progress. Are you sure you want to close?')) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  // Check if metadata is available
  if (!image.metadata?.normalizedMetadata) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center" onClick={handleClose}>
        <div
          className="bg-gray-800 text-white rounded-lg shadow-xl p-6 max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-red-400">No Metadata Available</h2>
            <button onClick={handleClose} className="p-1 rounded-full hover:bg-gray-700">
              <X size={20} />
            </button>
          </div>
          <p className="text-gray-300">This image doesn't have metadata available for generation.</p>
          <button
            onClick={handleClose}
            className="mt-4 w-full bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded-md text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center" onClick={handleClose}>
      <div
        className="bg-gray-800 text-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Generate Variation</h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-full hover:bg-gray-700 transition-colors"
            disabled={isGenerating}
          >
            <X size={24} />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Prompt */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">
              Prompt
            </label>
            <textarea
              value={params.prompt}
              onChange={(e) => setParams(prev => ({ ...prev, prompt: e.target.value }))}
              rows={4}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your prompt..."
            />
          </div>

          {/* Negative Prompt */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">
              Negative Prompt
            </label>
            <textarea
              value={params.negativePrompt}
              onChange={(e) => setParams(prev => ({ ...prev, negativePrompt: e.target.value }))}
              rows={3}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter negative prompt (optional)..."
            />
          </div>

          {/* Generation Parameters */}
          <div className="bg-gray-900 p-4 rounded-md border border-gray-700 space-y-4">
            <h3 className="text-sm font-semibold text-gray-300">Generation Parameters</h3>

            {/* CFG Scale and Steps - Side by side */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">
                  CFG Scale
                </label>
                <input
                  type="number"
                  value={params.cfgScale}
                  onChange={(e) => setParams(prev => ({ ...prev, cfgScale: parseFloat(e.target.value) || 0 }))}
                  step="0.5"
                  min="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">
                  Steps
                </label>
                <input
                  type="number"
                  value={params.steps}
                  onChange={(e) => setParams(prev => ({ ...prev, steps: parseInt(e.target.value) || 0 }))}
                  min="1"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Seed */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">
                Seed
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={params.randomSeed ? -1 : params.seed}
                  onChange={(e) => setParams(prev => ({ ...prev, seed: parseInt(e.target.value) || -1 }))}
                  disabled={params.randomSeed}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={params.randomSeed}
                    onChange={(e) => setParams(prev => ({ ...prev, randomSeed: e.target.checked }))}
                    className="cursor-pointer"
                  />
                  Random
                </label>
              </div>
            </div>
          </div>

          {/* Validation Error */}
          {validationError && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded text-sm">
              {validationError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-700">
          <button
            onClick={handleClose}
            disabled={isGenerating}
            className="bg-gray-600 hover:bg-gray-700 disabled:bg-gray-700 disabled:cursor-not-allowed px-4 py-2 rounded-md text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors"
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Generating...</span>
              </>
            ) : (
              <span>Generate</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

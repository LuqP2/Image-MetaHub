import { useTranslation } from '../i18n/useTranslation';
import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { IndexedImage } from '../types';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { useA1111Models } from '../hooks/useA1111Models';
import hotkeyManager from '../services/hotkeyManager';
import { cleanLoraName, extractLoRAsWithWeights } from '../utils/promptCleaner';

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
  numberOfImages: number;
  width: number;
  height: number;
  model?: string;
  loras?: LoRAConfig[];
  sampler?: string;
}

export interface LoRAConfig {
  name: string;
  strength: number;
}

export const A1111GenerateModal: React.FC<A1111GenerateModalProps> = ({
  isOpen,
  onClose,
  image,
  onGenerate,
  isGenerating,
}) => {
  const { t: tr } = useTranslation();

  // Feature access safety check
  const { canUseA1111 } = useFeatureAccess();

  const { resources, isLoading: isLoadingResources, error: resourcesError } = useA1111Models();

  const [params, setParams] = useState<GenerationParams>({
    prompt: '',
    negativePrompt: '',
    cfgScale: 7.0,
    steps: 20,
    seed: -1,
    randomSeed: false,
    numberOfImages: 1,
    width: 512,
    height: 512,
    model: undefined,
    loras: [],
    sampler: undefined,
  });

  const [modelSearch, setModelSearch] = useState('');
  const [selectedLoras, setSelectedLoras] = useState<LoRAConfig[]>([]);
  const [validationError, setValidationError] = useState<string>('');

  // Pause hotkeys when modal is open
  useEffect(() => {
    if (isOpen) {
      hotkeyManager.pauseHotkeys();
    } else {
      hotkeyManager.resumeHotkeys();
    }

    return () => {
      hotkeyManager.resumeHotkeys();
    };
  }, [isOpen]);

  // Initialize form with persisted parameters when modal opens
  useEffect(() => {
    if (isOpen && image.metadata?.normalizedMetadata) {
      const meta = image.metadata.normalizedMetadata;

      // Load persisted parameters from localStorage
      const storedModel = typeof window !== 'undefined' ? localStorage.getItem('IMH_A1111_LAST_MODEL') : null;
      const storedCfgScale = typeof window !== 'undefined' ? localStorage.getItem('IMH_A1111_LAST_CFG_SCALE') : null;
      const storedSteps = typeof window !== 'undefined' ? localStorage.getItem('IMH_A1111_LAST_STEPS') : null;
      const storedRandomSeed = typeof window !== 'undefined' ? localStorage.getItem('IMH_A1111_LAST_RANDOM_SEED') : null;
      const storedLoras = typeof window !== 'undefined' ? localStorage.getItem('IMH_A1111_LAST_LORAS') : null;
      const storedSampler = typeof window !== 'undefined' ? localStorage.getItem('IMH_A1111_LAST_SAMPLER') : null;

      // Use persisted values or fallback to image metadata
      const preferredModel = storedModel || meta.model || undefined;
      const preferredCfgScale = storedCfgScale ? parseFloat(storedCfgScale) : meta.cfg_scale || 7.0;
      const preferredSteps = storedSteps ? parseInt(storedSteps) : meta.steps || 20;
      const preferredRandomSeed = storedRandomSeed ? storedRandomSeed === 'true' : false;
      const preferredSampler = storedSampler || meta.sampler || meta.scheduler || undefined;

      let preferredLoras: LoRAConfig[] = [];
      if (storedLoras) {
        try {
          preferredLoras = JSON.parse(storedLoras);
        } catch (e) {
          console.error('Failed to parse stored LoRAs:', e);
        }
      }

      setParams({
        prompt: meta.prompt || '',
        negativePrompt: meta.negativePrompt || '',
        cfgScale: preferredCfgScale,
        steps: preferredSteps,
        seed: meta.seed !== undefined ? meta.seed : -1,
        randomSeed: preferredRandomSeed,
        numberOfImages: 1,
        width: meta.width || 512,
        height: meta.height || 512,
        model: preferredModel,
        loras: [],
        sampler: preferredSampler,
      });
      setSelectedLoras(preferredLoras);
      setModelSearch('');
      setValidationError('');
    }
  }, [isOpen, image]);

  const buildPromptWithLoras = (prompt: string, loras: LoRAConfig[]) => {
    if (loras.length === 0) {
      return prompt;
    }

    const existingLoras = extractLoRAsWithWeights(prompt);
    const existingNames = new Set(
      existingLoras
        .map((lora) => (typeof lora === 'string' ? lora : lora.name))
        .map((name) => cleanLoraName(name).toLowerCase())
    );

    const loraTags = loras
      .map((lora) => ({
        ...lora,
        name: cleanLoraName(lora.name),
      }))
      .filter((lora) => lora.name && !existingNames.has(lora.name.toLowerCase()))
      .map((lora) => `<lora:${lora.name}:${lora.strength}>`);

    if (loraTags.length === 0) {
      return prompt;
    }

    return `${prompt.trim()} ${loraTags.join(' ')}`.trim();
  };

  const handleGenerate = async () => {
    // Validation
    if (!params.prompt.trim()) {
      setValidationError(tr('integrations.a1111.validationPromptEmpty'));
      return;
    }

    if (params.cfgScale <= 0) {
      setValidationError(tr('integrations.a1111.validationCfgPositive'));
      return;
    }

    if (params.steps <= 0) {
      setValidationError(tr('integrations.a1111.validationStepsPositive'));
      return;
    }

    if (params.numberOfImages <= 0 || params.numberOfImages > 10) {
      setValidationError(tr('integrations.a1111.validationImageCountRange'));
      return;
    }

    setValidationError('');

    // Persist parameters to localStorage
    if (typeof window !== 'undefined') {
      if (params.model) localStorage.setItem('IMH_A1111_LAST_MODEL', params.model);
      localStorage.setItem('IMH_A1111_LAST_CFG_SCALE', params.cfgScale.toString());
      localStorage.setItem('IMH_A1111_LAST_STEPS', params.steps.toString());
      localStorage.setItem('IMH_A1111_LAST_RANDOM_SEED', params.randomSeed.toString());
      if (selectedLoras.length > 0) {
        localStorage.setItem('IMH_A1111_LAST_LORAS', JSON.stringify(selectedLoras));
      }
      if (params.sampler) localStorage.setItem('IMH_A1111_LAST_SAMPLER', params.sampler);
    }

    const generationParams: GenerationParams = {
      ...params,
      prompt: buildPromptWithLoras(params.prompt, selectedLoras),
      loras: selectedLoras.length > 0 ? selectedLoras : undefined,
    };

    // Call parent handler
    await onGenerate(generationParams);
  };

  const handleClose = () => {
    // Allow closing even during generation (non-blocking)
    onClose();
  };

  const handleLoadFromImage = () => {
    if (!image.metadata?.normalizedMetadata) return;

    const meta = image.metadata.normalizedMetadata;
    setParams({
      prompt: meta.prompt || '',
      negativePrompt: meta.negativePrompt || '',
      cfgScale: meta.cfg_scale || 7.0,
      steps: meta.steps || 20,
      seed: meta.seed !== undefined ? meta.seed : -1,
      randomSeed: false,
      numberOfImages: 1,
      width: meta.width || 512,
      height: meta.height || 512,
      model: meta.model || undefined,
      loras: [],
      sampler: meta.sampler || meta.scheduler || undefined,
    });
    setSelectedLoras([]);
  };

  const handleAddLora = (loraName: string) => {
    if (!loraName || selectedLoras.some(l => l.name === loraName)) {
      return;
    }
    setSelectedLoras(prev => [...prev, { name: loraName, strength: 1.0 }]);
  };

  const handleRemoveLora = (index: number) => {
    setSelectedLoras(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateLoraStrength = (index: number, strength: number) => {
    setSelectedLoras(prev => prev.map((lora, i) =>
      i === index ? { ...lora, strength } : lora
    ));
  };

  if (!isOpen) {
    return null;
  }

  // Safety check: Don't render if feature is not available
  if (!canUseA1111) {
    console.warn('[IMH] A1111GenerateModal accessed without permission');
    return null;
  }

  // Check if metadata is available
  if (!image.metadata?.normalizedMetadata) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center" onClick={handleClose}>
        <div
          className="bg-gray-800 text-gray-100 rounded-lg shadow-xl p-6 max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-red-400">{tr('integrations.a1111.noMetadataTitle')}</h2>
            <button onClick={handleClose} className="p-1 rounded-full hover:bg-gray-700" aria-label={tr('integrations.closeGenerate')}>
              <X size={20} />
            </button>
          </div>
          <p className="text-gray-300">{tr('integrations.a1111.noMetadataDescription')}</p>
          <button
            onClick={handleClose}
            className="mt-4 w-full bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded-md text-sm font-medium"
          >
            {tr('comparison.close')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center" onClick={handleClose}>
      <div
        className="bg-gray-800 text-gray-100 rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">{tr('integrations.a1111.title')}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleLoadFromImage}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5"
              title={tr('integrations.a1111.loadFromImageTooltip')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {tr('integrations.a1111.loadFromImage')}</button>
            <button
              onClick={handleClose}
              className="p-1 rounded-full hover:bg-gray-700 transition-colors"
              aria-label={tr('integrations.closeGenerate')}
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Prompt */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">
              {tr('libraryGallery.prompt')}</label>
            <textarea
              value={params.prompt}
              onChange={(e) => setParams(prev => ({ ...prev, prompt: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
              rows={10}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={tr('integrations.a1111.promptPlaceholder')}
            />
          </div>

          {/* Negative Prompt */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">
              {tr('libraryGallery.negativePrompt')}</label>
            <textarea
              value={params.negativePrompt}
              onChange={(e) => setParams(prev => ({ ...prev, negativePrompt: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
              rows={6}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={tr('integrations.a1111.negativePromptPlaceholder')}
            />
          </div>

          {/* Generation Parameters */}
          <div className="bg-gray-900 p-4 rounded-md border border-gray-700 space-y-4">
            <h3 className="text-sm font-semibold text-gray-300">{tr('integrations.a1111.generationParameters')}</h3>

            {/* Model Selection */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">
                {tr('libraryGallery.model')}</label>
              <input
                type="text"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder={tr('integrations.a1111.searchModelPlaceholder')}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {isLoadingResources ? (
                <div className="text-xs text-gray-400">{tr('integrations.a1111.loadingModels')}</div>
              ) : resourcesError ? (
                <div className="text-xs text-red-400">{tr('integrations.a1111.errorLoadingModels', { error: resourcesError })}</div>
              ) : (
                <select
                  value={params.model || ''}
                  onChange={(e) => {
                    const selected = e.target.value || undefined;
                    if (selected) {
                      localStorage.setItem('IMH_A1111_LAST_MODEL', selected);
                    }
                    setParams(prev => ({ ...prev, model: selected }));
                  }}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={!resources?.models || resources.models.length === 0}
                >
                  {!params.model && <option value="">{tr('integrations.a1111.selectModel')}</option>}
                  {resources?.models
                    .filter(model => model.toLowerCase().includes(modelSearch.trim().toLowerCase()))
                    .map(model => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              )}
              {resources?.models.length === 0 && (
                <p className="text-xs text-gray-400">{tr('integrations.a1111.noModelsFound')}</p>
              )}
            </div>

            {/* LoRA Selection */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">
                {tr('comparison.loras')}</label>
              {isLoadingResources ? (
                <div className="text-xs text-gray-400">{tr('integrations.a1111.loadingLoras')}</div>
              ) : resourcesError ? (
                <div className="text-xs text-red-400">{tr('integrations.a1111.errorLoadingLoras')}</div>
              ) : (
                <>
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        handleAddLora(e.target.value);
                        e.target.value = '';
                      }
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={!resources?.loras || resources.loras.length === 0}
                  >
                    <option value="">{tr('integrations.a1111.addLora')}</option>
                    {resources?.loras
                      .filter(lora => !selectedLoras.some(selected => selected.name === lora))
                      .map(lora => (
                        <option key={lora} value={lora}>
                          {lora}
                        </option>
                      ))}
                  </select>

                  {selectedLoras.length > 0 ? (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {selectedLoras.map((lora, index) => (
                        <div
                          key={`${lora.name}-${index}`}
                          className="flex items-center gap-2 bg-blue-900/30 border border-blue-700/50 rounded-full px-3 py-1.5 text-xs"
                        >
                          <span className="text-blue-200 font-medium">{lora.name}</span>
                          <input
                            type="number"
                            value={lora.strength}
                            onChange={(e) => handleUpdateLoraStrength(index, parseFloat(e.target.value) || 0)}
                            step="0.1"
                            min="-2.0"
                            max="2.0"
                            className="w-14 bg-blue-950/50 border border-blue-700/50 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <button
                            onClick={() => handleRemoveLora(index)}
                            className="text-blue-300 hover:text-blue-100 transition-colors"
                            title={tr('integrations.a1111.removeLora')}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 italic mt-2">{tr('integrations.a1111.noLorasSelected')}</p>
                  )}
                </>
              )}
              {resources?.loras.length === 0 && (
                <p className="text-xs text-gray-400">{tr('integrations.a1111.noLorasFound')}</p>
              )}
            </div>

            {/* Sampler Selection */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">
                {tr('librarySearch.sampler')}</label>
              {isLoadingResources ? (
                <div className="text-xs text-gray-400">{tr('integrations.a1111.loadingSamplers')}</div>
              ) : resourcesError ? (
                <div className="text-xs text-red-400">{tr('integrations.a1111.errorLoadingSamplers')}</div>
              ) : (
                <select
                  value={params.sampler || ''}
                  onChange={(e) => setParams(prev => ({ ...prev, sampler: e.target.value || undefined }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={!resources?.samplers || resources.samplers.length === 0}
                >
                  {!params.sampler && <option value="">{tr('integrations.a1111.selectSampler')}</option>}
                  {resources?.samplers.map((sampler) => (
                    <option key={sampler} value={sampler}>
                      {sampler}
                    </option>
                  ))}
                </select>
              )}
              {resources?.samplers.length === 0 && (
                <p className="text-xs text-gray-400">{tr('integrations.a1111.noSamplersFound')}</p>
              )}
            </div>

            {/* Image Size */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">
                {tr('integrations.a1111.imageSize')}</label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs text-gray-400">{tr('comparison.width')}</label>
                  <input
                    type="number"
                    value={params.width}
                    onChange={(e) => setParams(prev => ({ ...prev, width: parseInt(e.target.value) || 512 }))}
                    step="64"
                    min="64"
                    max="2048"
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs text-gray-400">{tr('comparison.height')}</label>
                  <input
                    type="number"
                    value={params.height}
                    onChange={(e) => setParams(prev => ({ ...prev, height: parseInt(e.target.value) || 512 }))}
                    step="64"
                    min="64"
                    max="2048"
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* CFG Scale and Steps - Side by side */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">
                  {tr('comparison.cfgScale')}</label>
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
                  {tr('libraryGallery.steps')}</label>
                <input
                  type="number"
                  value={params.steps}
                  onChange={(e) => setParams(prev => ({ ...prev, steps: parseInt(e.target.value) || 0 }))}
                  min="1"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Seed and Number of Images - Side by side */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">
                  {tr('libraryGallery.seed')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={params.randomSeed ? -1 : params.seed}
                    onChange={(e) => setParams(prev => ({ ...prev, seed: parseInt(e.target.value) || -1 }))}
                    disabled={params.randomSeed}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={params.randomSeed}
                    onChange={(e) => setParams(prev => ({ ...prev, randomSeed: e.target.checked }))}
                    className="cursor-pointer"
                  />
                  {tr('integrations.a1111.randomSeed')}</label>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">
                  {tr('integrations.a1111.numberOfImages')}</label>
                <input
                  type="number"
                  value={params.numberOfImages}
                  onChange={(e) => setParams(prev => ({ ...prev, numberOfImages: parseInt(e.target.value) || 1 }))}
                  min="1"
                  max="10"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500">{tr('integrations.a1111.maxImagesHint', { max: 10 })}</p>
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
            className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded-md text-sm font-medium transition-colors"
          >
            {tr('batchExport.cancel')}</button>
          <button
            onClick={handleGenerate}
            className="bg-blue-600 hover:bg-accent-strong px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors"
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>{tr('imageViewer.preview.generating')}</span>
              </>
            ) : (
              <span>{tr('libraryGallery.generate')}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

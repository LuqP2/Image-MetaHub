/**
 * ComfyUI Generation Modal
 * Supports original-workflow and simple rebuild generation modes.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { IndexedImage } from '../types';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { useComfyUIModels } from '../hooks/useComfyUIModels';
import hotkeyManager from '../services/hotkeyManager';
import {
  analyzeComfyWorkflow,
  extractEmbeddedComfyWorkflow,
  type ComfyUIModelFamily,
  type ComfyUIModelResource,
  type ComfyUISourceImagePolicy,
  type ComfyUIWorkflowMode,
  type ComfyUILoRAConfig,
} from '../services/comfyUIWorkflowBuilder';

interface ComfyUIGenerateModalProps {
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
  model?: ComfyUIModelResource | null;
  loras?: ComfyUILoRAConfig[];
  sampler?: string;
  scheduler?: string;
  workflowMode: ComfyUIWorkflowMode;
  sourceImagePolicy: ComfyUISourceImagePolicy;
  advancedPromptJson?: string;
  advancedWorkflowJson?: string;
  maskFile?: File | null;
}

const MODEL_FAMILY_LABELS: Record<ComfyUIModelFamily, string> = {
  checkpoint: 'Checkpoint',
  unet: 'UNet',
  vae: 'VAE',
  clip: 'CLIP',
  lora: 'LoRA',
  unknown: 'Unknown',
};

const formatJson = (value: unknown): string => {
  if (!value) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
};

export const ComfyUIGenerateModal: React.FC<ComfyUIGenerateModalProps> = ({
  isOpen,
  onClose,
  image,
  onGenerate,
  isGenerating,
}) => {
  const { canUseComfyUI } = useFeatureAccess();
  const { resources, isLoading: isLoadingResources, error: resourcesError } = useComfyUIModels();
  const normalizedMetadata = image.metadata?.normalizedMetadata;
  const workflowAnalysis = useMemo(
    () => analyzeComfyWorkflow(image, normalizedMetadata as any),
    [image, normalizedMetadata]
  );
  const embeddedWorkflow = useMemo(() => extractEmbeddedComfyWorkflow(image), [image]);

  const [params, setParams] = useState<GenerationParams>({
    prompt: '',
    negativePrompt: '',
    cfgScale: 7,
    steps: 20,
    seed: -1,
    randomSeed: false,
    numberOfImages: 1,
    width: 1024,
    height: 1024,
    model: null,
    loras: [],
    sampler: undefined,
    scheduler: undefined,
    workflowMode: workflowAnalysis.originalAvailable ? 'original' : 'simple',
    sourceImagePolicy: 'reuse_original',
    advancedPromptJson: '',
    advancedWorkflowJson: '',
    maskFile: null,
  });
  const [validationError, setValidationError] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [loraSearch, setLoraSearch] = useState('');
  const [showAdvancedEditor, setShowAdvancedEditor] = useState(false);

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

  useEffect(() => {
    if (!isOpen || !normalizedMetadata) {
      return;
    }

    const storedMode = typeof window !== 'undefined' ? localStorage.getItem('IMH_COMFYUI_LAST_MODE') as ComfyUIWorkflowMode | null : null;
    const storedSourcePolicy = typeof window !== 'undefined'
      ? localStorage.getItem('IMH_COMFYUI_LAST_SOURCE_POLICY') as ComfyUISourceImagePolicy | null
      : null;
    const storedModel = typeof window !== 'undefined' ? localStorage.getItem('IMH_COMFYUI_LAST_MODEL_OBJECT') : null;
    const storedLoras = typeof window !== 'undefined' ? localStorage.getItem('IMH_COMFYUI_LAST_LORAS') : null;
    const storedRandomSeed = typeof window !== 'undefined' ? localStorage.getItem('IMH_COMFYUI_LAST_RANDOM_SEED') : null;

    let parsedModel: ComfyUIModelResource | null = null;
    if (storedModel) {
      try {
        parsedModel = JSON.parse(storedModel);
      } catch {
        parsedModel = null;
      }
    }

    let parsedLoras: ComfyUILoRAConfig[] = [];
    if (storedLoras) {
      try {
        parsedLoras = JSON.parse(storedLoras);
      } catch {
        parsedLoras = [];
      }
    }

    setParams({
      prompt: normalizedMetadata.prompt || '',
      negativePrompt: normalizedMetadata.negativePrompt || '',
      cfgScale: (normalizedMetadata as any).cfgScale ?? normalizedMetadata.cfg_scale ?? 7,
      steps: normalizedMetadata.steps || 20,
      seed: normalizedMetadata.seed ?? -1,
      randomSeed: storedRandomSeed === 'true',
      numberOfImages: 1,
      width: normalizedMetadata.width || 1024,
      height: normalizedMetadata.height || 1024,
      model: parsedModel,
      loras: parsedLoras,
      sampler: normalizedMetadata.sampler || undefined,
      scheduler: normalizedMetadata.scheduler || undefined,
      workflowMode: workflowAnalysis.originalAvailable
        ? (storedMode || 'original')
        : 'simple',
      sourceImagePolicy: storedSourcePolicy || 'reuse_original',
      advancedPromptJson: formatJson(embeddedWorkflow.prompt),
      advancedWorkflowJson: formatJson(embeddedWorkflow.workflow),
      maskFile: null,
    });

    setValidationError('');
    setModelSearch('');
    setLoraSearch('');
  }, [embeddedWorkflow.prompt, embeddedWorkflow.workflow, isOpen, normalizedMetadata, workflowAnalysis.originalAvailable]);

  const compatibleModelFamilies = useMemo(() => {
    if (params.workflowMode === 'simple') {
      return new Set<ComfyUIModelFamily>(['checkpoint']);
    }
    return new Set<ComfyUIModelFamily>(workflowAnalysis.compatibleModelFamilies.length > 0 ? workflowAnalysis.compatibleModelFamilies : ['checkpoint']);
  }, [params.workflowMode, workflowAnalysis.compatibleModelFamilies]);

  const filteredModels = useMemo(() => {
    const allModels = resources?.models || [];
    const search = modelSearch.trim().toLowerCase();
    return allModels.filter((model) => {
      if (!compatibleModelFamilies.has(model.family)) {
        return false;
      }
      if (!search) {
        return true;
      }
      return model.name.toLowerCase().includes(search);
    });
  }, [compatibleModelFamilies, modelSearch, resources?.models]);

  const filteredLoras = useMemo(() => {
    const search = loraSearch.trim().toLowerCase();
    return (resources?.loras || [])
      .filter((lora) => !params.loras?.some((selected) => selected.name === lora))
      .filter((lora) => !search || lora.toLowerCase().includes(search));
  }, [loraSearch, params.loras, resources?.loras]);

  const isTransformation = workflowAnalysis.generationType === 'img2img'
    || workflowAnalysis.generationType === 'inpaint'
    || workflowAnalysis.generationType === 'outpaint';
  const requiresMaskInput = isTransformation && workflowAnalysis.maskTargets.length > 0;

  const handleGenerate = async () => {
    if (!params.prompt.trim()) {
      setValidationError('Prompt cannot be empty.');
      return;
    }

    if (params.workflowMode === 'original' && !workflowAnalysis.originalAvailable) {
      setValidationError('Original workflow mode is not available for this image.');
      return;
    }

    if (params.sourceImagePolicy === 'selected_image_and_mask' && requiresMaskInput && !params.maskFile) {
      setValidationError('Select a mask file before generating.');
      return;
    }

    if (params.advancedPromptJson?.trim()) {
      try {
        JSON.parse(params.advancedPromptJson);
      } catch {
        setValidationError('Prompt API JSON is invalid.');
        return;
      }
    }

    if (params.advancedWorkflowJson?.trim()) {
      try {
        JSON.parse(params.advancedWorkflowJson);
      } catch {
        setValidationError('Workflow UI JSON is invalid.');
        return;
      }
    }

    setValidationError('');

    if (typeof window !== 'undefined') {
      localStorage.setItem('IMH_COMFYUI_LAST_MODE', params.workflowMode);
      localStorage.setItem('IMH_COMFYUI_LAST_SOURCE_POLICY', params.sourceImagePolicy);
      localStorage.setItem('IMH_COMFYUI_LAST_RANDOM_SEED', String(params.randomSeed));
      if (params.model) {
        localStorage.setItem('IMH_COMFYUI_LAST_MODEL_OBJECT', JSON.stringify(params.model));
      }
      if (params.loras && params.loras.length > 0) {
        localStorage.setItem('IMH_COMFYUI_LAST_LORAS', JSON.stringify(params.loras));
      }
    }

    await onGenerate(params);
  };

  const handleAddLora = (loraName: string) => {
    if (!loraName) {
      return;
    }
    setParams((prev) => ({
      ...prev,
      loras: [...(prev.loras || []), { name: loraName, strength: 1 }],
    }));
  };

  const handleUpdateLora = (index: number, strength: number) => {
    setParams((prev) => ({
      ...prev,
      loras: (prev.loras || []).map((lora, currentIndex) =>
        currentIndex === index ? { ...lora, strength } : lora
      ),
    }));
  };

  const handleRemoveLora = (index: number) => {
    setParams((prev) => ({
      ...prev,
      loras: (prev.loras || []).filter((_, currentIndex) => currentIndex !== index),
    }));
  };

  if (!isOpen) {
    return null;
  }

  if (!canUseComfyUI) {
    return null;
  }

  if (!normalizedMetadata) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div className="w-full max-w-md rounded-lg bg-gray-800 p-6 text-gray-100" onClick={(event) => event.stopPropagation()}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-red-400">No Metadata Available</h2>
            <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-700">
              <X size={20} />
            </button>
          </div>
          <p className="text-sm text-gray-300">This image does not have enough metadata for ComfyUI generation.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-lg bg-gray-800 p-6 text-gray-100 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Generate with ComfyUI</h2>
            <p className="text-sm text-gray-400">
              {workflowAnalysis.originalAvailable
                ? 'Original workflow is available for this image.'
                : 'Original workflow is unavailable. Generation will use simple rebuild.'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-700">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-300">Workflow Mode</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                disabled={!workflowAnalysis.originalAvailable}
                onClick={() => setParams((prev) => ({ ...prev, workflowMode: 'original' }))}
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  params.workflowMode === 'original'
                    ? 'border-purple-400 bg-purple-500/10 text-purple-100'
                    : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                } ${!workflowAnalysis.originalAvailable ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <div className="text-sm font-semibold">Original workflow</div>
                <div className="mt-1 text-xs text-gray-400">Patches the embedded ComfyUI graph and keeps provenance.</div>
              </button>
              <button
                type="button"
                onClick={() => setParams((prev) => ({ ...prev, workflowMode: 'simple' }))}
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  params.workflowMode === 'simple'
                    ? 'border-blue-400 bg-blue-500/10 text-blue-100'
                    : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                }`}
              >
                <div className="text-sm font-semibold">Simple rebuild</div>
                <div className="mt-1 text-xs text-gray-400">Builds a safe txt2img pipeline from normalized metadata.</div>
              </button>
            </div>
            {workflowAnalysis.warnings.length > 0 && (
              <div className="mt-3 space-y-2">
                {workflowAnalysis.warnings.map((warning) => (
                  <div key={warning} className="flex items-start gap-2 rounded-md border border-yellow-700/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-300">Core</h3>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Prompt</label>
              <textarea
                rows={8}
                value={params.prompt}
                onChange={(event) => setParams((prev) => ({ ...prev, prompt: event.target.value }))}
                className="w-full resize-y rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div className="mt-4 space-y-2">
              <label className="block text-sm font-medium text-gray-300">Negative Prompt</label>
              <textarea
                rows={5}
                value={params.negativePrompt}
                onChange={(event) => setParams((prev) => ({ ...prev, negativePrompt: event.target.value }))}
                className="w-full resize-y rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">Sampler</label>
                <select
                  value={params.sampler || ''}
                  onChange={(event) => setParams((prev) => ({ ...prev, sampler: event.target.value || undefined }))}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  {!params.sampler && <option value="">Select sampler...</option>}
                  {(resources?.samplers || []).map((sampler) => (
                    <option key={sampler} value={sampler}>{sampler}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">Scheduler</label>
                <select
                  value={params.scheduler || ''}
                  onChange={(event) => setParams((prev) => ({ ...prev, scheduler: event.target.value || undefined }))}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  {!params.scheduler && <option value="">Select scheduler...</option>}
                  {(resources?.schedulers || []).map((scheduler) => (
                    <option key={scheduler} value={scheduler}>{scheduler}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <label className="space-y-2 text-sm font-medium text-gray-300">
                <span>CFG</span>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={params.cfgScale}
                  onChange={(event) => setParams((prev) => ({ ...prev, cfgScale: parseFloat(event.target.value) || 0 }))}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-gray-300">
                <span>Steps</span>
                <input
                  type="number"
                  min="1"
                  value={params.steps}
                  onChange={(event) => setParams((prev) => ({ ...prev, steps: parseInt(event.target.value, 10) || 0 }))}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-gray-300">
                <span>Width</span>
                <input
                  type="number"
                  min="64"
                  step="64"
                  value={params.width}
                  onChange={(event) => setParams((prev) => ({ ...prev, width: parseInt(event.target.value, 10) || 512 }))}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-gray-300">
                <span>Height</span>
                <input
                  type="number"
                  min="64"
                  step="64"
                  value={params.height}
                  onChange={(event) => setParams((prev) => ({ ...prev, height: parseInt(event.target.value, 10) || 512 }))}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="space-y-2 text-sm font-medium text-gray-300">
                <span>Seed</span>
                <input
                  type="number"
                  value={params.randomSeed ? -1 : params.seed}
                  disabled={params.randomSeed}
                  onChange={(event) => setParams((prev) => ({ ...prev, seed: parseInt(event.target.value, 10) || -1 }))}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
                />
              </label>
              <label className="flex items-center gap-2 self-end rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={params.randomSeed}
                  onChange={(event) => setParams((prev) => ({ ...prev, randomSeed: event.target.checked }))}
                />
                Random seed
              </label>
              <label className="space-y-2 text-sm font-medium text-gray-300">
                <span>Images</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={params.numberOfImages}
                  onChange={(event) => setParams((prev) => ({ ...prev, numberOfImages: Math.max(1, Math.min(10, parseInt(event.target.value, 10) || 1)) }))}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-300">Modeling</h3>
            <div className="mb-2 flex flex-wrap gap-2 text-xs text-gray-400">
              {Array.from(compatibleModelFamilies).map((family) => (
                <span key={family} className="rounded-full border border-gray-700 px-2 py-0.5">
                  {MODEL_FAMILY_LABELS[family]}
                </span>
              ))}
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Model</label>
              <input
                type="text"
                value={modelSearch}
                onChange={(event) => setModelSearch(event.target.value)}
                placeholder="Search model..."
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              {isLoadingResources ? (
                <div className="text-xs text-gray-400">Loading models...</div>
              ) : resourcesError ? (
                <div className="text-xs text-red-400">{resourcesError}</div>
              ) : (
                <select
                  value={params.model ? `${params.model.family}:${params.model.name}` : ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    const nextModel = filteredModels.find((model) => `${model.family}:${model.name}` === value) || null;
                    setParams((prev) => ({ ...prev, model: nextModel }));
                  }}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  {!params.model && <option value="">Use current model</option>}
                  {filteredModels.map((model) => (
                    <option key={`${model.family}:${model.name}`} value={`${model.family}:${model.name}`}>
                      [{MODEL_FAMILY_LABELS[model.family]}] {model.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="mt-4 space-y-2">
              <label className="block text-sm font-medium text-gray-300">LoRAs</label>
              <input
                type="text"
                value={loraSearch}
                onChange={(event) => setLoraSearch(event.target.value)}
                placeholder="Search LoRA..."
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <select
                onChange={(event) => {
                  if (event.target.value) {
                    handleAddLora(event.target.value);
                    event.target.value = '';
                  }
                }}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="">Add LoRA...</option>
                {filteredLoras.map((lora) => (
                  <option key={lora} value={lora}>{lora}</option>
                ))}
              </select>
              {(params.loras || []).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {(params.loras || []).map((lora, index) => (
                    <div key={`${lora.name}-${index}`} className="flex items-center gap-2 rounded-full border border-purple-700/50 bg-purple-900/30 px-3 py-1.5 text-xs">
                      <span className="font-medium text-purple-100">{lora.name}</span>
                      <input
                        type="number"
                        step="0.1"
                        min="-2"
                        max="2"
                        value={lora.strength}
                        onChange={(event) => handleUpdateLora(index, parseFloat(event.target.value) || 0)}
                        className="w-14 rounded border border-purple-700/50 bg-purple-950/50 px-1.5 py-0.5 text-center text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                      <button onClick={() => handleRemoveLora(index)} className="text-purple-300 hover:text-purple-100">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs italic text-gray-500">No LoRAs selected.</p>
              )}
            </div>
          </div>

          {isTransformation && (
            <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-300">Transform</h3>
              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-300">Source Image Policy</label>
                <select
                  value={params.sourceImagePolicy}
                  onChange={(event) => setParams((prev) => ({ ...prev, sourceImagePolicy: event.target.value as ComfyUISourceImagePolicy }))}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="reuse_original">Reuse original workflow assets</option>
                  <option value="selected_image">Use selected image</option>
                  {requiresMaskInput && <option value="selected_image_and_mask">Use selected image + selected mask</option>}
                </select>
                <div className="text-xs text-gray-400">
                  Generation type detected: <span className="font-semibold text-gray-200">{workflowAnalysis.generationType}</span>
                </div>
                {params.sourceImagePolicy === 'selected_image_and_mask' && requiresMaskInput && (
                  <label className="block space-y-2 text-sm font-medium text-gray-300">
                    <span>Mask File</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => setParams((prev) => ({ ...prev, maskFile: event.target.files?.[0] || null }))}
                      className="block w-full text-sm text-gray-300 file:mr-4 file:rounded file:border-0 file:bg-purple-500/20 file:px-3 file:py-2 file:text-sm file:font-medium file:text-purple-100 hover:file:bg-purple-500/30"
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
            <button
              type="button"
              onClick={() => setShowAdvancedEditor((prev) => !prev)}
              className="flex w-full items-center justify-between text-left text-sm font-semibold text-gray-300"
            >
              <span>Advanced Editor</span>
              {showAdvancedEditor ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {showAdvancedEditor && (
              <div className="mt-4 space-y-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Prompt API JSON</label>
                  <textarea
                    rows={10}
                    value={params.advancedPromptJson || ''}
                    onChange={(event) => setParams((prev) => ({ ...prev, advancedPromptJson: event.target.value }))}
                    className="w-full resize-y rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Workflow UI JSON</label>
                  <textarea
                    rows={8}
                    value={params.advancedWorkflowJson || ''}
                    onChange={(event) => setParams((prev) => ({ ...prev, advancedWorkflowJson: event.target.value }))}
                    className="w-full resize-y rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div className="text-xs text-gray-400">
                  Prompt API JSON is authoritative for execution. Workflow UI JSON is persisted for provenance and reload in ComfyUI.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="text-sm text-red-400">{validationError}</div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGenerating ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

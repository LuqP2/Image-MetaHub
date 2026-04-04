/**
 * ComfyUI Generation Modal
 * Supports original-workflow and simple rebuild generation modes.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Eye, Maximize2, Minimize2, SlidersHorizontal, X } from 'lucide-react';
import { BaseMetadata, IndexedImage } from '../types';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { useComfyUIModels } from '../hooks/useComfyUIModels';
import hotkeyManager from '../services/hotkeyManager';
import {
  analyzeComfyWorkflow,
  applyWorkflowOverridesToPromptGraph,
  clonePromptGraph,
  cloneWorkflowUi,
  extractEmbeddedComfyWorkflow,
  updatePromptNodeLiteralValue,
  type ComfyUILoRAConfig,
  type ComfyUIModelFamily,
  type ComfyUIModelResource,
  type ComfyUIPromptGraph,
  type ComfyUISourceImagePolicy,
  type ComfyUIWorkflowMode,
} from '../services/comfyUIWorkflowBuilder';
import { buildVisualWorkflowGraph } from '../services/comfyUIVisualWorkflow';
import ComfyUIWorkflowVisualEditor from './ComfyUIWorkflowVisualEditor';

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

type ModalTab = 'parameters' | 'visual';

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

export function sanitizeStoredModelForWorkflowMode(
  model: ComfyUIModelResource | null,
  workflowMode: ComfyUIWorkflowMode
): ComfyUIModelResource | null {
  if (workflowMode === 'simple' && model?.family !== 'checkpoint') {
    return null;
  }

  return model;
}

const buildMetadataFromParams = (
  params: GenerationParams,
  baseMetadata?: BaseMetadata | null
): BaseMetadata => ({
  ...(baseMetadata || {}),
  prompt: params.prompt,
  negativePrompt: params.negativePrompt,
  model: params.model?.name || baseMetadata?.model || 'unknown',
  cfg_scale: params.cfgScale,
  steps: params.steps,
  seed: params.seed,
  width: params.width,
  height: params.height,
  sampler: params.sampler,
  scheduler: params.scheduler || baseMetadata?.scheduler || 'normal',
  batch_size: params.numberOfImages,
  numberOfImages: params.numberOfImages,
});

const createModelOverrideFromLiteral = (
  family: ComfyUIModelFamily,
  classType: string,
  inputKey: string,
  value: string
): ComfyUIModelResource => ({
  name: value,
  family,
  sourceNode: classType,
  inputKey,
});

const getObjectInfoStringOptions = (
  objectInfo: Record<string, any> | null | undefined,
  classType: string,
  inputKey: string
): Array<string | number | boolean> => {
  const isPrimitiveList = (value: unknown): value is Array<string | number | boolean> =>
    Array.isArray(value) && value.every((entry) => ['string', 'number', 'boolean'].includes(typeof entry));

  const nodeSpec = objectInfo?.[classType];
  if (!nodeSpec?.input) {
    return [];
  }

  const candidateSpecs = [
    nodeSpec.input.required?.[inputKey],
    nodeSpec.input.optional?.[inputKey],
  ].filter(Boolean);

  for (const spec of candidateSpecs) {
    if (isPrimitiveList(spec)) {
      return Array.from(new Set(spec));
    }

    if (!Array.isArray(spec) || spec.length === 0) {
      continue;
    }

    const firstEntry = spec[0];
    if (isPrimitiveList(firstEntry)) {
      return Array.from(new Set(firstEntry));
    }

    const config = spec.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
    if (config && typeof config === 'object') {
      const choices = (config as any).choices || (config as any).values || (config as any).options;
      if (isPrimitiveList(choices)) {
        return Array.from(new Set(choices));
      }
    }
  }

  return [];
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
  const normalizedMetadata = image.metadata?.normalizedMetadata as BaseMetadata | undefined;
  const workflowAnalysis = useMemo(
    () => analyzeComfyWorkflow(image, normalizedMetadata),
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
  const [advancedPromptJsonText, setAdvancedPromptJsonText] = useState('');
  const [advancedWorkflowJsonText, setAdvancedWorkflowJsonText] = useState('');
  const [advancedEditorLoaded, setAdvancedEditorLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<ModalTab>('parameters');
  const [selectedVisualNodeId, setSelectedVisualNodeId] = useState<string | null>(null);
  const [workingPromptGraph, setWorkingPromptGraph] = useState<ComfyUIPromptGraph | null>(null);
  const [workingWorkflowUi, setWorkingWorkflowUi] = useState(embeddedWorkflow.workflow);
  const [isExpandedModal, setIsExpandedModal] = useState(false);

  const visualPromptAnalysis = useMemo(() => {
    if (!workingPromptGraph) {
      return workflowAnalysis;
    }

    return analyzeComfyWorkflow(
      {
        workflow: workingWorkflowUi,
        prompt: workingPromptGraph,
      },
      normalizedMetadata
    );
  }, [normalizedMetadata, workingPromptGraph, workingWorkflowUi, workflowAnalysis]);

  const visualGraph = useMemo(
    () => buildVisualWorkflowGraph(workingPromptGraph, workingWorkflowUi, visualPromptAnalysis),
    [visualPromptAnalysis, workingPromptGraph, workingWorkflowUi]
  );

  const visualFieldOptions = useMemo(() => {
    const fieldOptions: Record<string, Array<string | number | boolean>> = {};

    if (visualGraph && resources?.objectInfo) {
      for (const node of visualGraph.nodes) {
        for (const field of node.fields) {
          const options = getObjectInfoStringOptions(resources.objectInfo, node.classType, field.key);
          if (options.length > 0) {
            fieldOptions[`${node.id}:${field.key}`] = options;
          }
        }
      }
    }

    for (const target of visualPromptAnalysis.modelTargets) {
      const options = (resources?.models || [])
        .filter((model) => model.family === target.family)
        .map((model) => model.name);
      if (options.length > 0) {
        fieldOptions[`${target.nodeId}:${target.inputKey}`] = options;
      }
    }

    for (const target of visualPromptAnalysis.loraTargets) {
      if ((resources?.loras || []).length > 0) {
        fieldOptions[`${target.nodeId}:${target.nameKey}`] = resources?.loras || [];
      }
    }

    for (const nodeId of visualPromptAnalysis.samplerTargets) {
      if ((resources?.samplers || []).length > 0) {
        fieldOptions[`${nodeId}:sampler_name`] = resources?.samplers || [];
      }
      if ((resources?.schedulers || []).length > 0) {
        fieldOptions[`${nodeId}:scheduler`] = resources?.schedulers || [];
      }
    }

    return fieldOptions;
  }, [
    resources?.loras,
    resources?.models,
    resources?.objectInfo,
    resources?.samplers,
    resources?.schedulers,
    visualGraph,
    visualPromptAnalysis,
  ]);

  const patchPromptGraphForParams = (basePrompt: ComfyUIPromptGraph | null, nextParams: GenerationParams) => {
    if (!basePrompt || !workflowAnalysis.originalAvailable) {
      return basePrompt;
    }

    return applyWorkflowOverridesToPromptGraph(
      basePrompt,
      workflowAnalysis,
      buildMetadataFromParams(nextParams, normalizedMetadata),
      {
        model: nextParams.model,
        loras: nextParams.loras,
      }
    ).prompt;
  };

  const applyNextParams = (nextParams: GenerationParams) => {
    setParams(nextParams);
    setValidationError('');

    if (workflowAnalysis.originalAvailable && embeddedWorkflow.prompt) {
      setWorkingPromptGraph((current) => patchPromptGraphForParams(current || embeddedWorkflow.prompt, nextParams));
    }
  };

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

    const storedMode = typeof window !== 'undefined'
      ? localStorage.getItem('IMH_COMFYUI_LAST_MODE') as ComfyUIWorkflowMode | null
      : null;
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

    const nextWorkflowMode = workflowAnalysis.originalAvailable
      ? (storedMode || 'original')
      : 'simple';

    const nextParams: GenerationParams = {
      prompt: normalizedMetadata.prompt || '',
      negativePrompt: normalizedMetadata.negativePrompt || '',
      cfgScale: (normalizedMetadata as any).cfgScale ?? normalizedMetadata.cfg_scale ?? 7,
      steps: normalizedMetadata.steps || 20,
      seed: normalizedMetadata.seed ?? -1,
      randomSeed: storedRandomSeed === 'true',
      numberOfImages: 1,
      width: normalizedMetadata.width || 1024,
      height: normalizedMetadata.height || 1024,
      model: sanitizeStoredModelForWorkflowMode(parsedModel, nextWorkflowMode),
      loras: parsedLoras,
      sampler: normalizedMetadata.sampler || undefined,
      scheduler: normalizedMetadata.scheduler || undefined,
      workflowMode: nextWorkflowMode,
      sourceImagePolicy: storedSourcePolicy || 'reuse_original',
      advancedPromptJson: '',
      advancedWorkflowJson: '',
      maskFile: null,
    };

    setParams(nextParams);
    setWorkingWorkflowUi(cloneWorkflowUi(embeddedWorkflow.workflow));
    setWorkingPromptGraph(
      workflowAnalysis.originalAvailable && embeddedWorkflow.prompt
        ? patchPromptGraphForParams(embeddedWorkflow.prompt, nextParams)
        : clonePromptGraph(embeddedWorkflow.prompt)
    );

    setAdvancedPromptJsonText('');
    setAdvancedWorkflowJsonText('');
    setAdvancedEditorLoaded(false);
    setShowAdvancedEditor(false);
    setValidationError('');
    setModelSearch('');
    setLoraSearch('');
    setActiveTab('parameters');
    setSelectedVisualNodeId(null);
    setIsExpandedModal(false);
  }, [
    embeddedWorkflow.prompt,
    embeddedWorkflow.workflow,
    isOpen,
    normalizedMetadata,
    workflowAnalysis.originalAvailable,
  ]);

  useEffect(() => {
    if (params.workflowMode !== 'original' && activeTab === 'visual') {
      setActiveTab('parameters');
    }
  }, [activeTab, params.workflowMode]);

  useEffect(() => {
    setParams((prev) => {
      const sanitizedModel = sanitizeStoredModelForWorkflowMode(prev.model || null, prev.workflowMode);
      if (sanitizedModel === prev.model) {
        return prev;
      }

      return {
        ...prev,
        model: sanitizedModel,
      };
    });
  }, [params.workflowMode]);

  useEffect(() => {
    if (!showAdvancedEditor || advancedEditorLoaded) {
      return;
    }

    setAdvancedPromptJsonText(formatJson(workingPromptGraph));
    setAdvancedWorkflowJsonText(formatJson(workingWorkflowUi));
    setAdvancedEditorLoaded(true);
  }, [advancedEditorLoaded, showAdvancedEditor, workingPromptGraph, workingWorkflowUi]);

  useEffect(() => {
    if (!visualGraph || visualGraph.nodes.length === 0) {
      setSelectedVisualNodeId(null);
      return;
    }

    if (!selectedVisualNodeId || !visualGraph.nodes.some((node) => node.id === selectedVisualNodeId)) {
      const preferredNode = visualGraph.nodes.find((node) => node.category === 'sampler') || visualGraph.nodes[0];
      setSelectedVisualNodeId(preferredNode.id);
    }
  }, [selectedVisualNodeId, visualGraph]);

  const compatibleModelFamilies = useMemo(() => {
    if (params.workflowMode === 'simple') {
      return new Set<ComfyUIModelFamily>(['checkpoint']);
    }

    return new Set<ComfyUIModelFamily>(
      visualPromptAnalysis.compatibleModelFamilies.length > 0
        ? visualPromptAnalysis.compatibleModelFamilies
        : ['checkpoint']
    );
  }, [params.workflowMode, visualPromptAnalysis.compatibleModelFamilies]);

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

  const isTransformation = visualPromptAnalysis.generationType === 'img2img'
    || visualPromptAnalysis.generationType === 'inpaint'
    || visualPromptAnalysis.generationType === 'outpaint';
  const requiresMaskInput = isTransformation && visualPromptAnalysis.maskTargets.length > 0;
  const visualTabDisabled = params.workflowMode !== 'original' || !workflowAnalysis.originalAvailable || !workingPromptGraph;
  const visualViewportHeight = isExpandedModal ? 720 : 560;

  const syncParamsFromVisualField = (
    currentParams: GenerationParams,
    nodeId: string,
    inputKey: string,
    value: string | number | boolean
  ): GenerationParams => {
    const nextParams = { ...currentParams };

    if (workflowAnalysis.positiveTargets.some((target) => target.nodeId === nodeId && target.inputKey === inputKey)) {
      nextParams.prompt = String(value);
    }

    if (workflowAnalysis.negativeTargets.some((target) => target.nodeId === nodeId && target.inputKey === inputKey)) {
      nextParams.negativePrompt = String(value);
    }

    if (workflowAnalysis.dimensionTargets.some((target) => target.nodeId === nodeId && target.inputKey === inputKey)) {
      if (inputKey === 'width') {
        nextParams.width = Number(value);
      }
      if (inputKey === 'height') {
        nextParams.height = Number(value);
      }
    }

    if (workflowAnalysis.batchTargets.some((target) => target.nodeId === nodeId && target.inputKey === inputKey)) {
      nextParams.numberOfImages = Math.max(1, Math.min(10, Number(value) || 1));
    }

    if (workflowAnalysis.samplerTargets.includes(nodeId)) {
      if (inputKey === 'seed') {
        nextParams.seed = Number(value);
        nextParams.randomSeed = false;
      }
      if (inputKey === 'steps') {
        nextParams.steps = Number(value);
      }
      if (inputKey === 'cfg') {
        nextParams.cfgScale = Number(value);
      }
      if (inputKey === 'sampler_name') {
        nextParams.sampler = String(value);
      }
      if (inputKey === 'scheduler') {
        nextParams.scheduler = String(value);
      }
    }

    const modelTarget = workflowAnalysis.modelTargets.find(
      (target) => target.nodeId === nodeId && target.inputKey === inputKey && typeof value === 'string'
    );
    if (modelTarget) {
      const matchedResource = resources?.models.find(
        (resource) => resource.family === modelTarget.family && resource.name === value
      );
      nextParams.model = matchedResource || createModelOverrideFromLiteral(
        modelTarget.family,
        modelTarget.classType,
        modelTarget.inputKey,
        String(value)
      );
    }

    const loraIndex = workflowAnalysis.loraTargets.findIndex((target) => target.nodeId === nodeId);
    if (loraIndex >= 0) {
      const nextLoras = [...(nextParams.loras || [])];
      const existing = nextLoras[loraIndex] || { name: '', strength: 1 };
      const loraTarget = workflowAnalysis.loraTargets[loraIndex];

      if (inputKey === loraTarget.nameKey) {
        existing.name = String(value);
      }
      if (inputKey === loraTarget.strengthKey) {
        existing.strength = Number(value);
      }

      nextLoras[loraIndex] = existing;
      nextParams.loras = nextLoras.filter((entry) => entry.name.trim().length > 0);
    }

    return nextParams;
  };

  const handleVisualFieldChange = (nodeId: string, inputKey: string, value: string | number | boolean) => {
    if (!workingPromptGraph) {
      return;
    }

    setWorkingPromptGraph((current) => {
      const basePrompt = current || workingPromptGraph;
      return updatePromptNodeLiteralValue(basePrompt, nodeId, inputKey, value);
    });
    setParams((current) => syncParamsFromVisualField(current, nodeId, inputKey, value));
    setValidationError('');
  };

  const handleGenerate = async () => {
    const effectivePrompt = params.prompt.trim();
    if (!effectivePrompt) {
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

    const manualPromptJson = showAdvancedEditor ? advancedPromptJsonText.trim() : '';
    const manualWorkflowJson = showAdvancedEditor ? advancedWorkflowJsonText.trim() : '';

    if (manualPromptJson) {
      try {
        JSON.parse(manualPromptJson);
      } catch {
        setValidationError('Prompt API JSON is invalid.');
        return;
      }
    }

    if (manualWorkflowJson) {
      try {
        JSON.parse(manualWorkflowJson);
      } catch {
        setValidationError('Workflow UI JSON is invalid.');
        return;
      }
    }

    if (params.workflowMode === 'original' && !manualPromptJson && !workingPromptGraph) {
      setValidationError('Original workflow graph is unavailable.');
      return;
    }

    setValidationError('');

    if (typeof window !== 'undefined') {
      localStorage.setItem('IMH_COMFYUI_LAST_MODE', params.workflowMode);
      localStorage.setItem('IMH_COMFYUI_LAST_SOURCE_POLICY', params.sourceImagePolicy);
      localStorage.setItem('IMH_COMFYUI_LAST_RANDOM_SEED', String(params.randomSeed));
      if (params.model) {
        localStorage.setItem('IMH_COMFYUI_LAST_MODEL_OBJECT', JSON.stringify(params.model));
      } else {
        localStorage.removeItem('IMH_COMFYUI_LAST_MODEL_OBJECT');
      }
      if (params.loras && params.loras.length > 0) {
        localStorage.setItem('IMH_COMFYUI_LAST_LORAS', JSON.stringify(params.loras));
      } else {
        localStorage.removeItem('IMH_COMFYUI_LAST_LORAS');
      }
    }

    const resolvedAdvancedPromptJson = params.workflowMode === 'original'
      ? (manualPromptJson || (workingPromptGraph ? JSON.stringify(workingPromptGraph) : ''))
      : undefined;
    const resolvedAdvancedWorkflowJson = params.workflowMode === 'original'
      ? (manualWorkflowJson || (workingWorkflowUi ? JSON.stringify(workingWorkflowUi) : undefined))
      : undefined;

    await onGenerate({
      ...params,
      advancedPromptJson: resolvedAdvancedPromptJson || undefined,
      advancedWorkflowJson: resolvedAdvancedWorkflowJson || undefined,
    });
  };

  const handleAddLora = (loraName: string) => {
    if (!loraName) {
      return;
    }

    applyNextParams({
      ...params,
      loras: [...(params.loras || []), { name: loraName, strength: 1 }],
    });
  };

  const handleUpdateLora = (index: number, strength: number) => {
    applyNextParams({
      ...params,
      loras: (params.loras || []).map((lora, currentIndex) =>
        currentIndex === index ? { ...lora, strength } : lora
      ),
    });
  };

  const handleRemoveLora = (index: number) => {
    applyNextParams({
      ...params,
      loras: (params.loras || []).filter((_, currentIndex) => currentIndex !== index),
    });
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
        className="flex flex-col rounded-lg bg-gray-800 p-6 text-gray-100 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: isExpandedModal ? 'min(96vw, 1680px)' : 'min(92vw, 1320px)',
          height: isExpandedModal ? '92vh' : '88vh',
          maxHeight: '92vh',
          minHeight: '720px',
          resize: 'both',
          overflow: 'hidden',
        }}
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpandedModal((current) => !current)}
              className="rounded-full p-2 text-gray-300 hover:bg-gray-700"
              title={isExpandedModal ? 'Restore modal size' : 'Expand modal'}
            >
              {isExpandedModal ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-700">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-300">Workflow Mode</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                disabled={!workflowAnalysis.originalAvailable}
                onClick={() => applyNextParams({ ...params, workflowMode: 'original' })}
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
                onClick={() => applyNextParams({ ...params, workflowMode: 'simple' })}
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
                  <div
                    key={warning}
                    className="flex items-start gap-2 rounded-md border border-yellow-700/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200"
                  >
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('parameters')}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  activeTab === 'parameters'
                    ? 'bg-purple-500/15 text-purple-100 ring-1 ring-purple-400/40'
                    : 'text-gray-300 hover:bg-gray-800'
                }`}
              >
                <SlidersHorizontal size={16} />
                Parameters
              </button>
              <button
                type="button"
                disabled={visualTabDisabled}
                onClick={() => !visualTabDisabled && setActiveTab('visual')}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  activeTab === 'visual'
                    ? 'bg-blue-500/15 text-blue-100 ring-1 ring-blue-400/40'
                    : 'text-gray-300 hover:bg-gray-800'
                } ${visualTabDisabled ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : ''}`}
              >
                <Eye size={16} />
                Visual Workflow
              </button>
            </div>
          </div>

          {activeTab === 'parameters' ? (
            <>
              <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
                <h3 className="mb-3 text-sm font-semibold text-gray-300">Core</h3>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Prompt</label>
                  <textarea
                    rows={8}
                    value={params.prompt}
                    onChange={(event) => applyNextParams({ ...params, prompt: event.target.value })}
                    className="w-full resize-y rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div className="mt-4 space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Negative Prompt</label>
                  <textarea
                    rows={5}
                    value={params.negativePrompt}
                    onChange={(event) => applyNextParams({ ...params, negativePrompt: event.target.value })}
                    className="w-full resize-y rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">Sampler</label>
                    <select
                      value={params.sampler || ''}
                      onChange={(event) => applyNextParams({ ...params, sampler: event.target.value || undefined })}
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
                      onChange={(event) => applyNextParams({ ...params, scheduler: event.target.value || undefined })}
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
                      onChange={(event) => applyNextParams({ ...params, cfgScale: parseFloat(event.target.value) || 0 })}
                      className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </label>
                  <label className="space-y-2 text-sm font-medium text-gray-300">
                    <span>Steps</span>
                    <input
                      type="number"
                      min="1"
                      value={params.steps}
                      onChange={(event) => applyNextParams({ ...params, steps: parseInt(event.target.value, 10) || 0 })}
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
                      onChange={(event) => applyNextParams({ ...params, width: parseInt(event.target.value, 10) || 512 })}
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
                      onChange={(event) => applyNextParams({ ...params, height: parseInt(event.target.value, 10) || 512 })}
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
                      onChange={(event) => applyNextParams({ ...params, seed: parseInt(event.target.value, 10) || -1 })}
                      className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
                    />
                  </label>
                  <label className="flex items-center gap-2 self-end rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={params.randomSeed}
                      onChange={(event) => applyNextParams({ ...params, randomSeed: event.target.checked })}
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
                      onChange={(event) =>
                        applyNextParams({
                          ...params,
                          numberOfImages: Math.max(1, Math.min(10, parseInt(event.target.value, 10) || 1)),
                        })}
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
                        applyNextParams({ ...params, model: nextModel });
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
                        <div
                          key={`${lora.name}-${index}`}
                          className="flex items-center gap-2 rounded-full border border-purple-700/50 bg-purple-900/30 px-3 py-1.5 text-xs"
                        >
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
                      onChange={(event) =>
                        applyNextParams({
                          ...params,
                          sourceImagePolicy: event.target.value as ComfyUISourceImagePolicy,
                        })}
                      className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="reuse_original">Reuse original workflow assets</option>
                      <option value="selected_image">Use selected image</option>
                      {requiresMaskInput && <option value="selected_image_and_mask">Use selected image + selected mask</option>}
                    </select>
                    <div className="text-xs text-gray-400">
                      Generation type detected: <span className="font-semibold text-gray-200">{visualPromptAnalysis.generationType}</span>
                    </div>
                    {params.sourceImagePolicy === 'selected_image_and_mask' && requiresMaskInput && (
                      <label className="block space-y-2 text-sm font-medium text-gray-300">
                        <span>Mask File</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(event) => applyNextParams({ ...params, maskFile: event.target.files?.[0] || null })}
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
                  onClick={() => {
                    const next = !showAdvancedEditor;
                    setShowAdvancedEditor(next);
                    if (next) {
                      setAdvancedPromptJsonText(formatJson(workingPromptGraph));
                      setAdvancedWorkflowJsonText(formatJson(workingWorkflowUi));
                      setAdvancedEditorLoaded(true);
                    }
                  }}
                  className="flex w-full items-center justify-between text-left text-sm font-semibold text-gray-300"
                >
                  <span>Advanced / Debug</span>
                  {showAdvancedEditor ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
                {showAdvancedEditor && (
                  <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                      <span>Prompt API JSON is authoritative for execution in original mode.</span>
                      <button
                        type="button"
                        onClick={() => {
                          setAdvancedPromptJsonText(formatJson(workingPromptGraph));
                          setAdvancedWorkflowJsonText(formatJson(workingWorkflowUi));
                        }}
                        className="rounded border border-gray-700 px-2 py-1 text-gray-300 hover:bg-gray-800"
                      >
                        Reload current state
                      </button>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-300">Prompt API JSON</label>
                      <textarea
                        rows={10}
                        value={advancedPromptJsonText}
                        onChange={(event) => setAdvancedPromptJsonText(event.target.value)}
                        className="w-full resize-y rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-300">Workflow UI JSON</label>
                      <textarea
                        rows={8}
                        value={advancedWorkflowJsonText}
                        onChange={(event) => setAdvancedWorkflowJsonText(event.target.value)}
                        className="w-full resize-y rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div className="text-xs text-gray-400">
                      Use this only for debugging or edge cases. The visual editor is meant to replace direct JSON editing for normal workflow adjustments.
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              {visualTabDisabled ? (
                <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-6 text-sm text-gray-400">
                  Visual editing is available only in <span className="font-semibold text-gray-200">Original workflow</span> mode with an embedded executable prompt graph.
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-blue-700/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
                    Visual edits update the same working prompt graph used for original workflow execution. Structural graph editing is intentionally out of scope for v1.
                  </div>
                  <ComfyUIWorkflowVisualEditor
                    graph={visualGraph}
                    selectedNodeId={selectedVisualNodeId}
                    fieldOptions={visualFieldOptions}
                    viewportHeight={visualViewportHeight}
                    onSelectNode={setSelectedVisualNodeId}
                    onFieldChange={handleVisualFieldChange}
                  />
                </>
              )}
            </div>
          )}
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

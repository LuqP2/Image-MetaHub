import { useTranslation } from '../i18n/useTranslation';
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, ChevronDown, ChevronUp, Workflow, X } from 'lucide-react';
import { BaseMetadata, IndexedImage } from '../types';
import { useComfyUIModels } from '../hooks/useComfyUIModels';
import { useSettingsStore } from '../store/useSettingsStore';
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
import {
  hasCompactedRuntimeMetadata,
  hydrateImageForEmbeddedComfyWorkflow,
} from '../services/comfyUIWorkflowHydration';
import { buildVisualWorkflowGraph } from '../services/comfyUIVisualWorkflow';
import ComfyUIWorkflowNodeList from './ComfyUIWorkflowNodeList';
import ComfyUIWorkflowVisualEditor from './ComfyUIWorkflowVisualEditor';

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

type WorkspaceTab = 'workflow' | 'nodes';
const WORKSPACE_TAB_STORAGE_KEY = 'IMH_COMFYUI_LAST_WORKSPACE_TAB';

interface ComfyUIWorkflowWorkspaceProps {
  image: IndexedImage;
  onGenerate: (params: GenerationParams) => Promise<void>;
  isGenerating: boolean;
  defaultTab?: WorkspaceTab;
  viewportHeight?: number;
  onCancel?: () => void;
  showCancelButton?: boolean;
  status?: { success: boolean; message: string } | null;
  generateDisabledReason?: string | null;
  directoryPath?: string;
}

const formatJson = (value: unknown): string => {
  if (!value) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    console.warn('[ComfyUIWorkflowWorkspace] Failed to format workflow JSON', error);
    return '';
  }
};

const parseStoredJson = <T,>(value: string | null, label: string): T | null => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn(`[ComfyUIWorkflowWorkspace] Failed to parse ${label}`, error);
    return null;
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

const renderSelectOrTextInput = ({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
}) => {
  if (options.length > 0) {
    return (
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="ui-select w-full"
      >
        {!value && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="ui-input w-full"
    />
  );
};

export const ComfyUIWorkflowWorkspace: React.FC<ComfyUIWorkflowWorkspaceProps> = ({
  image,
  onGenerate,
  isGenerating,
  defaultTab = 'workflow',
  viewportHeight = 560,
  onCancel,
  showCancelButton = true,
  status = null,
  generateDisabledReason = null,
  directoryPath,
}) => {
  const { t: tr } = useTranslation();
  const MODEL_FAMILY_LABELS: Record<ComfyUIModelFamily, string> = {
    checkpoint: tr('librarySearch.checkpoint'),
    unet: 'UNet',
    vae: 'VAE',
    clip: 'CLIP',
    lora: 'LoRA',
    unknown: tr('libraryGallery.unknown'),
  };

  const { resources, isLoading: isLoadingResources, error: resourcesError } = useComfyUIModels();
  const comfyUILastConnectionStatus = useSettingsStore((state) => state.comfyUILastConnectionStatus);
  const [workflowSourceImage, setWorkflowSourceImage] = useState<IndexedImage>(image);
  const analysisImage = workflowSourceImage.id === image.id ? workflowSourceImage : image;
  const normalizedMetadata = (
    image.metadata?.normalizedMetadata ?? analysisImage.metadata?.normalizedMetadata
  ) as BaseMetadata | undefined;
  const workflowAnalysis = useMemo(
    () => analyzeComfyWorkflow(analysisImage, normalizedMetadata),
    [analysisImage, normalizedMetadata]
  );
  const embeddedWorkflow = useMemo(() => extractEmbeddedComfyWorkflow(analysisImage), [analysisImage]);

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
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(defaultTab);
  const [selectedVisualNodeId, setSelectedVisualNodeId] = useState<string | null>(null);
  const [workingPromptGraph, setWorkingPromptGraph] = useState<ComfyUIPromptGraph | null>(null);
  const [workingWorkflowUi, setWorkingWorkflowUi] = useState(embeddedWorkflow.workflow);

  useEffect(() => {
    let isCancelled = false;
    setWorkflowSourceImage(image);

    if (extractEmbeddedComfyWorkflow(image).prompt || !hasCompactedRuntimeMetadata(image)) {
      return () => {
        isCancelled = true;
      };
    }

    void hydrateImageForEmbeddedComfyWorkflow(image, directoryPath).then((hydratedImage) => {
      if (!isCancelled) {
        setWorkflowSourceImage(hydratedImage);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [
    directoryPath,
    image.contentModifiedMs,
    image.directoryId,
    image.id,
    image.lastModified,
    image.metadata,
    image.metadataString,
  ]);

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

  const persistActiveTab = (tab: WorkspaceTab) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(WORKSPACE_TAB_STORAGE_KEY, tab);
    }
  };

  const changeActiveTab = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    persistActiveTab(tab);
  };

  useEffect(() => {
    if (!normalizedMetadata) {
      return;
    }

    const storedSourcePolicy = typeof window !== 'undefined'
      ? localStorage.getItem('IMH_COMFYUI_LAST_SOURCE_POLICY') as ComfyUISourceImagePolicy | null
      : null;
    const storedModel = typeof window !== 'undefined' ? localStorage.getItem('IMH_COMFYUI_LAST_MODEL_OBJECT') : null;
    const storedLoras = typeof window !== 'undefined' ? localStorage.getItem('IMH_COMFYUI_LAST_LORAS') : null;
    const storedRandomSeed = typeof window !== 'undefined' ? localStorage.getItem('IMH_COMFYUI_LAST_RANDOM_SEED') : null;
    const storedWorkspaceTab = typeof window !== 'undefined'
      ? localStorage.getItem(WORKSPACE_TAB_STORAGE_KEY) as WorkspaceTab | null
      : null;

    const parsedModel = parseStoredJson<ComfyUIModelResource>(storedModel, 'stored ComfyUI model');
    const parsedLoras = parseStoredJson<ComfyUILoRAConfig[]>(storedLoras, 'stored ComfyUI LoRAs') ?? [];

    const nextWorkflowMode: ComfyUIWorkflowMode = workflowAnalysis.originalAvailable ? 'original' : 'simple';

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
    const preferredTab = storedWorkspaceTab === 'nodes' ? 'nodes' : defaultTab;
    setActiveTab(workflowAnalysis.originalAvailable ? preferredTab : 'workflow');
    setSelectedVisualNodeId(null);
  }, [
    defaultTab,
    embeddedWorkflow.prompt,
    embeddedWorkflow.workflow,
    image.id,
    normalizedMetadata,
    workflowAnalysis.originalAvailable,
  ]);

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
  const workflowUnavailable = !workflowAnalysis.originalAvailable || !workingPromptGraph;
  const workflowEditingUnavailable = workflowUnavailable || params.workflowMode !== 'original';

  useEffect(() => {
    if (workflowEditingUnavailable && activeTab === 'nodes') {
      setActiveTab('workflow');
      persistActiveTab('workflow');
    }
  }, [activeTab, workflowEditingUnavailable]);

  const effectiveGenerateDisabledReason = useMemo(() => {
    if (generateDisabledReason) {
      return generateDisabledReason;
    }

    if (comfyUILastConnectionStatus === 'error' || (!!resourcesError && !resources)) {
      return tr('integrations.comfyWorkflow.serverOffline');
    }

    return null;
  }, [comfyUILastConnectionStatus, generateDisabledReason, resources, resourcesError, tr]);

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

  const handleManualModelChange = (value: string) => {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      applyNextParams({ ...params, model: null });
      return;
    }

    const fallbackFamily = params.model?.family
      || Array.from(compatibleModelFamilies)[0]
      || 'checkpoint';

    applyNextParams({
      ...params,
      model: createModelOverrideFromLiteral(fallbackFamily, 'Manual', 'model', trimmedValue),
    });
  };

  const handleAddLora = (loraName: string) => {
    const trimmedName = loraName.trim();
    if (!trimmedName) {
      return;
    }

    applyNextParams({
      ...params,
      loras: [...(params.loras || []), { name: trimmedName, strength: 1 }],
    });
    setLoraSearch('');
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

  const handleGenerate = async () => {
    const effectivePrompt = params.prompt.trim();
    if (!effectivePrompt) {
      setValidationError(tr('integrations.comfyWorkflow.promptEmpty'));
      return;
    }

    if (effectiveGenerateDisabledReason) {
      setValidationError(effectiveGenerateDisabledReason);
      return;
    }

    if (params.workflowMode === 'original' && !workflowAnalysis.originalAvailable) {
      setValidationError(tr('integrations.comfyWorkflow.originalUnavailable'));
      return;
    }

    if (params.sourceImagePolicy === 'selected_image_and_mask' && requiresMaskInput && !params.maskFile) {
      setValidationError(tr('integrations.comfyWorkflow.selectMaskFirst'));
      return;
    }

    const manualPromptJson = showAdvancedEditor ? advancedPromptJsonText.trim() : '';
    const manualWorkflowJson = showAdvancedEditor ? advancedWorkflowJsonText.trim() : '';

    if (manualPromptJson) {
      try {
        JSON.parse(manualPromptJson);
      } catch {
        setValidationError(tr('integrations.comfyWorkflow.invalidPromptApiJson'));
        return;
      }
    }

    if (manualWorkflowJson) {
      try {
        JSON.parse(manualWorkflowJson);
      } catch {
        setValidationError(tr('integrations.comfyWorkflow.invalidWorkflowUiJson'));
        return;
      }
    }

    if (params.workflowMode === 'original' && !manualPromptJson && !workingPromptGraph) {
      setValidationError(tr('integrations.comfyWorkflow.originalGraphUnavailable'));
      return;
    }

    setValidationError('');

    if (typeof window !== 'undefined') {
      localStorage.setItem('IMH_COMFYUI_LAST_SOURCE_POLICY', params.sourceImagePolicy);
      localStorage.setItem('IMH_COMFYUI_LAST_RANDOM_SEED', String(params.randomSeed));
      localStorage.setItem(WORKSPACE_TAB_STORAGE_KEY, activeTab);
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

  if (!normalizedMetadata) {
    return (
      <div className="rounded-lg border border-red-700/40 bg-red-500/10 p-4 text-sm text-red-200">
        {tr('integrations.comfyWorkflow.insufficientMetadata')}</div>
    );
  }

  return (
    <div className="space-y-4">
      {(workflowAnalysis.warnings.length > 0 || resourcesError || effectiveGenerateDisabledReason) && (
        <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
          {workflowAnalysis.warnings.length > 0 && (
            <div className="space-y-2">
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
          {resourcesError && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-gray-700 bg-gray-950/70 px-3 py-2 text-xs text-gray-300">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-300" />
              <span>
                {tr('integrations.comfyWorkflow.catalogUnavailable')}</span>
            </div>
          )}
          {effectiveGenerateDisabledReason && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-red-700/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{effectiveGenerateDisabledReason}</span>
            </div>
          )}
        </div>
      )}

      {workflowUnavailable && (
        <div className="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{tr('integrations.comfyWorkflow.noExecutableWorkflow')}</span>
        </div>
      )}

      <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => changeActiveTab('workflow')}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
              activeTab === 'workflow'
                ? 'bg-accent/15 text-accent ring-1 ring-accent/40'
                : 'text-gray-300 hover:bg-gray-800'
            }`}
          >
            <Workflow size={16} />
            {tr('integrations.comfyWorkflow.tabWorkflow')}</button>
          <button
            type="button"
            disabled={workflowEditingUnavailable}
            onClick={() => changeActiveTab('nodes')}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
              activeTab === 'nodes'
                ? 'bg-accent/15 text-accent ring-1 ring-accent/40'
                : 'text-gray-300 hover:bg-gray-800'
            } ${workflowEditingUnavailable ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : ''}`}
          >
            <Boxes size={16} />
            {tr('integrations.comfyWorkflow.tabNodes')}</button>
        </div>
      </div>

      {activeTab === 'workflow' ? (
        <>
          {workflowEditingUnavailable ? (
            <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-6 text-sm text-gray-400">
              {workflowUnavailable
                ? tr('integrations.comfyWorkflow.visualUnavailableNoGraph')
                : tr('integrations.comfyWorkflow.visualDisabledSimpleMode')}
            </div>
          ) : (
            <ComfyUIWorkflowVisualEditor
              key={image.id}
              graph={visualGraph}
              selectedNodeId={selectedVisualNodeId}
              fieldOptions={visualFieldOptions}
              viewportHeight={viewportHeight}
              onSelectNode={setSelectedVisualNodeId}
              onFieldChange={handleVisualFieldChange}
            />
          )}

          <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-300">{tr('integrations.comfyWorkflow.sectionCore')}</h3>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">{tr('libraryGallery.prompt')}</label>
              <textarea
                rows={8}
                value={params.prompt}
                onChange={(event) => applyNextParams({ ...params, prompt: event.target.value })}
                className="ui-input w-full resize-y font-mono"
              />
            </div>
            <div className="mt-4 space-y-2">
              <label className="block text-sm font-medium text-gray-300">{tr('libraryGallery.negativePrompt')}</label>
              <textarea
                rows={5}
                value={params.negativePrompt}
                onChange={(event) => applyNextParams({ ...params, negativePrompt: event.target.value })}
                className="ui-input w-full resize-y font-mono"
              />
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">{tr('librarySearch.sampler')}</label>
                {renderSelectOrTextInput({
                  value: params.sampler || '',
                  options: resources?.samplers || [],
                  placeholder: tr('integrations.comfyWorkflow.typeSamplerPlaceholder'),
                  onChange: (value) => applyNextParams({ ...params, sampler: value || undefined }),
                })}
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">{tr('librarySearch.scheduler')}</label>
                {renderSelectOrTextInput({
                  value: params.scheduler || '',
                  options: resources?.schedulers || [],
                  placeholder: tr('integrations.comfyWorkflow.typeSchedulerPlaceholder'),
                  onChange: (value) => applyNextParams({ ...params, scheduler: value || undefined }),
                })}
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
                  className="ui-input w-full"
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-gray-300">
                <span>{tr('libraryGallery.steps')}</span>
                <input
                  type="number"
                  min="1"
                  value={params.steps}
                  onChange={(event) => applyNextParams({ ...params, steps: parseInt(event.target.value, 10) || 0 })}
                  className="ui-input w-full"
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-gray-300">
                <span>{tr('comparison.width')}</span>
                <input
                  type="number"
                  min="64"
                  step="64"
                  value={params.width}
                  onChange={(event) => applyNextParams({ ...params, width: parseInt(event.target.value, 10) || 512 })}
                  className="ui-input w-full"
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-gray-300">
                <span>{tr('comparison.height')}</span>
                <input
                  type="number"
                  min="64"
                  step="64"
                  value={params.height}
                  onChange={(event) => applyNextParams({ ...params, height: parseInt(event.target.value, 10) || 512 })}
                  className="ui-input w-full"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="space-y-2 text-sm font-medium text-gray-300">
                <span>{tr('libraryGallery.seed')}</span>
                <input
                  type="number"
                  value={params.randomSeed ? -1 : params.seed}
                  disabled={params.randomSeed}
                  onChange={(event) => applyNextParams({ ...params, seed: parseInt(event.target.value, 10) || -1 })}
                  className="ui-input w-full"
                />
              </label>
              <label className="flex items-center gap-2 self-end rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={params.randomSeed}
                  onChange={(event) => applyNextParams({ ...params, randomSeed: event.target.checked })}
                />
                {tr('integrations.a1111.randomSeed')}</label>
              <label className="space-y-2 text-sm font-medium text-gray-300">
                <span>{tr('librarySearch.images')}</span>
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
                  className="ui-input w-full"
                />
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-300">{tr('integrations.comfyWorkflow.sectionModeling')}</h3>
            <div className="mb-2 flex flex-wrap gap-2 text-xs text-gray-400">
              {Array.from(compatibleModelFamilies).map((family) => (
                <span key={family} className="rounded-full border border-gray-700 px-2 py-0.5">
                  {MODEL_FAMILY_LABELS[family]}
                </span>
              ))}
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">{tr('libraryGallery.model')}</label>
              <input
                type="text"
                value={modelSearch}
                onChange={(event) => setModelSearch(event.target.value)}
                placeholder={tr('integrations.a1111.searchModelPlaceholder')}
                className="ui-input w-full"
              />
              {isLoadingResources ? (
                <div className="text-xs text-gray-400">{tr('integrations.a1111.loadingModels')}</div>
              ) : filteredModels.length > 0 ? (
                <select
                  value={params.model ? `${params.model.family}:${params.model.name}` : ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    const nextModel = filteredModels.find((model) => `${model.family}:${model.name}` === value) || null;
                    applyNextParams({ ...params, model: nextModel });
                  }}
                  className="ui-select w-full"
                >
                  {!params.model && <option value="">{tr('integrations.comfyWorkflow.useCurrentModel')}</option>}
                  {filteredModels.map((model) => (
                    <option key={`${model.family}:${model.name}`} value={`${model.family}:${model.name}`}>
                      [{MODEL_FAMILY_LABELS[model.family]}] {model.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={params.model?.name || ''}
                  onChange={(event) => handleManualModelChange(event.target.value)}
                  placeholder={tr('integrations.comfyWorkflow.typeModelPlaceholder')}
                  className="ui-input w-full"
                />
              )}
            </div>

            <div className="mt-4 space-y-2">
              <label className="block text-sm font-medium text-gray-300">{tr('comparison.loras')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={loraSearch}
                  onChange={(event) => setLoraSearch(event.target.value)}
                  placeholder={tr('integrations.comfyWorkflow.searchLoraPlaceholder')}
                  className="ui-input w-full"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleAddLora(loraSearch);
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleAddLora(loraSearch)}
                  className="ui-btn"
                >
                  {tr('automation.addButton')}</button>
              </div>
              {filteredLoras.length > 0 && (
                <select
                  onChange={(event) => {
                    if (event.target.value) {
                      handleAddLora(event.target.value);
                      event.target.value = '';
                    }
                  }}
                  className="ui-select w-full"
                >
                  <option value="">{tr('integrations.comfyWorkflow.addFromCatalog')}</option>
                  {filteredLoras.map((lora) => (
                    <option key={lora} value={lora}>{lora}</option>
                  ))}
                </select>
              )}
              {(params.loras || []).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {(params.loras || []).map((lora, index) => (
                    <div
                      key={`${lora.name}-${index}`}
                      className="flex items-center gap-2 rounded-full border border-accent/50 bg-accent/30 px-3 py-1.5 text-xs"
                    >
                      <span className="font-medium text-accent">{lora.name}</span>
                      <input
                        type="number"
                        step="0.1"
                        min="-2"
                        max="2"
                        value={lora.strength}
                        onChange={(event) => handleUpdateLora(index, parseFloat(event.target.value) || 0)}
                        className="ui-input w-14 text-center"
                      />
                      <button onClick={() => handleRemoveLora(index)} className="text-accent hover:text-accent">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs italic text-gray-500">{tr('integrations.comfyWorkflow.noLorasSelected')}</p>
              )}
            </div>
          </div>

          {isTransformation && (
            <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-300">{tr('imageViewer.editor.transform')}</h3>
              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-300">{tr('integrations.comfyWorkflow.sourceImagePolicy')}</label>
                <select
                  value={params.sourceImagePolicy}
                  onChange={(event) =>
                    applyNextParams({
                      ...params,
                      sourceImagePolicy: event.target.value as ComfyUISourceImagePolicy,
                    })}
                  className="ui-select w-full"
                >
                  <option value="reuse_original">{tr('integrations.comfyWorkflow.policyReuseOriginal')}</option>
                  <option value="selected_image">{tr('integrations.comfyWorkflow.policySelectedImage')}</option>
                  {requiresMaskInput && <option value="selected_image_and_mask">{tr('integrations.comfyWorkflow.policySelectedImageAndMask')}</option>}
                </select>
                <div className="text-xs text-gray-400">
                  {tr('integrations.comfyWorkflow.generationTypeDetected', { type: visualPromptAnalysis.generationType })}
                </div>
                {params.sourceImagePolicy === 'selected_image_and_mask' && requiresMaskInput && (
                  <label className="block space-y-2 text-sm font-medium text-gray-300">
                    <span>{tr('integrations.comfyWorkflow.maskFile')}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => applyNextParams({ ...params, maskFile: event.target.files?.[0] || null })}
                      className="block w-full text-sm text-gray-300 file:mr-4 file:rounded file:border-0 file:bg-accent/20 file:px-3 file:py-2 file:text-sm file:font-medium file:text-accent hover:file:bg-accent/30"
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
              <span>{tr('integrations.comfyWorkflow.advancedDebug')}</span>
              {showAdvancedEditor ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {showAdvancedEditor && (
              <div className="mt-4 space-y-4">
                {workflowAnalysis.originalAvailable && (
                  <label className="flex items-start gap-3 rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-3 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={params.workflowMode === 'simple'}
                      onChange={(event) =>
                        applyNextParams({
                          ...params,
                          workflowMode: event.target.checked ? 'simple' : 'original',
                        })
                      }
                      className="ui-checkbox mt-0.5"
                    />
                    <span>
                      <span className="block font-medium text-gray-100">{tr('integrations.comfyWorkflow.useSimpleCompatibility')}</span>
                      <span className="mt-1 block text-xs text-gray-400">
                        {tr('integrations.comfyWorkflow.useSimpleCompatibilityHelp')}</span>
                    </span>
                  </label>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                  <span>{tr('integrations.comfyWorkflow.promptApiAuthoritative')}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setAdvancedPromptJsonText(formatJson(workingPromptGraph));
                      setAdvancedWorkflowJsonText(formatJson(workingWorkflowUi));
                    }}
                    className="ui-btn"
                  >
                    {tr('integrations.comfyWorkflow.reloadCurrentState')}</button>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">{tr('integrations.comfyWorkflow.promptApiJson')}</label>
                  <textarea
                    rows={10}
                    value={advancedPromptJsonText}
                    onChange={(event) => setAdvancedPromptJsonText(event.target.value)}
                    className="ui-input w-full resize-y font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">{tr('integrations.comfyWorkflow.workflowUiJson')}</label>
                  <textarea
                    rows={8}
                    value={advancedWorkflowJsonText}
                    onChange={(event) => setAdvancedWorkflowJsonText(event.target.value)}
                    className="ui-input w-full resize-y font-mono"
                  />
                </div>
                <div className="text-xs text-gray-400">
                  {tr('integrations.comfyWorkflow.debugOnlyHint')}</div>
              </div>
            )}
          </div>
        </>
      ) : (
        <ComfyUIWorkflowNodeList
          graph={visualGraph}
          fieldOptions={visualFieldOptions}
          onFieldChange={handleVisualFieldChange}
        />
      )}

      <div className="flex items-center justify-end gap-3">
        {showCancelButton && onCancel && (
          <button
            onClick={onCancel}
            className="ui-btn"
          >
            {tr('batchExport.cancel')}</button>
        )}
        <button
          onClick={handleGenerate}
          disabled={isGenerating || Boolean(effectiveGenerateDisabledReason)}
          className="ui-btn-primary"
        >
          {isGenerating ? tr('imageViewer.preview.generating') : tr('libraryGallery.generate')}
        </button>
      </div>

      {(status || validationError) && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            status?.success && !validationError
              ? 'border-green-700/40 bg-green-500/10 text-green-200'
              : 'border-red-700/40 bg-red-500/10 text-red-200'
          }`}
        >
          {validationError || status?.message}
        </div>
      )}
    </div>
  );
};

export default ComfyUIWorkflowWorkspace;

import {
  type BaseMetadata,
  type ComfyUIPrompt,
  type ComfyUIWorkflow as ComfyUIWorkflowUi,
  type GenerationType,
  type IndexedImage,
  type SourceImageReference,
} from '../types';
import { resolvePromptFromGraph } from './parsers/comfyUIParser';

export type ComfyUIWorkflowMode = 'original' | 'simple';
export type ComfyUISourceImagePolicy =
  | 'reuse_original'
  | 'selected_image'
  | 'selected_image_and_mask';

export type ComfyUIModelFamily =
  | 'checkpoint'
  | 'unet'
  | 'vae'
  | 'clip'
  | 'lora'
  | 'unknown';

export interface ComfyUIModelResource {
  name: string;
  family: ComfyUIModelFamily;
  sourceNode: string;
  inputKey: string;
}

export interface ComfyUILoRAConfig {
  name: string;
  strength: number;
}

export interface ComfyUIWorkflowOverrides {
  model?: ComfyUIModelResource | null;
  loras?: ComfyUILoRAConfig[];
}

export interface ComfyUIResourceCatalog {
  models: ComfyUIModelResource[];
  loras: string[];
  samplers: string[];
  schedulers: string[];
}

export interface ComfyUIPromptNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: {
    title?: string;
  };
}

export type ComfyUIPromptGraph = Record<string, ComfyUIPromptNode>;

export interface ComfyUIExecutionPayload {
  prompt: ComfyUIPromptGraph;
  client_id: string;
  extra_data?: {
    extra_pnginfo?: Record<string, unknown>;
  };
}

export interface TextTarget {
  nodeId: string;
  inputKey: string;
}

export interface ModelTarget {
  nodeId: string;
  inputKey: string;
  family: ComfyUIModelFamily;
  classType: string;
}

export interface LoRATarget {
  nodeId: string;
  nameKey: string;
  strengthKey: string;
}

export interface AssetTarget {
  nodeId: string;
  inputKey: string;
}

export interface ComfyWorkflowAnalysis {
  rawWorkflow: ComfyUIWorkflowUi | null;
  rawPrompt: ComfyUIPromptGraph | null;
  originalAvailable: boolean;
  generationType?: GenerationType;
  positiveTargets: TextTarget[];
  negativeTargets: TextTarget[];
  samplerTargets: string[];
  modelTargets: ModelTarget[];
  loraTargets: LoRATarget[];
  imageTargets: AssetTarget[];
  maskTargets: AssetTarget[];
  dimensionTargets: TextTarget[];
  batchTargets: TextTarget[];
  saveNodeIds: string[];
  timerNodeIds: string[];
  compatibleModelFamilies: ComfyUIModelFamily[];
  warnings: string[];
}

export interface PrepareOriginalWorkflowOptions {
  image: IndexedImage;
  metadata: BaseMetadata;
  clientId: string;
  sourceImagePolicy: ComfyUISourceImagePolicy;
  overrides?: ComfyUIWorkflowOverrides;
  advancedPromptJson?: string;
  advancedWorkflowJson?: string;
  maskFile?: File | null;
  uploadAsset?: (file: File, kind: 'image' | 'mask') => Promise<string>;
}

export interface PreparedComfyExecution {
  payload: ComfyUIExecutionPayload;
  modeUsed: ComfyUIWorkflowMode;
  warnings: string[];
  analysis: ComfyWorkflowAnalysis | null;
}

const MODEL_INPUT_KEYS: Record<string, ComfyUIModelFamily> = {
  ckpt_name: 'checkpoint',
  checkpoint: 'checkpoint',
  unet_name: 'unet',
  vae_name: 'vae',
  clip_name: 'clip',
  clip_name1: 'clip',
  clip_name2: 'clip',
  lora_name: 'lora',
};

const UNIQUE_MODEL_LOADERS: Array<{ node: string; inputKey: string; family: ComfyUIModelFamily }> = [
  { node: 'CheckpointLoaderSimple', inputKey: 'ckpt_name', family: 'checkpoint' },
  { node: 'CheckpointLoader', inputKey: 'ckpt_name', family: 'checkpoint' },
  { node: 'UNETLoader', inputKey: 'unet_name', family: 'unet' },
  { node: 'UnetLoaderGGUF', inputKey: 'unet_name', family: 'unet' },
  { node: 'VAELoader', inputKey: 'vae_name', family: 'vae' },
  { node: 'CLIPLoader', inputKey: 'clip_name', family: 'clip' },
  { node: 'DualCLIPLoader', inputKey: 'clip_name1', family: 'clip' },
  { node: 'TripleCLIPLoader', inputKey: 'clip_name1', family: 'clip' },
];

const TEXT_INPUT_PREFERENCES = ['text', 'prompt', 'positive', 'negative', 'positive_prompt', 'negative_prompt'];
type UnknownRecord = Record<string, unknown>;
type WorkflowMetadata = BaseMetadata & {
  cfgScale?: number;
  denoise?: number;
  batch_size?: number;
  numberOfImages?: number;
};
type ComfyUIResourceCatalogInfoNode = {
  input?: {
    required?: Record<string, [unknown[]]>;
  };
};
type ComfyUIResourceCatalogInfo = Record<string, ComfyUIResourceCatalogInfoNode>;

function sanitizeJsonString(value: string): string {
  return value.replace(/\bNaN\b/g, 'null');
}

function parseMaybeJson<T>(value: unknown): T | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value as T;
  }

  if (typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(sanitizeJsonString(value)) as T;
  } catch {
    return null;
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function generateRandomSeed(): number {
  return Math.floor(Math.random() * 1000000000);
}

function resolveExecutionSeed(seed: unknown): number {
  if (typeof seed === 'number' && Number.isFinite(seed) && seed >= 0) {
    return Math.floor(seed);
  }

  return generateRandomSeed();
}

export function clonePromptGraph(prompt: ComfyUIPromptGraph | null | undefined): ComfyUIPromptGraph | null {
  return prompt ? cloneJson(prompt) : null;
}

export function cloneWorkflowUi(workflow: ComfyUIWorkflowUi | null | undefined): ComfyUIWorkflowUi | null {
  return workflow ? cloneJson(workflow) : null;
}

function isPromptGraph(value: unknown): value is ComfyUIPromptGraph {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value as Record<string, unknown>).some(
    (node) => isRecord(node) && typeof (node as UnknownRecord).class_type === 'string'
  );
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getNodeIdFromConnection(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const [nodeId] = value;
  return typeof nodeId === 'string' ? nodeId : typeof nodeId === 'number' ? String(nodeId) : null;
}

function nextNodeId(prompt: ComfyUIPromptGraph): string {
  const maxId = Object.keys(prompt).reduce((max, key) => {
    const numeric = Number(key);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);
  return String(maxId + 1);
}

function detectModelTarget(nodeId: string, node: ComfyUIPromptNode): ModelTarget[] {
  const targets: ModelTarget[] = [];

  for (const [inputKey, inputValue] of Object.entries(node.inputs || {})) {
    if (typeof inputValue !== 'string') {
      continue;
    }

    const directFamily = MODEL_INPUT_KEYS[inputKey];
    if (directFamily && directFamily !== 'lora') {
      targets.push({
        nodeId,
        inputKey,
        family: directFamily,
        classType: node.class_type,
      });
      continue;
    }

    if (inputKey === 'model_name') {
      const classType = node.class_type.toLowerCase();
      const family: ComfyUIModelFamily = classType.includes('unet')
        ? 'unet'
        : classType.includes('vae')
          ? 'vae'
          : classType.includes('clip')
            ? 'clip'
            : classType.includes('checkpoint')
              ? 'checkpoint'
              : 'unknown';
      targets.push({
        nodeId,
        inputKey,
        family,
        classType: node.class_type,
      });
    }
  }

  return targets;
}

function addUniqueTextTarget(targets: TextTarget[], next: TextTarget): void {
  if (!targets.some((target) => target.nodeId === next.nodeId && target.inputKey === next.inputKey)) {
    targets.push(next);
  }
}

function addUniqueAssetTarget(targets: AssetTarget[], next: AssetTarget): void {
  if (!targets.some((target) => target.nodeId === next.nodeId && target.inputKey === next.inputKey)) {
    targets.push(next);
  }
}

function buildConsumerMap(prompt: ComfyUIPromptGraph): Record<string, string[]> {
  const consumerMap: Record<string, string[]> = {};

  for (const nodeId of Object.keys(prompt)) {
    consumerMap[nodeId] = [];
  }

  for (const [nodeId, node] of Object.entries(prompt)) {
    for (const inputValue of Object.values(node.inputs || {})) {
      const upstreamNodeId = getNodeIdFromConnection(inputValue);
      if (!upstreamNodeId) {
        continue;
      }

      if (!consumerMap[upstreamNodeId]) {
        consumerMap[upstreamNodeId] = [];
      }
      consumerMap[upstreamNodeId].push(nodeId);
    }
  }

  return consumerMap;
}

function collectTextTargets(prompt: ComfyUIPromptGraph, startNodeIds: string[]): TextTarget[] {
  const targets: TextTarget[] = [];
  const visited = new Set<string>();
  const queue = [...startNodeIds];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);

    const node = prompt[nodeId];
    if (!node) {
      continue;
    }

    for (const inputKey of TEXT_INPUT_PREFERENCES) {
      if (typeof node.inputs?.[inputKey] === 'string') {
        addUniqueTextTarget(targets, { nodeId, inputKey });
      }
    }

    for (const inputValue of Object.values(node.inputs || {})) {
      const upstreamNodeId = getNodeIdFromConnection(inputValue);
      if (upstreamNodeId && !visited.has(upstreamNodeId)) {
        queue.push(upstreamNodeId);
      }
    }
  }

  return targets;
}

function collectUpstreamModelTargets(prompt: ComfyUIPromptGraph, startNodeIds: string[]): ModelTarget[] {
  const targets: ModelTarget[] = [];
  const visited = new Set<string>();
  const queue = [...startNodeIds];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);

    const node = prompt[nodeId];
    if (!node) {
      continue;
    }

    for (const target of detectModelTarget(nodeId, node)) {
      if (!targets.some((entry) => entry.nodeId === target.nodeId && entry.inputKey === target.inputKey)) {
        targets.push(target);
      }
    }

    for (const inputValue of Object.values(node.inputs || {})) {
      const upstreamNodeId = getNodeIdFromConnection(inputValue);
      if (upstreamNodeId && !visited.has(upstreamNodeId)) {
        queue.push(upstreamNodeId);
      }
    }
  }

  return targets;
}

function collectUpstreamLoraTargets(prompt: ComfyUIPromptGraph, startNodeIds: string[]): LoRATarget[] {
  const targets: LoRATarget[] = [];
  const visited = new Set<string>();
  const queue = [...startNodeIds];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);

    const node = prompt[nodeId];
    if (!node) {
      continue;
    }

    if (typeof node.inputs?.lora_name === 'string') {
      const strengthKey = ['strength_model', 'strength', 'strength_unet', 'strength_clip'].find(
        (key) => key in (node.inputs || {})
      ) || 'strength_model';

      if (!targets.some((entry) => entry.nodeId === nodeId)) {
        targets.push({
          nodeId,
          nameKey: 'lora_name',
          strengthKey,
        });
      }
    }

    for (const inputValue of Object.values(node.inputs || {})) {
      const upstreamNodeId = getNodeIdFromConnection(inputValue);
      if (upstreamNodeId && !visited.has(upstreamNodeId)) {
        queue.push(upstreamNodeId);
      }
    }
  }

  return targets;
}

function collectUpstreamAssetTargets(
  prompt: ComfyUIPromptGraph,
  startNodeIds: string[]
): { imageTargets: AssetTarget[]; maskTargets: AssetTarget[] } {
  const imageTargets: AssetTarget[] = [];
  const maskTargets: AssetTarget[] = [];
  const visited = new Set<string>();
  const queue = [...startNodeIds];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);

    const node = prompt[nodeId];
    if (!node) {
      continue;
    }

    const classType = (node.class_type || '').toLowerCase();
    if (classType === 'loadimage' && typeof node.inputs?.image === 'string') {
      addUniqueAssetTarget(imageTargets, { nodeId, inputKey: 'image' });
    }

    if (classType === 'loadimagemask' && typeof node.inputs?.image === 'string') {
      addUniqueAssetTarget(maskTargets, { nodeId, inputKey: 'image' });
    }

    for (const inputValue of Object.values(node.inputs || {})) {
      const upstreamNodeId = getNodeIdFromConnection(inputValue);
      if (upstreamNodeId && !visited.has(upstreamNodeId)) {
        queue.push(upstreamNodeId);
      }
    }
  }

  return {
    imageTargets,
    maskTargets,
  };
}

function compareNodeIdsDescending(left: string, right: string): number {
  const leftNumeric = Number(left);
  const rightNumeric = Number(right);

  if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric)) {
    return rightNumeric - leftNumeric;
  }

  return right.localeCompare(left);
}

function hasDownstreamCandidate(
  startNodeId: string,
  candidateNodeIds: Set<string>,
  consumerMap: Record<string, string[]>
): boolean {
  const queue = [...(consumerMap[startNodeId] || [])];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);

    if (candidateNodeIds.has(nodeId)) {
      return true;
    }

    for (const consumerId of consumerMap[nodeId] || []) {
      if (!visited.has(consumerId)) {
        queue.push(consumerId);
      }
    }
  }

  return false;
}

function findTerminalImageProducer(prompt: ComfyUIPromptGraph, samplerNodeIds: string[]): string | null {
  const consumerMap = buildConsumerMap(prompt);
  const candidateNodeIds = Object.entries(prompt)
    .filter(([, node]) => typeof node.class_type === 'string' && node.class_type.toLowerCase().includes('vaedecode'))
    .map(([nodeId]) => nodeId);

  if (candidateNodeIds.length === 0) {
    return null;
  }

  const reachableFromSampler = new Set<string>();
  const queue = [...samplerNodeIds];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (reachableFromSampler.has(nodeId)) {
      continue;
    }
    reachableFromSampler.add(nodeId);

    for (const consumerId of consumerMap[nodeId] || []) {
      if (!reachableFromSampler.has(consumerId)) {
        queue.push(consumerId);
      }
    }
  }

  const reachableCandidates = candidateNodeIds.filter((nodeId) => reachableFromSampler.has(nodeId));
  const candidates = reachableCandidates.length > 0 ? reachableCandidates : candidateNodeIds;
  const candidateSet = new Set(candidates);
  const terminalCandidates = candidates.filter((nodeId) => !hasDownstreamCandidate(nodeId, candidateSet, consumerMap));
  const preferredCandidates = terminalCandidates.length > 0 ? terminalCandidates : candidates;

  return preferredCandidates.sort(compareNodeIdsDescending)[0] || null;
}

function getRelativePathFromImageId(imageId: string): string | null {
  const parts = imageId.split('::');
  return parts.length > 1 ? parts.slice(1).join('::') : null;
}

export function buildImageSourceReference(image: IndexedImage): SourceImageReference {
  const metadata = image.metadata?.normalizedMetadata as BaseMetadata | undefined;
  const absolutePath = (image.handle as FileSystemFileHandle & { _filePath?: string })._filePath || null;
  return {
    fileName: image.name,
    relativePath: getRelativePathFromImageId(image.id),
    absolutePath,
    width: metadata?.width ?? null,
    height: metadata?.height ?? null,
  };
}

export function buildComfyUIResourceCatalog(objectInfo: ComfyUIResourceCatalogInfo | null | undefined): ComfyUIResourceCatalog {
  const models: ComfyUIModelResource[] = [];
  const loras = new Set<string>();

  for (const spec of UNIQUE_MODEL_LOADERS) {
    const values = objectInfo?.[spec.node]?.input?.required?.[spec.inputKey]?.[0];
    if (!Array.isArray(values)) {
      continue;
    }

    for (const name of values) {
      if (typeof name !== 'string') {
        continue;
      }
      if (!models.some((model) => model.name === name && model.family === spec.family)) {
        models.push({
          name,
          family: spec.family,
          sourceNode: spec.node,
          inputKey: spec.inputKey,
        });
      }
    }
  }

  const loraValues = objectInfo?.LoraLoader?.input?.required?.lora_name?.[0];
  if (Array.isArray(loraValues)) {
    for (const name of loraValues) {
      if (typeof name === 'string') {
        loras.add(name);
      }
    }
  }

  const samplers = objectInfo?.KSampler?.input?.required?.sampler_name?.[0];
  const schedulers = objectInfo?.KSampler?.input?.required?.scheduler?.[0];

  return {
    models,
    loras: Array.from(loras).sort((left, right) => left.localeCompare(right)),
    samplers: Array.isArray(samplers) ? samplers.filter((value: unknown): value is string => typeof value === 'string') : [],
    schedulers: Array.isArray(schedulers) ? schedulers.filter((value: unknown): value is string => typeof value === 'string') : [],
  };
}

export function extractEmbeddedComfyWorkflow(source: IndexedImage | UnknownRecord): {
  workflow: ComfyUIWorkflowUi | null;
  prompt: ComfyUIPromptGraph | null;
} {
  const rawMetadata = 'metadata' in source
    ? ((source as IndexedImage).metadata as UnknownRecord)
    : (source as UnknownRecord);
  const normalizedMetadata = isRecord(rawMetadata.normalizedMetadata)
    ? rawMetadata.normalizedMetadata
    : null;
  const metadata = normalizedMetadata
    ? { ...normalizedMetadata, ...rawMetadata }
    : rawMetadata;
  const rawMetaHubValue = metadata['imagemetahub_data'];
  const rawMetaHub = parseMaybeJson<UnknownRecord>(rawMetaHubValue) || rawMetaHubValue || null;

  const workflow = parseMaybeJson<ComfyUIWorkflowUi>(
    (isRecord(rawMetaHub) ? rawMetaHub['workflow'] : undefined) ?? metadata['workflow']
  );

  const prompt = parseMaybeJson<ComfyUIPromptGraph>(
    (isRecord(rawMetaHub) ? rawMetaHub['prompt_api'] ?? rawMetaHub['prompt'] : undefined) ?? metadata['prompt']
  );

  return {
    workflow: workflow && typeof workflow === 'object' ? workflow : null,
    prompt: prompt && isPromptGraph(prompt) ? prompt : null,
  };
}

export function analyzeComfyWorkflow(source: IndexedImage | UnknownRecord, normalizedMetadata?: BaseMetadata): ComfyWorkflowAnalysis {
  const embedded = extractEmbeddedComfyWorkflow(source);
  const warnings: string[] = [];
  const samplerTargets: string[] = [];
  const positiveStartIds: string[] = [];
  const negativeStartIds: string[] = [];
  const modelStartIds: string[] = [];
  const latentStartIds: string[] = [];
  const saveNodeIds: string[] = [];
  const timerNodeIds: string[] = [];
  const dimensionTargets: TextTarget[] = [];
  const batchTargets: TextTarget[] = [];

  if (!embedded.prompt) {
    return {
      rawWorkflow: embedded.workflow,
      rawPrompt: embedded.prompt,
      originalAvailable: false,
      positiveTargets: [],
      negativeTargets: [],
      samplerTargets: [],
      modelTargets: [],
      loraTargets: [],
      imageTargets: [],
      maskTargets: [],
      dimensionTargets: [],
      batchTargets: [],
      saveNodeIds: [],
      timerNodeIds: [],
      compatibleModelFamilies: [],
      warnings: embedded.workflow ? ['Workflow UI found without executable prompt graph.'] : ['No embedded ComfyUI workflow found.'],
      generationType: normalizedMetadata?.generationType,
    };
  }

  for (const [nodeId, node] of Object.entries(embedded.prompt)) {
    const classType = (node.class_type || '').toLowerCase();

    if (classType.includes('sampler') && node.inputs?.model) {
      samplerTargets.push(nodeId);
      const positiveNodeId = getNodeIdFromConnection(node.inputs.positive);
      const negativeNodeId = getNodeIdFromConnection(node.inputs.negative);
      const modelNodeId = getNodeIdFromConnection(node.inputs.model);
      if (positiveNodeId) {
        positiveStartIds.push(positiveNodeId);
      }
      if (negativeNodeId) {
        negativeStartIds.push(negativeNodeId);
      }
      if (modelNodeId) {
        modelStartIds.push(modelNodeId);
      }
      const latentNodeId = getNodeIdFromConnection(node.inputs.latent_image);
      if (latentNodeId) {
        latentStartIds.push(latentNodeId);
      }
    }

    if (classType === 'metahubsavenode' || classType === 'saveimage') {
      saveNodeIds.push(nodeId);
    }

    if (classType === 'metahubtimernode') {
      timerNodeIds.push(nodeId);
    }

    if (typeof node.inputs?.width === 'number' || typeof node.inputs?.height === 'number') {
      if ('width' in (node.inputs || {})) {
        dimensionTargets.push({ nodeId, inputKey: 'width' });
      }
      if ('height' in (node.inputs || {})) {
        dimensionTargets.push({ nodeId, inputKey: 'height' });
      }
    }

    if ('batch_size' in (node.inputs || {})) {
      batchTargets.push({ nodeId, inputKey: 'batch_size' });
    }
  }

  const positiveTargets = collectTextTargets(embedded.prompt, positiveStartIds);
  const negativeTargets = collectTextTargets(embedded.prompt, negativeStartIds);
  const modelTargets = collectUpstreamModelTargets(embedded.prompt, modelStartIds);
  const loraTargets = collectUpstreamLoraTargets(embedded.prompt, modelStartIds);
  const { imageTargets, maskTargets } = collectUpstreamAssetTargets(embedded.prompt, latentStartIds);

  if (saveNodeIds.length === 0) {
    warnings.push('Workflow does not contain MetaHubSaveNode or SaveImage. A save node will be injected.');
  }

  const compatibleModelFamilies = Array.from(new Set(modelTargets.map((target) => target.family))).filter(Boolean);
  const parsedGraph = resolvePromptFromGraph(embedded.workflow, embedded.prompt);
  const generationType = normalizedMetadata?.generationType || parsedGraph.generationType;

  return {
    rawWorkflow: embedded.workflow,
    rawPrompt: embedded.prompt,
    originalAvailable: true,
    generationType,
    positiveTargets,
    negativeTargets,
    samplerTargets,
    modelTargets,
    loraTargets,
    imageTargets,
    maskTargets,
    dimensionTargets,
    batchTargets,
    saveNodeIds,
    timerNodeIds,
    compatibleModelFamilies,
    warnings,
  };
}

function setTextTargets(prompt: ComfyUIPromptGraph, targets: TextTarget[], value: string): void {
  for (const target of targets) {
    if (prompt[target.nodeId]) {
      prompt[target.nodeId].inputs[target.inputKey] = value;
    }
  }
}

export function updatePromptNodeLiteralValue(
  prompt: ComfyUIPromptGraph,
  nodeId: string,
  inputKey: string,
  value: string | number | boolean
): ComfyUIPromptGraph {
  const nextPrompt = cloneJson(prompt);
  if (nextPrompt[nodeId]) {
    nextPrompt[nodeId].inputs[inputKey] = value;
  }
  return nextPrompt;
}

function ensureTimerNode(
  prompt: ComfyUIPromptGraph,
  analysis: ComfyWorkflowAnalysis,
  workflow: ComfyUIWorkflowUi | null
): string | null {
  const existingTimerNodeId = analysis.timerNodeIds.find((nodeId) => Boolean(prompt[nodeId]));
  if (existingTimerNodeId) {
    return existingTimerNodeId;
  }

  const clipTargets = [...analysis.positiveTargets, ...analysis.negativeTargets].filter(
    (target) => getNodeIdFromConnection(prompt[target.nodeId]?.inputs?.clip)
  );
  if (clipTargets.length === 0) {
    return null;
  }

  const firstClipConnection = prompt[clipTargets[0].nodeId].inputs.clip;
  const timerNodeId = nextNodeId(prompt);
  prompt[timerNodeId] = {
    class_type: 'MetaHubTimerNode',
    inputs: {
      clip: firstClipConnection,
    },
    _meta: {
      title: 'MetaHub Timer',
    },
  };

  for (const target of clipTargets) {
    prompt[target.nodeId].inputs.clip = [timerNodeId, 0];
  }

  if (workflow?.nodes) {
    workflow.nodes.push({
      id: Number(timerNodeId),
      type: 'MetaHubTimerNode',
      title: 'MetaHub Timer',
      pos: [0, 0],
      widgets_values: [],
      inputs: [],
      outputs: [],
    } as ComfyUIWorkflowUi['nodes'][number]);
  }

  return timerNodeId;
}

function ensureSaveNode(
  prompt: ComfyUIPromptGraph,
  analysis: ComfyWorkflowAnalysis,
  workflow: ComfyUIWorkflowUi | null,
  timerNodeId: string | null
): boolean {
  const applySaveDefaults = (nodeId: string) => {
    const node = prompt[nodeId];
    if (!node) {
      return;
    }
    node.class_type = 'MetaHubSaveNode';
    node.inputs = {
      ...node.inputs,
      filename_pattern: node.inputs?.filename_pattern || 'MetaHub_%date%_%time%_%counter%',
      file_format: node.inputs?.file_format || 'PNG',
      ...(timerNodeId ? { generation_time_override: [timerNodeId, 4] } : {}),
    };
  };

  if (analysis.saveNodeIds.length > 0) {
    let appliedExistingSaveNode = false;
    for (const saveNodeId of analysis.saveNodeIds) {
      if (!prompt[saveNodeId]) {
        continue;
      }
      appliedExistingSaveNode = true;
      applySaveDefaults(saveNodeId);
    }

    if (workflow?.nodes) {
      for (const node of workflow.nodes) {
        if (analysis.saveNodeIds.includes(String(node.id))) {
          node.type = 'MetaHubSaveNode';
          node.title = 'MetaHub Save Node';
        }
      }
    }

    if (appliedExistingSaveNode) {
      return true;
    }
  }

  const imageProducer = Object.entries(prompt).find(([, node]) =>
    typeof node.class_type === 'string' && node.class_type.toLowerCase().includes('vaedecode')
  );
  const imageProducerNodeId = findTerminalImageProducer(prompt, analysis.samplerTargets) || imageProducer?.[0] || null;

  if (!imageProducerNodeId) {
    return false;
  }

  const saveNodeId = nextNodeId(prompt);
  prompt[saveNodeId] = {
    class_type: 'MetaHubSaveNode',
    inputs: {
      images: [imageProducerNodeId, 0],
      filename_pattern: 'MetaHub_%date%_%time%_%counter%',
      file_format: 'PNG',
      ...(timerNodeId ? { generation_time_override: [timerNodeId, 4] } : {}),
    },
    _meta: {
      title: 'MetaHub Save Node',
    },
  };

  if (workflow?.nodes) {
    workflow.nodes.push({
      id: Number(saveNodeId),
      type: 'MetaHubSaveNode',
      title: 'MetaHub Save Node',
      pos: [0, 0],
      widgets_values: ['MetaHub_%date%_%time%_%counter%', 'PNG'],
      inputs: [],
      outputs: [],
    } as ComfyUIWorkflowUi['nodes'][number]);
  }

  return true;
}

function applyNumericOverrides(
  prompt: ComfyUIPromptGraph,
  analysis: ComfyWorkflowAnalysis,
  metadata: BaseMetadata
): void {
  const workflowMetadata = metadata as WorkflowMetadata;
  const cfgScale = workflowMetadata.cfgScale ?? metadata.cfg_scale;
  const denoiseValue = workflowMetadata.denoise;
  const resolvedSeed = resolveExecutionSeed(metadata.seed);

  for (const samplerNodeId of analysis.samplerTargets) {
    const samplerNode = prompt[samplerNodeId];
    if (!samplerNode) {
      continue;
    }

    samplerNode.inputs.seed = resolvedSeed;
    samplerNode.inputs.steps = metadata.steps;
    if (cfgScale != null) {
      samplerNode.inputs.cfg = cfgScale;
    }
    if (metadata.sampler) {
      samplerNode.inputs.sampler_name = metadata.sampler;
    }
    if (metadata.scheduler) {
      samplerNode.inputs.scheduler = metadata.scheduler;
    }
    if (denoiseValue != null) {
      samplerNode.inputs.denoise = denoiseValue;
    }
  }

  for (const target of analysis.dimensionTargets) {
    const node = prompt[target.nodeId];
    if (!node) {
      continue;
    }
    if (target.inputKey === 'width') {
      node.inputs.width = metadata.width;
    }
    if (target.inputKey === 'height') {
      node.inputs.height = metadata.height;
    }
  }

  const batchSizeRaw = workflowMetadata.batch_size ?? workflowMetadata.numberOfImages;
  const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw > 0
    ? Math.min(10, Math.floor(batchSizeRaw))
    : 1;

  for (const target of analysis.batchTargets) {
    const node = prompt[target.nodeId];
    if (node) {
      node.inputs.batch_size = batchSize;
    }
  }
}

function applyRandomSeedOverrideIfNeeded(
  prompt: ComfyUIPromptGraph,
  analysis: ComfyWorkflowAnalysis,
  metadata: BaseMetadata
): void {
  if (typeof metadata.seed !== 'number') {
    return;
  }

  if (Number.isFinite(metadata.seed) && metadata.seed >= 0) {
    return;
  }

  const resolvedSeed = resolveExecutionSeed(metadata.seed);
  for (const samplerNodeId of analysis.samplerTargets) {
    const samplerNode = prompt[samplerNodeId];
    if (samplerNode) {
      samplerNode.inputs.seed = resolvedSeed;
    }
  }
}

function applyModelOverride(
  prompt: ComfyUIPromptGraph,
  analysis: ComfyWorkflowAnalysis,
  model: ComfyUIModelResource | null | undefined,
  warnings: string[]
): void {
  if (!model) {
    return;
  }

  const compatibleTargets = analysis.modelTargets.filter((target) =>
    target.family === model.family || (model.family === 'unknown' && target.family !== 'lora')
  );

  if (compatibleTargets.length === 0) {
    warnings.push(`Selected model "${model.name}" is incompatible with this workflow.`);
    return;
  }

  for (const target of compatibleTargets) {
    if (prompt[target.nodeId]) {
      prompt[target.nodeId].inputs[target.inputKey] = model.name;
    }
  }
}

function applyLoraOverrides(
  prompt: ComfyUIPromptGraph,
  analysis: ComfyWorkflowAnalysis,
  loras: ComfyUILoRAConfig[] | undefined,
  warnings: string[]
): void {
  if (!loras || loras.length === 0) {
    return;
  }

  if (analysis.loraTargets.length === 0) {
    warnings.push('Workflow has no editable LoRA nodes. LoRA overrides were skipped.');
    return;
  }

  if (loras.length > analysis.loraTargets.length) {
    warnings.push('Workflow has fewer LoRA slots than selected LoRAs. Extra LoRAs were ignored.');
  }

  analysis.loraTargets.forEach((target, index) => {
    const node = prompt[target.nodeId];
    if (!node) {
      return;
    }

    const config = loras[index];
    if (!config) {
      node.inputs[target.strengthKey] = 0;
      return;
    }

    node.inputs[target.nameKey] = config.name;
    node.inputs[target.strengthKey] = config.strength;
  });
}

export function applyWorkflowOverridesToPromptGraph(
  prompt: ComfyUIPromptGraph,
  analysis: ComfyWorkflowAnalysis,
  metadata: BaseMetadata,
  overrides?: ComfyUIWorkflowOverrides
): {
  prompt: ComfyUIPromptGraph;
  warnings: string[];
} {
  const nextPrompt = cloneJson(prompt);
  const warnings: string[] = [];

  setTextTargets(nextPrompt, analysis.positiveTargets, metadata.prompt || '');
  setTextTargets(nextPrompt, analysis.negativeTargets, metadata.negativePrompt || '');
  applyNumericOverrides(nextPrompt, analysis, metadata);
  applyModelOverride(nextPrompt, analysis, overrides?.model, warnings);
  applyLoraOverrides(nextPrompt, analysis, overrides?.loras, warnings);

  return {
    prompt: nextPrompt,
    warnings,
  };
}

async function applyAssetOverrides(
  prompt: ComfyUIPromptGraph,
  analysis: ComfyWorkflowAnalysis,
  options: PrepareOriginalWorkflowOptions,
  warnings: string[]
): Promise<void> {
  if (options.sourceImagePolicy === 'reuse_original') {
    return;
  }

  if (!options.uploadAsset) {
    warnings.push('Asset upload is not available. Original workflow assets were reused.');
    return;
  }

  const sourceFile = await options.image.handle.getFile();
  const uploadedImageName = await options.uploadAsset(sourceFile, 'image');
  for (const target of analysis.imageTargets) {
    if (prompt[target.nodeId]) {
      prompt[target.nodeId].inputs[target.inputKey] = uploadedImageName;
    }
  }

  if (options.sourceImagePolicy === 'selected_image_and_mask' && analysis.maskTargets.length > 0) {
    if (!options.maskFile) {
      warnings.push('Mask replacement was requested without a mask file. Original masks were reused.');
      return;
    }

    const uploadedMaskName = await options.uploadAsset(options.maskFile, 'mask');
    for (const target of analysis.maskTargets) {
      if (prompt[target.nodeId]) {
        prompt[target.nodeId].inputs[target.inputKey] = uploadedMaskName;
      }
    }
  }
}

export async function prepareOriginalWorkflowForExecution(
  options: PrepareOriginalWorkflowOptions
): Promise<PreparedComfyExecution> {
  const baseAnalysis = analyzeComfyWorkflow(options.image, options.metadata);
  if (!baseAnalysis.originalAvailable || !baseAnalysis.rawPrompt) {
    return {
      payload: {
        prompt: {},
        client_id: options.clientId,
      },
      modeUsed: 'simple',
      warnings: [...baseAnalysis.warnings],
      analysis: baseAnalysis,
    };
  }

  let prompt = options.advancedPromptJson
    ? parseMaybeJson<ComfyUIPromptGraph>(options.advancedPromptJson)
    : baseAnalysis.rawPrompt;
  let workflow = options.advancedWorkflowJson
    ? parseMaybeJson<ComfyUIWorkflowUi>(options.advancedWorkflowJson)
    : baseAnalysis.rawWorkflow;

  if (!prompt || !isPromptGraph(prompt)) {
    return {
      payload: {
        prompt: {},
        client_id: options.clientId,
      },
      modeUsed: 'simple',
      warnings: [...baseAnalysis.warnings, 'Advanced Prompt API JSON is invalid. Falling back to simple rebuild.'],
      analysis: baseAnalysis,
    };
  }

  prompt = cloneJson(prompt);
  workflow = workflow ? cloneJson(workflow) : null;

  const runtimeAnalysis = analyzeComfyWorkflow({ workflow, prompt }, options.metadata);
  const warnings = [...baseAnalysis.warnings];
  for (const warning of runtimeAnalysis.warnings) {
    if (!warnings.includes(warning)) {
      warnings.push(warning);
    }
  }

  if (!options.advancedPromptJson) {
    const patched = applyWorkflowOverridesToPromptGraph(prompt, runtimeAnalysis, options.metadata, options.overrides);
    prompt = patched.prompt;
    warnings.push(...patched.warnings);
  } else {
    applyRandomSeedOverrideIfNeeded(prompt, runtimeAnalysis, options.metadata);
  }

  await applyAssetOverrides(prompt, runtimeAnalysis, options, warnings);

  const timerNodeId = ensureTimerNode(prompt, runtimeAnalysis, workflow);
  const saveOk = ensureSaveNode(prompt, runtimeAnalysis, workflow, timerNodeId);
  if (!saveOk) {
    return {
      payload: {
        prompt: {},
        client_id: options.clientId,
      },
      modeUsed: 'simple',
      warnings: [...warnings, 'Could not guarantee a MetaHub save chain in the original workflow. Falling back to simple rebuild.'],
      analysis: runtimeAnalysis,
    };
  }

  const extraPngInfo: Record<string, unknown> = {
    workflow: workflow || runtimeAnalysis.rawWorkflow || {},
    prompt,
    parent_image: buildImageSourceReference(options.image),
  };

  return {
    payload: {
      prompt,
      client_id: options.clientId,
      extra_data: {
        extra_pnginfo: extraPngInfo,
      },
    },
    modeUsed: 'original',
    warnings,
    analysis: {
      ...runtimeAnalysis,
      rawWorkflow: workflow,
      rawPrompt: prompt,
    },
  };
}

export function getWorkflowCopyPayload(
  image: IndexedImage,
  mode: ComfyUIWorkflowMode,
  metadata?: BaseMetadata
): Record<string, unknown> {
  const resolvedMetadata = metadata || (image.metadata?.normalizedMetadata as BaseMetadata | undefined);
  if (mode === 'original') {
    const embedded = extractEmbeddedComfyWorkflow(image);
    if (embedded.prompt) {
      return {
        prompt: embedded.prompt,
        extra_pnginfo: {
          workflow: embedded.workflow || {},
          prompt: embedded.prompt,
          parent_image: buildImageSourceReference(image),
        },
      };
    }
  }

  return {
    prompt: {},
    metadata: resolvedMetadata || null,
  };
}

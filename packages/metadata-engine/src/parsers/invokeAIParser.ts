import { InvokeAIMetadata, BaseMetadata } from '../core/types';

// --- Helper Functions ---

function extractModelName(modelData: any): string | null {
  if (typeof modelData === 'string') {
    return modelData.trim();
  }
  if (modelData && typeof modelData === 'object') {
    // Special handling for InvokeAI LoRA structure: { model: { name: "LoRA Name" }, weight: 0.7 }
    if (modelData.model && typeof modelData.model === 'object' && modelData.model.name) {
      return modelData.model.name.trim();
    }

    const possibleNames = [
      modelData.name, modelData.model, modelData.model_name,
      modelData.base_model, modelData.mechanism, modelData.type
    ];
    for (const name of possibleNames) {
      if (name && typeof name === 'string' && name.trim()) {
        return name.trim();
      }
    }
    if (modelData.key && typeof modelData.key === 'string') {
      const key = modelData.key.trim();
      if (key.length > 20 && /^[a-f0-9-]+$/i.test(key)) {
        const type = modelData.mechanism || modelData.type || 'Model';
        return `${type} (${key.substring(0, 8)}...)`;
      }
      return key;
    }
  }
  return null;
}

const boardIdCache = new Map<string, string>();
let boardCounter = 1;

function getFriendlyBoardName(boardId: string): string {
  if (boardIdCache.has(boardId)) {
    return boardIdCache.get(boardId)!;
  }
  const friendlyName = `My Board ${boardCounter++}`;
  boardIdCache.set(boardId, friendlyName);
  return friendlyName;
}

function extractBoardFromWorkflow(workflow: any): string | null {
    if (!workflow || !workflow.nodes) return null;
    for (const node of workflow.nodes) {
        if (node.data?.type && (node.data.type === 'l2i' || node.data.type === 'canvas_output')) {
            if (node.data.inputs?.board?.value?.board_id) {
                return getFriendlyBoardName(node.data.inputs.board.value.board_id);
            }
        }
    }
    return null;
}


// --- Extraction Functions ---

export function extractModelsFromInvokeAI(metadata: InvokeAIMetadata): string[] {
  const models: Set<string> = new Set();

  if (metadata.model) {
    const modelName = extractModelName(metadata.model);
    if (modelName) models.add(modelName);
  }
  if (metadata.base_model) {
    const modelName = extractModelName(metadata.base_model);
    if (modelName) models.add(modelName);
  }
  if (metadata.model_name) {
    const modelName = extractModelName(metadata.model_name);
    if (modelName) models.add(modelName);
  }

  // FIX: Create a copy of metadata WITHOUT loras field to avoid picking up LoRA .safetensors files
  const metadataWithoutLoras = { ...metadata };
  delete metadataWithoutLoras.loras;

  const metadataStr = JSON.stringify(metadataWithoutLoras).toLowerCase();
  const modelMatches = metadataStr.match(/['"]\s*([^'"]*\.(safetensors|ckpt|pt))\s*['"]/g);
  if (modelMatches) {
    modelMatches.forEach(match => {
      let modelName = match.replace(/['"]/g, '').trim();
      modelName = modelName.split(/[/\\]/).pop() || modelName;
      if (modelName) models.add(modelName);
    });
  }

  return Array.from(models);
}

export function extractLorasFromInvokeAI(metadata: InvokeAIMetadata): string[] {
  const loras: Set<string> = new Set();
  const promptText = typeof metadata.prompt === 'string'
    ? metadata.prompt
    : Array.isArray(metadata.prompt)
      ? metadata.prompt.map(p => typeof p === 'string' ? p : p.prompt).join(' ')
      : '';

  const loraPatterns = [/<lora:([^:>]+):[^>]*>/gi, /<lyco:([^:>]+):[^>]*>/gi];
  loraPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(promptText)) !== null) {
      if (match[1]) loras.add(match[1].trim());
    }
  });

  if (Array.isArray(metadata.loras)) {
    metadata.loras.forEach((lora: any) => {
      const loraName = extractModelName(lora);
      if (loraName && loraName !== '[object Object]') {
        loras.add(loraName);
      }
    });
  }
  return Array.from(loras);
}

export function extractBoardFromInvokeAI(metadata: InvokeAIMetadata): string {
    const boardFields = ['board_name', 'board_id', 'boardName', 'boardId', 'Board Name'];
    for(const field of boardFields) {
        if(metadata[field] && typeof metadata[field] === 'string') {
            return metadata[field] as string;
        }
    }
    if (metadata.board && typeof metadata.board === 'object') {
        const boardObj = metadata.board as any;
        return boardObj.name || boardObj.board_name || boardObj.id || 'Uncategorized';
    }
    if (metadata.canvas_v2_metadata?.board_id) {
        return getFriendlyBoardName(metadata.canvas_v2_metadata.board_id);
    }
    if (metadata.workflow) {
        const boardInfo = extractBoardFromWorkflow(typeof metadata.workflow === 'string' ? JSON.parse(metadata.workflow) : metadata.workflow);
        if(boardInfo) return boardInfo;
    }
    return 'Uncategorized';
}

// --- Main Parser Function ---

export function parseInvokeAIMetadata(metadata: InvokeAIMetadata): BaseMetadata {
  const result: Partial<BaseMetadata> = {};

  // Prompts
  if (typeof metadata.positive_prompt === 'string') {
    result.prompt = metadata.positive_prompt;
  } else if (typeof metadata.prompt === 'string') {
    result.prompt = metadata.prompt;
  } else if (Array.isArray(metadata.prompt)) {
    result.prompt = metadata.prompt.map(p => (typeof p === 'string' ? p : p.prompt || '')).join(' ');
  }
  result.negativePrompt = metadata.negative_prompt || '';

  // Core fields
  result.width = metadata.width;
  result.height = metadata.height;
  result.steps = metadata.steps;
  result.scheduler = metadata.scheduler;
  result.cfg_scale = metadata.cfg_scale;
  result.seed = metadata.seed;

  // Extracted fields
  result.models = extractModelsFromInvokeAI(metadata);
  result.loras = extractLorasFromInvokeAI(metadata);
  result.board = extractBoardFromInvokeAI(metadata);

  if (result.models.length > 0) {
      result.model = result.models[0];
  }

  result.generator = 'InvokeAI';

  return result as BaseMetadata;
}
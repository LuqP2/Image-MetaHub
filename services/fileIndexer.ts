/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { type IndexedImage, type ImageMetadata, type InvokeAIMetadata, type Automatic1111Metadata, type ComfyUIMetadata, type BaseMetadata, isInvokeAIMetadata, isAutomatic1111Metadata, isComfyUIMetadata } from '../types';
import { parse } from 'exifr';

// Function to extract models from metadata
function extractModels(metadata: ImageMetadata): string[] {
  // Log metadata format detection
  console.log('🔍 DETECTING METADATA FORMAT:');
  console.log('  - isInvokeAI:', isInvokeAIMetadata(metadata));
  console.log('  - isAutomatic1111:', isAutomatic1111Metadata(metadata));
  console.log('  - isComfyUI:', isComfyUIMetadata(metadata));
  console.log('  - Raw metadata keys:', Object.keys(metadata));

  // First check if normalized metadata is available (faster path)
  if ('normalizedMetadata' in metadata && metadata.normalizedMetadata) {
    const normalized = metadata.normalizedMetadata;
    if (normalized.models && Array.isArray(normalized.models)) {
      console.log('🔍 Using normalized metadata for models extraction');
      return normalized.models;
    }
  }

  // Fallback to format-specific extraction
  const models: string[] = [];

  // Handle InvokeAI metadata
  if (isInvokeAIMetadata(metadata)) {
    console.log('🔍 Processing InvokeAI metadata for models');
    return extractModelsFromInvokeAI(metadata);
  }

  // Handle Automatic1111 metadata
  if (isAutomatic1111Metadata(metadata)) {
    console.log('🔍 Processing Automatic1111 metadata for models');
    return extractModelsFromAutomatic1111(metadata);
  }

  // Handle ComfyUI metadata
  if (isComfyUIMetadata(metadata)) {
    console.log('🔍 Processing ComfyUI metadata for models');
    return extractModelsFromComfyUI(metadata);
  }

  // SPECIAL CASE: If we have normalizedMetadata but couldn't detect format,
  // it might be a cached ComfyUI image. Try to extract from normalizedMetadata directly
  if (metadata && typeof metadata === 'object' && 'normalizedMetadata' in metadata && (metadata as any).normalizedMetadata) {
    const normalized = (metadata as any).normalizedMetadata;
    console.log('🔍 No format detected but have normalizedMetadata - trying ComfyUI extraction');
    if (normalized.models && Array.isArray(normalized.models)) {
      return normalized.models;
    }
    // Try to extract from the original metadata if it exists in normalizedMetadata
    if (normalized.model && typeof normalized.model === 'string') {
      return [normalized.model];
    }
  }

  // Fallback: try to extract from raw metadata for unknown formats
  console.log('⚠️ Unknown metadata format for models, attempting fallback extraction');
  return extractModelsFromRawMetadata(metadata);
}

// Extract models from InvokeAI metadata
function extractModelsFromInvokeAI(metadata: InvokeAIMetadata): string[] {
  const models: string[] = [];

  // Add main model
  if (metadata.model) {
    const modelName = extractModelName(metadata.model);
    if (modelName) models.push(modelName);
  }

  // Check for additional models in other fields
  if (metadata.base_model) {
    const modelName = extractModelName(metadata.base_model);
    if (modelName) models.push(modelName);
  }

  // Look for model names in metadata
  if (metadata.model_name) {
    const modelName = extractModelName(metadata.model_name);
    if (modelName) models.push(modelName);
  }

  // Check for checkpoint/safetensors files in metadata
  const metadataStr = JSON.stringify(metadata).toLowerCase();
  const modelMatches = metadataStr.match(/['"]\s*([^'"]*\.safetensors|[^'"]*\.ckpt|[^'"]*\.pt)\s*['"]/g);
  if (modelMatches) {
    modelMatches.forEach(match => {
      let modelName = match.replace(/['"]/g, '').trim();
      // Extract just the filename without path
      modelName = modelName.split('/').pop() || modelName;
      modelName = modelName.split('\\').pop() || modelName;
      if (modelName && !models.includes(modelName)) {
        models.push(modelName);
      }
    });
  }

  return models.filter(Boolean);
}

// Extract models from Automatic1111 metadata
function extractModelsFromAutomatic1111(metadata: Automatic1111Metadata): string[] {
  const models: string[] = [];
  const params = metadata.parameters;

  // Look for "Model:" or "Model hash:" patterns in the parameters string
  const modelMatch = params.match(/Model:\s*([^,\n]+)/i);
  if (modelMatch) {
    const modelName = modelMatch[1].trim();
    if (modelName) models.push(modelName);
  }

  // Also check for model hash pattern
  const hashMatch = params.match(/Model hash:\s*([a-f0-9]+)/i);
  if (hashMatch) {
    const hash = hashMatch[1].trim();
    // If we have a hash but no model name, use the hash as identifier
    if (models.length === 0) {
      models.push(`Model (${hash.substring(0, 8)}...)`);
    }
  }

  return models;
}

// Extract models from ComfyUI metadata
function extractModelsFromComfyUI(metadata: ComfyUIMetadata): string[] {
  const models: string[] = [];

  try {
    // Parse workflow if it's a string
    let workflow: any = metadata.workflow;
    if (typeof workflow === 'string') {
      workflow = JSON.parse(workflow);
    }

    // Parse prompt if it's a string
    let prompt: any = metadata.prompt;
    if (typeof prompt === 'string') {
      prompt = JSON.parse(prompt);
    }

    // Look for model information in workflow nodes
    if (workflow && workflow.nodes) {
      for (const node of workflow.nodes) {
        if (node.type && node.type.toLowerCase().includes('checkpoint') ||
            node.type && node.type.toLowerCase().includes('model')) {
          // Check widgets_values for model name
          if (node.widgets_values && node.widgets_values.length > 0) {
            const modelName = node.widgets_values[0];
            if (typeof modelName === 'string' && modelName.trim()) {
              models.push(modelName.trim());
            }
          }
          // Check inputs for model information
          if (node.inputs) {
            for (const [key, value] of Object.entries(node.inputs)) {
              if (key.toLowerCase().includes('ckpt_name') || key.toLowerCase().includes('model')) {
                if (typeof value === 'string' && value.trim()) {
                  models.push(value.trim());
                }
              }
            }
          }
        }
      }
    }

    // Look for model information in prompt
    if (prompt) {
      for (const [nodeId, nodeData] of Object.entries(prompt)) {
        const node = nodeData as any;
        if (node.class_type && node.class_type.toLowerCase().includes('checkpoint')) {
          if (node.inputs) {
            for (const [key, value] of Object.entries(node.inputs)) {
              if (key.toLowerCase().includes('ckpt_name') || key.toLowerCase().includes('model')) {
                if (typeof value === 'string' && value.trim()) {
                  models.push(value.trim());
                }
              }
            }
          }
        }
      }
    }

  } catch (error) {
    console.warn('Failed to parse ComfyUI workflow/prompt for model extraction:', error);
  }

  return models.filter(Boolean);
}

// Fallback function to extract models from raw metadata for unknown formats
function extractModelsFromRawMetadata(metadata: any): string[] {
  const models: string[] = [];

  // Try common model field names across different formats
  const possibleModelFields = ['model', 'model_name', 'ckpt_name', 'checkpoint', 'model_hash'];

  for (const field of possibleModelFields) {
    if (metadata[field]) {
      const modelName = extractModelName(metadata[field]);
      if (modelName) models.push(modelName);
    }
  }

  // Try to extract from nested objects (ComfyUI style)
  if (metadata.workflow?.nodes) {
    for (const node of metadata.workflow.nodes) {
      if (node.class_type === 'CheckpointLoaderSimple' && node.inputs?.ckpt_name) {
        const modelName = extractModelName(node.inputs.ckpt_name);
        if (modelName) models.push(modelName);
      }
    }
  }

  return models;
}

// Helper function to extract readable model name
function extractModelName(modelData: any): string | null {
  if (typeof modelData === 'string') {
    return modelData.trim();
  }

  if (modelData && typeof modelData === 'object') {
    // Try to extract a readable name from the model object
    const possibleNames = [
      modelData.name,
      modelData.model,
      modelData.model_name,
      modelData.base_model,
      modelData.mechanism,
      modelData.type
    ];

    for (const name of possibleNames) {
      if (name && typeof name === 'string' && name.trim()) {
        return name.trim();
      }
    }

    // If all else fails, use key but make it more readable
    if (modelData.key && typeof modelData.key === 'string') {
      const key = modelData.key.trim();
      // If it's a long hash, truncate it
      if (key.length > 20 && /^[a-f0-9\-]+$/i.test(key)) {
        const mechanism = modelData.mechanism || modelData.type || 'Model';
        return `${mechanism} (${key.substring(0, 8)}...)`;
      }
      return key;
    }
  }

  return null;
}

// Function to extract LoRAs from metadata
function extractLoras(metadata: ImageMetadata): string[] {
  // First check if normalized metadata is available (faster path)
  if ('normalizedMetadata' in metadata && metadata.normalizedMetadata) {
    const normalized = metadata.normalizedMetadata;
    if (normalized.loras && Array.isArray(normalized.loras)) {
      console.log('🔍 Using normalized metadata for LoRA extraction');
      return normalized.loras;
    }
  }

  // Fallback to format-specific extraction
  const loras: string[] = [];

  // Handle InvokeAI metadata
  if (isInvokeAIMetadata(metadata)) {
    return extractLorasFromInvokeAI(metadata);
  }

  // Handle Automatic1111 metadata
  if (isAutomatic1111Metadata(metadata)) {
    return extractLorasFromAutomatic1111(metadata);
  }

  // Handle ComfyUI metadata
  if (isComfyUIMetadata(metadata)) {
    return extractLorasFromComfyUI(metadata);
  }

  // Fallback: try to extract from raw metadata for unknown formats
  console.log('⚠️ Unknown metadata format for LoRAs, attempting fallback extraction');
  return extractLorasFromRawMetadata(metadata);
}

// Extract LoRAs from InvokeAI metadata
function extractLorasFromInvokeAI(metadata: InvokeAIMetadata): string[] {
  const loras: string[] = [];

  // Get prompt text
  const promptText = typeof metadata.prompt === 'string'
    ? metadata.prompt
    : Array.isArray(metadata.prompt)
      ? metadata.prompt.map(p => typeof p === 'string' ? p : p.prompt).join(' ')
      : '';

  // Common LoRA patterns in prompts
  const loraPatterns = [
    /<lora:([^:>]+):[^>]*>/gi,  // <lora:name:weight>
    /<lyco:([^:>]+):[^>]*>/gi,  // <lyco:name:weight>
    /\blora:([^\s,>]+)/gi,      // lora:name
    /\blyco:([^\s,>]+)/gi       // lyco:name
  ];

  loraPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(promptText)) !== null) {
      const loraName = match[1].trim();
      if (loraName && !loras.includes(loraName)) {
        loras.push(loraName);
      }
    }
  });

  // Also check metadata for LoRA fields
  if (metadata.loras && Array.isArray(metadata.loras)) {
    metadata.loras.forEach((lora: any) => {
      let loraName = '';

      if (typeof lora === 'string') {
        loraName = lora.trim();
      } else if (lora && typeof lora === 'object') {
        // First check direct string properties
        const directNames = [lora.name, lora.model_name, lora.key];

        // Then check if model is an object with name properties
        if (lora.model && typeof lora.model === 'object') {
          directNames.push(lora.model.name, lora.model.model, lora.model.model_name, lora.model.key);
        } else if (lora.model && typeof lora.model === 'string') {
          directNames.push(lora.model);
        }

        for (const name of directNames) {
          if (name && typeof name === 'string' && name.trim().length > 0) {
            loraName = name.trim();
            break;
          }
        }

        // If still no valid name found, skip this lora
        if (!loraName) {
          return;
        }
      }

      // Basic validation - avoid empty strings and [object Object]
      if (loraName &&
          loraName.length > 0 &&
          loraName !== '[object Object]' &&
          !loras.includes(loraName)) {
        loras.push(loraName);
      }
    });
  }

  // Check for LoRA in other common metadata fields
  if (metadata.lora) {
    let loraName = '';

    if (typeof metadata.lora === 'string') {
      loraName = metadata.lora.trim();
    } else if (metadata.lora && typeof metadata.lora === 'object') {
      loraName = metadata.lora.name || metadata.lora.model || metadata.lora.key;
      if (typeof loraName !== 'string') {
        loraName = metadata.lora.key || JSON.stringify(metadata.lora);
      }
    }

    if (loraName && loraName.length > 0 && !loras.includes(loraName)) {
      loras.push(loraName);
    }
  }

  return loras.filter(Boolean);
}

// Extract LoRAs from Automatic1111 metadata
function extractLorasFromAutomatic1111(metadata: Automatic1111Metadata): string[] {
  const loras: string[] = [];
  const params = metadata.parameters;

  // Look for LoRA patterns in the parameters string
  // Common formats: <lora:name:weight>, <lyco:name:weight>
  const loraPatterns = [
    /<lora:([^:>]+):[^>]*>/gi,
    /<lyco:([^:>]+):[^>]*>/gi
  ];

  loraPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(params)) !== null) {
      const loraName = match[1].trim();
      if (loraName && !loras.includes(loraName)) {
        loras.push(loraName);
      }
    }
  });

  return loras;
}

// Extract LoRAs from ComfyUI metadata
function extractLorasFromComfyUI(metadata: ComfyUIMetadata): string[] {
  const loras: string[] = [];

  try {
    // Parse workflow if it's a string
    let workflow: any = metadata.workflow;
    if (typeof workflow === 'string') {
      workflow = JSON.parse(workflow);
    }

    // Parse prompt if it's a string
    let prompt: any = metadata.prompt;
    if (typeof prompt === 'string') {
      prompt = JSON.parse(prompt);
    }

    // Look for LoRA information in workflow nodes
    if (workflow && workflow.nodes) {
      for (const node of workflow.nodes) {
        if (node.type && (node.type.toLowerCase().includes('lora') || node.type.toLowerCase().includes('lyco'))) {
          // Check widgets_values for LoRA name
          if (node.widgets_values && node.widgets_values.length > 0) {
            const loraName = node.widgets_values[0];
            if (typeof loraName === 'string' && loraName.trim()) {
              loras.push(loraName.trim());
            }
          }
          // Check inputs for LoRA information
          if (node.inputs) {
            for (const [key, value] of Object.entries(node.inputs)) {
              if (key.toLowerCase().includes('lora_name') || key.toLowerCase().includes('lyco_name')) {
                if (typeof value === 'string' && value.trim()) {
                  loras.push(value.trim());
                }
              }
            }
          }
        }
      }
    }

    // Look for LoRA information in prompt
    if (prompt) {
      for (const [nodeId, nodeData] of Object.entries(prompt)) {
        const node = nodeData as any;
        if (node.class_type && (node.class_type.toLowerCase().includes('lora') || node.class_type.toLowerCase().includes('lyco'))) {
          if (node.inputs) {
            for (const [key, value] of Object.entries(node.inputs)) {
              if (key.toLowerCase().includes('lora_name') || key.toLowerCase().includes('lyco_name')) {
                if (typeof value === 'string' && value.trim()) {
                  loras.push(value.trim());
                }
              }
            }
          }
        }
      }
    }

  } catch (error) {
    console.warn('Failed to parse ComfyUI workflow/prompt for LoRA extraction:', error);
  }

  return loras.filter(Boolean);
}

// Fallback function to extract LoRAs from raw metadata for unknown formats
function extractLorasFromRawMetadata(metadata: any): string[] {
  const loras: string[] = [];

  // Try common LoRA field names across different formats
  const possibleLoraFields = ['loras', 'lora', 'lora_name', 'lyco', 'lyco_name'];

  for (const field of possibleLoraFields) {
    if (metadata[field]) {
      if (Array.isArray(metadata[field])) {
        loras.push(...metadata[field].filter((l: any) => typeof l === 'string' && l.trim()));
      } else if (typeof metadata[field] === 'string') {
        loras.push(metadata[field].trim());
      }
    }
  }

  // Try to extract from nested objects (ComfyUI style)
  if (metadata.workflow?.nodes) {
    for (const node of metadata.workflow.nodes) {
      if (node.class_type && (node.class_type.toLowerCase().includes('lora') || node.class_type.toLowerCase().includes('lyco'))) {
        if (node.inputs?.lora_name) {
          loras.push(node.inputs.lora_name);
        }
      }
    }
  }

  return loras;
}

// Function to extract scheduler from metadata
function extractScheduler(metadata: ImageMetadata): string {
  // First check if normalized metadata is available (faster path)
  if ('normalizedMetadata' in metadata && metadata.normalizedMetadata) {
    const normalized = metadata.normalizedMetadata;
    if (normalized.scheduler) {
      console.log('🔍 Using normalized metadata for scheduler extraction');
      return normalized.scheduler;
    }
  }

  // Fallback to format-specific extraction
  // Handle InvokeAI metadata
  if (isInvokeAIMetadata(metadata)) {
    return metadata.scheduler || 'Unknown';
  }

  // Handle Automatic1111 metadata
  if (isAutomatic1111Metadata(metadata)) {
    return extractSchedulerFromAutomatic1111(metadata);
  }

  // Handle ComfyUI metadata
  if (isComfyUIMetadata(metadata)) {
    return extractSchedulerFromComfyUI(metadata);
  }

  // Fallback: try to extract from raw metadata for unknown formats
  console.log('⚠️ Unknown metadata format for scheduler, attempting fallback extraction');
  return extractSchedulerFromRawMetadata(metadata);
}

// Extract scheduler from Automatic1111 metadata
function extractSchedulerFromAutomatic1111(metadata: Automatic1111Metadata): string {
  const params = metadata.parameters;

  // Look for "Sampler:" pattern in the parameters string
  const samplerMatch = params.match(/Sampler:\s*([^,\n]+)/i);
  if (samplerMatch) {
    return samplerMatch[1].trim();
  }

  return 'Unknown';
}

// Extract scheduler from ComfyUI metadata
function extractSchedulerFromComfyUI(metadata: ComfyUIMetadata): string {
  try {
    // Parse prompt if it's a string
    let prompt: any = metadata.prompt;
    if (typeof prompt === 'string') {
      prompt = JSON.parse(prompt);
    }

    // Look for sampler/scheduler information in prompt
    if (prompt) {
      for (const [nodeId, nodeData] of Object.entries(prompt)) {
        const node = nodeData as any;
        if (node.class_type && node.class_type.toLowerCase().includes('sampler')) {
          if (node.inputs) {
            // Look for sampler_name or scheduler input
            const samplerName = node.inputs.sampler_name || node.inputs.scheduler;
            if (typeof samplerName === 'string' && samplerName.trim()) {
              return samplerName.trim();
            }
          }
        }
      }
    }

  } catch (error) {
    console.warn('Failed to parse ComfyUI prompt for scheduler extraction:', error);
  }

  return 'Unknown';
}

// Fallback function to extract scheduler from raw metadata for unknown formats
function extractSchedulerFromRawMetadata(metadata: any): string {
  // Try common scheduler field names across different formats
  const possibleSchedulerFields = ['scheduler', 'sampler', 'sampler_name', 'sampling_method'];

  for (const field of possibleSchedulerFields) {
    if (metadata[field] && typeof metadata[field] === 'string') {
      return metadata[field].trim();
    }
  }

  // Try to extract from nested objects (ComfyUI style)
  if (metadata.workflow?.nodes) {
    for (const node of metadata.workflow.nodes) {
      if (node.class_type && node.class_type.toLowerCase().includes('sampler')) {
        if (node.inputs?.sampler_name) {
          return node.inputs.sampler_name;
        }
      }
    }
  }

  return 'Unknown';
}

// Function to extract board information from metadata
function extractBoard(metadata: ImageMetadata): string {
  // Handle InvokeAI metadata (only format that currently supports boards)
  if (isInvokeAIMetadata(metadata)) {
    return extractBoardFromInvokeAI(metadata);
  }

  // Automatic1111 and ComfyUI don't have board concepts, so return uncategorized
  return 'Uncategorized';
}

// Extract board information from InvokeAI metadata
function extractBoardFromInvokeAI(metadata: InvokeAIMetadata): string {
  // Check for board_name first (most common)
  if (metadata.board_name && typeof metadata.board_name === 'string') {
    return metadata.board_name.trim();
  }

  // Check for board_id as fallback
  if (metadata.board_id && typeof metadata.board_id === 'string') {
    return metadata.board_id.trim();
  }

  // Check different case variations
  if (metadata.boardName && typeof metadata.boardName === 'string') {
    return metadata.boardName.trim();
  }

  if (metadata.boardId && typeof metadata.boardId === 'string') {
    return metadata.boardId.trim();
  }

  // Check for 'Board Name' with space
  if (metadata['Board Name'] && typeof metadata['Board Name'] === 'string') {
    return metadata['Board Name'].trim();
  }

  // Check for board object
  if (metadata.board && typeof metadata.board === 'object') {
    const boardObj = metadata.board as any;
    if (boardObj.name) return boardObj.name;
    if (boardObj.board_name) return boardObj.board_name;
    if (boardObj.id) return boardObj.id;
  }

  // Check for board as direct string
  if (metadata.board && typeof metadata.board === 'string') {
    return metadata.board.trim();
  }

  // NEW: Check canvas_v2_metadata for board information
  if (metadata.canvas_v2_metadata && typeof metadata.canvas_v2_metadata === 'object') {
    const canvasData = metadata.canvas_v2_metadata as any;
    // console.log('🔍 FULL canvas_v2_metadata:', JSON.stringify(canvasData, null, 2));
    // Look for board_id in canvas metadata
    if (canvasData.board_id) {
      const boardId = canvasData.board_id;
      // console.log('🔍 Found board_id in canvas_v2_metadata:', boardId);
      return getFriendlyBoardName(boardId);
    }
    // Look for board object in canvas metadata
    if (canvasData.board && typeof canvasData.board === 'object') {
      const boardObj = canvasData.board;
      if (boardObj.board_id) {
        // console.log('🔍 Found board.board_id in canvas_v2_metadata:', boardObj.board_id);
        return getFriendlyBoardName(boardObj.board_id);
      }
    }
  }

  // Check inside workflow for board information (if it exists)
  if (metadata.workflow && typeof metadata.workflow === 'object') {
    const workflow = metadata.workflow as any;

    // Check if workflow is a string (JSON)
    if (typeof workflow === 'string') {
      try {
        const workflowObj = JSON.parse(workflow);
        const boardInfo = extractBoardFromWorkflow(workflowObj);
        if (boardInfo) {
          return boardInfo;
        }
      } catch (e) {
        // Failed to parse workflow JSON
      }
    } else {
      // Workflow is already an object
      const boardInfo = extractBoardFromWorkflow(workflow);
      if (boardInfo) {
        return boardInfo;
      }
    }
  }

  // Try to find any field that might contain board info
  for (const [key, value] of Object.entries(metadata)) {
    if (key.toLowerCase().includes('board') && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  // Default to "Uncategorized" if no board info found
  return 'Uncategorized';
}

// Helper function to extract board info from workflow
function extractBoardFromWorkflow(workflow: any): string | null {
  if (!workflow || !workflow.nodes) return null;

  // Look for canvas_output or l2i nodes that typically contain board info
  for (const node of workflow.nodes) {
    if (node.data && node.data.type && (node.data.type === 'l2i' || node.data.type === 'canvas_output')) {
      if (node.data.inputs && node.data.inputs.board) {
        const boardInput = node.data.inputs.board;

        // Check if board has a value with board_id
        if (boardInput.value && boardInput.value.board_id) {
          const boardId = boardInput.value.board_id;

          // Use the friendly board name mapping
          return getFriendlyBoardName(boardId);
        }
      }
    }
  }

  return null;
}

// Function to extract prompt text from metadata
function extractPrompt(metadata: ImageMetadata): string {
  // First check if normalized metadata is available (faster path)
  if ('normalizedMetadata' in metadata && metadata.normalizedMetadata) {
    const normalized = metadata.normalizedMetadata;
    if (normalized.prompt) {
      console.log('🔍 Using normalized metadata for prompt extraction');
      return normalized.prompt;
    }
  }

  // NOVO: Se tem parameters (ComfyUI com A1111 embarcado), parse com A1111
  if (metadata.parameters && typeof metadata.parameters === 'string') {
    const a1111Data = parseA1111Metadata(metadata.parameters);
    if (a1111Data.prompt) return a1111Data.prompt;
  }

  // Fallback to format-specific extraction
  // Handle InvokeAI metadata
  if (isInvokeAIMetadata(metadata)) {
    // Try positive_prompt first (newer InvokeAI format)
    if (metadata.positive_prompt) {
      let prompt = metadata.positive_prompt;
      if (metadata.negative_prompt) {
        prompt += ' ### ' + metadata.negative_prompt;
      }
      return prompt;
    }

    // Fallback to legacy prompt field
    if (typeof metadata.prompt === 'string') {
      return metadata.prompt;
    } else if (Array.isArray(metadata.prompt)) {
      return metadata.prompt
        .map(p => typeof p === 'string' ? p : (p as any)?.prompt || '')
        .filter(p => p.trim())
        .join(' ');
    } else if (typeof metadata.prompt === 'object' && (metadata.prompt as any).prompt) {
      return (metadata.prompt as any).prompt;
    }
  }

  // Handle Automatic1111 metadata
  if (isAutomatic1111Metadata(metadata)) {
    // Extract prompt from the parameters string (everything before "Negative prompt:")
    const params = metadata.parameters;
    const negativePromptIndex = params.indexOf('\nNegative prompt:');
    if (negativePromptIndex !== -1) {
      return params.substring(0, negativePromptIndex).trim();
    }
    // If no negative prompt, take everything before the first parameter line
    const firstParamIndex = params.search(/\n[A-Z][a-z]+:/);
    if (firstParamIndex !== -1) {
      return params.substring(0, firstParamIndex).trim();
    }
    return params.trim();
  }

  // Handle ComfyUI metadata
  if (isComfyUIMetadata(metadata)) {
    try {
      // Parse prompt if it's a string
      let prompt: any = metadata.prompt;
      if (typeof prompt === 'string') {
        prompt = JSON.parse(prompt);
      }

      if (prompt) {
        // Look for CLIPTextEncode or similar text input nodes
        for (const [nodeId, nodeData] of Object.entries(prompt)) {
          const node = nodeData as any;
          if (node.class_type && node.class_type.toLowerCase().includes('text') &&
              node.class_type.toLowerCase().includes('encode')) {
            if (node.inputs && node.inputs.text && typeof node.inputs.text === 'string') {
              return node.inputs.text.trim();
            }
          }
        }

        // Fallback: look for any node with text input
        for (const [nodeId, nodeData] of Object.entries(prompt)) {
          const node = nodeData as any;
          if (node.inputs && node.inputs.text && typeof node.inputs.text === 'string') {
            return node.inputs.text.trim();
          }
        }
      }
    } catch (error) {
      console.warn('Failed to extract prompt from ComfyUI metadata:', error);
    }
  }

  // SPECIAL CASE: If we have normalizedMetadata but couldn't detect format,
  // it might be a cached ComfyUI image. Try to extract from normalizedMetadata directly
  if (metadata && typeof metadata === 'object' && 'normalizedMetadata' in metadata && (metadata as any).normalizedMetadata) {
    const normalized = (metadata as any).normalizedMetadata;
    console.log('🔍 No format detected but have normalizedMetadata - trying ComfyUI extraction for prompt');
    if (normalized.prompt && typeof normalized.prompt === 'string') {
      return normalized.prompt;
    }
  }

  return '';
}

// Function to extract negative prompt text from metadata
function extractNegativePrompt(metadata: ImageMetadata): string | undefined {
  // First check if normalized metadata is available (faster path)
  if ('normalizedMetadata' in metadata && metadata.normalizedMetadata) {
    const normalized = metadata.normalizedMetadata;
    if (normalized.negativePrompt) {
      console.log('🔍 Using normalized metadata for negative prompt extraction');
      return normalized.negativePrompt;
    }
  }

  // For ComfyUI, the negative prompt is extracted during parseComfyUIMetadata
  // For other formats, negative prompts are typically embedded in the main prompt

  // SPECIAL CASE: If we have normalizedMetadata but couldn't detect format,
  // it might be a cached ComfyUI image. Try to extract from normalizedMetadata directly
  if (metadata && typeof metadata === 'object' && 'normalizedMetadata' in metadata && (metadata as any).normalizedMetadata) {
    const normalized = (metadata as any).normalizedMetadata;
    console.log('🔍 No format detected but have normalizedMetadata - trying ComfyUI extraction for negativePrompt');
    if (normalized.negativePrompt && typeof normalized.negativePrompt === 'string') {
      return normalized.negativePrompt;
    }
  }

  return undefined;
}

// Board mapping cache to track unique board IDs and names
const boardIdCache = new Map<string, string>();
let boardCounter = 1;

// Function to get or create a friendly board name
function getFriendlyBoardName(boardId: string): string {
  if (boardIdCache.has(boardId)) {
    return boardIdCache.get(boardId)!;
  }

  // Create a new friendly name for this board ID
  const friendlyName = `My Board ${boardCounter}`;
  boardIdCache.set(boardId, friendlyName);
  boardCounter++;

  return friendlyName;
}

// Parse PNG metadata from tEXt chunks
async function parsePNGMetadata(buffer: ArrayBuffer, file: File): Promise<ImageMetadata | null> {
  const view = new DataView(buffer);
  let offset = 8;
  const decoder = new TextDecoder();

  // Collect all relevant chunks first
  const chunks: { [key: string]: string } = {};

  while (offset < buffer.byteLength) {
    const length = view.getUint32(offset);
    const type = decoder.decode(buffer.slice(offset + 4, offset + 8));

    if (type === 'tEXt') {
      const chunkData = buffer.slice(offset + 8, offset + 8 + length);
      const chunkString = decoder.decode(chunkData);
      const [keyword, text] = chunkString.split('\0');

      // DEBUG: Log all tEXt chunks found
      console.log(`📄 PNG chunk found: ${keyword} (length: ${text?.length || 0})`);

      // Collect relevant metadata chunks
      if (['invokeai_metadata', 'parameters', 'workflow', 'prompt'].includes(keyword) && text) {
        chunks[keyword] = text;
        console.log(`✅ Collected chunk: ${keyword}`);
      }
    }

    if (type === 'IEND') {
      break; // End of file
    }

    offset += 12 + length; // 4 for length, 4 for type, length for data, 4 for CRC
  }

  // Determine format based on priority:
  // 1. workflow → ComfyUI (highest priority)
  // 2. invokeai_metadata → InvokeAI
  // 3. parameters → Automatic1111
  // 4. prompt only → ComfyUI

  if (chunks.workflow) {
    // ComfyUI format (highest priority)
    let workflowData: any;
    let promptData: any = null;

    try {
      workflowData = JSON.parse(chunks.workflow);
    } catch {
      workflowData = chunks.workflow; // Keep as string if not valid JSON
    }

    if (chunks.prompt) {
      try {
        promptData = JSON.parse(chunks.prompt);
      } catch {
        promptData = chunks.prompt; // Keep as string if not valid JSON
      }
    }

    const comfyMetadata: ComfyUIMetadata = {
      workflow: workflowData,
      prompt: promptData
    };

    // Add normalized metadata for enhanced filtering
    try {
      comfyMetadata.normalizedMetadata = parseComfyUIMetadata(comfyMetadata);
    } catch (error) {
      console.warn('Failed to parse normalized metadata for ComfyUI:', error);
    }

    return comfyMetadata;

  } else if (chunks.invokeai_metadata) {
    // InvokeAI format
    const metadata = JSON.parse(chunks.invokeai_metadata);
    return metadata as InvokeAIMetadata;

  } else if (chunks.parameters) {
    // Automatic1111 format
    const a1111Metadata = {
      parameters: chunks.parameters
    } as Automatic1111Metadata;

    // Add normalized metadata for enhanced filtering
    try {
      a1111Metadata.normalizedMetadata = parseA1111Metadata(chunks.parameters);
    } catch (error) {
      console.warn('Failed to parse normalized metadata for Automatic1111:', error);
    }

    return a1111Metadata;

  } else if (chunks.prompt) {
    // ComfyUI prompt-only format
    let promptData: any;
    try {
      promptData = JSON.parse(chunks.prompt);
    } catch {
      promptData = chunks.prompt; // Keep as string if not valid JSON
    }

    const comfyMetadata: ComfyUIMetadata = {
      prompt: promptData
    };

    // Add normalized metadata for enhanced filtering
    try {
      comfyMetadata.normalizedMetadata = parseComfyUIMetadata(comfyMetadata);
    } catch (error) {
      console.warn('Failed to parse normalized metadata for ComfyUI:', error);
    }

    return comfyMetadata;
  }

  return null;
}

// Parse JPEG metadata from EXIF data
async function parseJPEGMetadata(buffer: ArrayBuffer, file: File): Promise<ImageMetadata | null> {
  console.log(`� Processing JPEG file: ${file.name}`);

  try {
    // Use exifr to extract EXIF data
    const exifData = await parse(buffer, {
      // Extract specific EXIF fields that might contain metadata
      pick: ['UserComment', 'ImageDescription', 'Description', 'XPComment', 'XPTitle']
    });

    console.log(`🔍 EXIF data extracted for ${file.name}:`, exifData);

    let metadataText = null;
    let sourceField = null;

    // Priority order for metadata fields
    const fieldsToCheck = ['userComment', 'imageDescription', 'description', 'xpComment', 'xpTitle'];

    for (const field of fieldsToCheck) {
      if (exifData && exifData[field] && typeof exifData[field] === 'string' && exifData[field].trim()) {
        metadataText = exifData[field].trim();
        sourceField = field;
        console.log(`📝 Found metadata in ${field} field for ${file.name}: ${metadataText.substring(0, 100)}...`);
        break;
      }
    }

    if (metadataText) {
      // Try to parse as JSON first (for structured metadata like InvokeAI)
      try {
        const parsedMetadata = JSON.parse(metadataText);
        console.log(`✅ Successfully parsed JSON metadata from JPEG ${sourceField}: ${file.name}`);
        return parsedMetadata as ImageMetadata;
      } catch (jsonError) {
        console.log(`🔄 JSON parsing failed for ${file.name}, trying A1111 format...`);

        // If not JSON, try to parse as Automatic1111 format
        try {
          const normalized = parseA1111Metadata(metadataText);
          console.log(`✅ Successfully parsed A1111 metadata from JPEG ${sourceField}: ${file.name}`);
          return {
            parameters: metadataText,
            normalizedMetadata: normalized
          } as Automatic1111Metadata;
        } catch (a1111Error) {
          console.log(`⚠️ Could not parse metadata format in JPEG ${sourceField}: ${file.name}`, a1111Error);
          return null;
        }
      }
    } else {
      console.log(`❌ No metadata found in EXIF fields for JPEG: ${file.name}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Failed to parse JPEG EXIF metadata for ${file.name}:`, error);
    return null;
  }
}

async function parseImageMetadata(file: File): Promise<ImageMetadata | null> {
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    const fileName = file.name.toLowerCase();

    // Check if it's a PNG file
    if (view.getUint32(0) === 0x89504E47 && view.getUint32(4) === 0x0D0A1A0A) {
      console.log(`🖼️ Detected PNG format for: ${file.name}`);
      return parsePNGMetadata(buffer, file);
    }

    // Check if it's a JPEG file
    if (view.getUint16(0) === 0xFFD8) {
      console.log(`�️ Detected JPEG format for: ${file.name}`);
      return parseJPEGMetadata(buffer, file);
    }

    console.log(`❓ Unknown file format for: ${file.name} (first 4 bytes: ${view.getUint32(0).toString(16)})`);
    return null; // Not a supported image format
  } catch (error) {
    console.error(`Failed to parse metadata for ${file.name}:`, error);
    return null;
  }
}

export async function getFileHandlesRecursive(
  directoryHandle: FileSystemDirectoryHandle,
  path: string = ''
): Promise<{handle: FileSystemFileHandle, path: string}[]> {
  const entries = [];
  const dirHandle = directoryHandle as any;

  // IMPROVED: Add Electron detection and handling like in App.tsx
  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

  console.log('🔧 getFileHandlesRecursive called for Electron:', isElectron);
  console.log('🔧 window.electronAPI exists:', typeof (window as any).electronAPI !== 'undefined');
  console.log('🔧 listDirectoryFiles is function:', typeof (window as any).electronAPI?.listDirectoryFiles === 'function');
  console.log('🔧 electronAPI keys:', (window as any).electronAPI ? Object.keys((window as any).electronAPI) : 'N/A');

  if (isElectron) {
    try {
      const electronPath = localStorage.getItem('invokeai-electron-directory-path');

      if (!electronPath) {
        console.error('❌ No Electron directory path stored in localStorage');
        return entries;
      }

      const result = await (window as any).electronAPI.listDirectoryFiles(electronPath);

      // Validate result object exists and has expected structure
      if (!result) {
        console.error('❌ listDirectoryFiles returned undefined/null');
        return entries;
      }

      if (!result.success) {
        console.error('❌ Electron API failed:', result.error || 'Unknown error');
        return entries;
      }

      if (result.success && result.files) {
        console.log('✅ Found', result.files.length, 'files in Electron directory');

        for (const fileInfo of result.files) {
          // Create a mock file handle for Electron
          const mockHandle = {
            name: fileInfo.name,
            kind: 'file' as const,
            getFile: async () => {
              try {
                // FIX: Cross-platform path joining - use forward slash for both Windows and macOS
                const fullPath = electronPath + '/' + fileInfo.name;

                const fileResult = await (window as any).electronAPI.readFile(fullPath);
                if (fileResult.success) {
                  // Create a proper File object from the buffer with lastModified date
                  const uint8Array = new Uint8Array(fileResult.data);
                  return new File([uint8Array], fileInfo.name, {
                    type: 'image/png',
                    lastModified: fileInfo.lastModified
                  });
                } else {
                  // Only log errors that aren't "file not found" to avoid spam when cache is stale
                  if (!fileResult.error?.includes('ENOENT') && !fileResult.error?.includes('no such file')) {
                    console.error('❌ Failed to read file:', fileInfo.name, fileResult.error);
                  }
                  // Return empty file as fallback with lastModified
                  return new File([], fileInfo.name, {
                    type: 'image/png',
                    lastModified: fileInfo.lastModified
                  });
                }
              } catch (error) {
                // Only log errors that aren't "file not found" to avoid spam when cache is stale
                if (!error?.message?.includes('ENOENT') && !error?.message?.includes('no such file')) {
                  console.error('❌ Error reading file in Electron:', fileInfo.name, error);
                }
                return new File([], fileInfo.name, {
                  type: 'image/png',
                  lastModified: fileInfo.lastModified
                });
              }
            }
          };
          entries.push({ handle: mockHandle, path: fileInfo.name });
        }
      } else {
        console.error('❌ Electron API failed:', result.error);
      }

      return entries;
    } catch (error) {
      console.error('❌ Error listing files in Electron:', error);
      return entries;
    }
  } else {
    // Use browser File System Access API
    console.log('🌐 Using browser File System Access API in getFileHandlesRecursive');
    try {
      for await (const entry of dirHandle.values()) {
        const newPath = path ? `${path}/${entry.name}` : entry.name;
        if (entry.kind === 'file') {
          entries.push({handle: entry, path: newPath});
        } else if (entry.kind === 'directory') {
          // Fix: Explicitly cast entry to FileSystemDirectoryHandle as TypeScript fails to narrow the type.
          entries.push(...(await getFileHandlesRecursive(entry as FileSystemDirectoryHandle, newPath)));
        }
      }
    } catch (error) {
      console.error('❌ Error in browser File System Access API:', error);
      throw error;
    }
    return entries;
  }
}

// Function to filter out InvokeAI intermediate images
export function isIntermediateImage(filename: string): boolean {
  // DISABLED - showing all images for now
  return false;

  const name = filename.toLowerCase();

  // ONLY specific intermediate patterns - not normal InvokeAI images
  const intermediatePatterns = [
    // Classic intermediate patterns
    /^intermediate_/,
    /_intermediate_/,
    /^canvas_/,
    /_canvas_/,
    /^controlnet_/,
    /_controlnet_/,
    /^inpaint_/,
    /_inpaint_/,
    /^tmp_/,
    /_tmp_/,
    /^temp_/,
    /_temp_/,
    /\.tmp\.png$/,
    /\.temp\.png$/,

    // Only very specific intermediate patterns
    /^step_\d+_/, // step_001_something.png (not just step_)
    /^preview_step/, // preview_step images
    /^progress_/, // progress images
    /^mask_temp/, // temporary masks only
    /^noise_sample/, // noise samples
    /^guidance_preview/, // guidance previews
  ];

  return intermediatePatterns.some(pattern => pattern.test(name));
}

export async function processDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  setProgress: (progress: { current: number; total: number }) => void,
  specificFiles?: { handle: FileSystemFileHandle; path: string }[],
  directoryName?: string
): Promise<IndexedImage[]> {
  console.log('🔧 processDirectory called with handle:', {
    name: directoryHandle.name,
    kind: directoryHandle.kind,
    hasGetDirectoryHandle: typeof (directoryHandle as any).getDirectoryHandle === 'function',
    hasValues: typeof (directoryHandle as any).values === 'function',
    hasEntries: typeof (directoryHandle as any).entries === 'function'
  });

  try {
    console.log('🔧 About to call getFileHandlesRecursive...');
    const allFileEntries = specificFiles || await getFileHandlesRecursive(directoryHandle);
    console.log(`📂 Found ${allFileEntries.length} total files in directory`);

    const imageFiles = allFileEntries.filter(entry => {
      const name = entry.handle.name.toLowerCase();
      const isImageFile = name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg');
      const isIntermediate = isIntermediateImage(entry.handle.name);

      if (isImageFile && !isIntermediate) {
        console.log(`✅ Including image file: ${entry.handle.name}`);
        return true;
      } else if (isImageFile && isIntermediate) {
        console.log(`⏭️ Skipping intermediate image file: ${entry.handle.name}`);
        return false;
      } else {
        console.log(`⏭️ Skipping non-image file: ${entry.handle.name}`);
        return false;
      }
    });

    console.log(`🖼️ Filtered to ${imageFiles.length} valid image files (.png, .jpg, .jpeg)`);

    // Try to find thumbnails directory
    let thumbnailsDir: FileSystemDirectoryHandle | null = null;
    let thumbnailMap = new Map<string, FileSystemFileHandle>();

    // Check if we're in Electron environment
    const isElectron = typeof window !== 'undefined' && window.electronAPI;

    if (isElectron) {
      // In Electron, use the API to list thumbnail files
      try {
        const electronPath = localStorage.getItem('invokeai-electron-directory-path');
        if (electronPath) {
          const thumbnailsPath = electronPath + '/thumbnails';
          console.log('🔧 Attempting to list thumbnails in Electron:', thumbnailsPath);

          const result = await window.electronAPI.listDirectoryFiles(thumbnailsPath);
          if (result.success && result.files) {
            console.log('🔧 Found', result.files.length, 'files in thumbnails directory');

            for (const fileInfo of result.files) {
              if (fileInfo.name.toLowerCase().endsWith('.webp')) {
                // Create mock thumbnail handle
                const mockThumbnailHandle = {
                  name: fileInfo.name,
                  kind: 'file' as const,
                  getFile: async () => {
                    try {
                      const fullPath = thumbnailsPath + '/' + fileInfo.name;
                      const fileResult = await window.electronAPI.readFile(fullPath);
                      if (fileResult.success && fileResult.data) {
                        // Convert Buffer to Uint8Array then to Blob
                        const uint8Array = new Uint8Array(fileResult.data);
                        const blob = new Blob([uint8Array], { type: 'image/webp' });
                        return blob;
                      } else {
                        throw new Error(fileResult.error || 'Failed to read thumbnail file');
                      }
                    } catch (error) {
                      console.error('Failed to read thumbnail file:', error);
                      throw error;
                    }
                  }
                };

                // Map thumbnail name to PNG name (remove .webp, add .png)
                const pngName = fileInfo.name.replace(/\.webp$/i, '.png');
                thumbnailMap.set(pngName, mockThumbnailHandle as any);
              }
            }
          } else {
            console.log('🔧 Thumbnails directory not found or empty in Electron');
          }
        }
      } catch (error) {
        console.log('🔧 Error accessing thumbnails in Electron:', error.message);
      }
    } else {
      // Browser environment - use File System Access API
      try {
        console.log('🔧 Attempting to get thumbnails directory in browser...');
        thumbnailsDir = await directoryHandle.getDirectoryHandle('thumbnails');
        console.log('🔧 Thumbnails directory found in browser');
      } catch (error) {
        console.log('🔧 Thumbnails directory not found in browser (expected):', error.message);
      }

      // Get thumbnail files if directory exists
      if (thumbnailsDir) {
        const thumbnailEntries = await getFileHandlesRecursive(thumbnailsDir);
        const webpFiles = thumbnailEntries.filter(entry => entry.handle.name.toLowerCase().endsWith('.webp'));

        for (const thumbEntry of webpFiles) {
          // Map thumbnail name to PNG name (remove .webp, add .png)
          const pngName = thumbEntry.handle.name.replace(/\.webp$/i, '.png');
          thumbnailMap.set(pngName, thumbEntry.handle);
        }
      }
    }

  const total = imageFiles.length;
  setProgress({ current: 0, total });

  const indexedImages: IndexedImage[] = [];
  let processedCount = 0;

  for (const fileEntry of imageFiles) {
    try {
      const file = await fileEntry.handle.getFile();
      const metadata = await parseImageMetadata(file);
      if (metadata) {
        // Create metadataString safely, handling non-serializable data
        let metadataString: string;
        try {
          metadataString = JSON.stringify(metadata);
        } catch (error) {
          console.warn(`⚠️ Failed to stringify metadata for ${fileEntry.handle.name}, using fallback:`, error);
          // Fallback: create a minimal serializable version
          metadataString = JSON.stringify({
            ...metadata,
            // Remove any potentially non-serializable properties
            normalizedMetadata: undefined,
            workflow: typeof metadata.workflow === 'string' ? metadata.workflow : undefined,
            prompt: typeof metadata.prompt === 'string' ? metadata.prompt : undefined
          });
        }
        const models = extractModels(metadata);
        const loras = extractLoras(metadata);
        const scheduler = extractScheduler(metadata);
        const board = extractBoard(metadata);

        // Find corresponding thumbnail
        const thumbnailHandle = thumbnailMap.get(fileEntry.handle.name);

        indexedImages.push({
          id: fileEntry.path,
          name: fileEntry.handle.name,
          handle: fileEntry.handle,
          thumbnailHandle,
          metadata,
          metadataString,
          lastModified: file.lastModified,
          models,
          loras,
          scheduler,
          board,
          prompt: extractPrompt(metadata),
          negativePrompt: extractNegativePrompt(metadata),
          cfgScale: extractCfgScale(metadata),
          steps: extractSteps(metadata),
          seed: extractSeed(metadata),
          dimensions: extractDimensions(metadata),
          directoryName,
        });

        // DEBUG: Verificar se IndexedImage está sendo povoado
        const indexedImage = {
          id: fileEntry.path,
          name: fileEntry.handle.name,
          handle: fileEntry.handle,
          thumbnailHandle,
          metadata,
          metadataString,
          lastModified: file.lastModified,
          models,
          loras,
          scheduler,
          board,
          prompt: extractPrompt(metadata),
          negativePrompt: extractNegativePrompt(metadata),
          cfgScale: extractCfgScale(metadata),
          steps: extractSteps(metadata),
          seed: extractSeed(metadata),
          dimensions: extractDimensions(metadata),
          directoryName,
        };
        console.log('DEBUG indexedImage.cfgScale:', indexedImage.cfgScale);
        console.log('DEBUG indexedImage.steps:', indexedImage.steps);
        console.log('DEBUG indexedImage.seed:', indexedImage.seed);
        console.log('DEBUG indexedImage.dimensions:', indexedImage.dimensions);
        console.log('DEBUG indexedImage.prompt:', indexedImage.prompt);
      }
    } catch (error) {
        console.error(`Skipping file ${fileEntry.handle.name} due to an error:`, error);
    }

    processedCount++;
    if (processedCount % 20 === 0 || processedCount === total) { // Update progress in batches
      setProgress({ current: processedCount, total });
    }
  }

  // Remove any duplicates by filename to prevent React key conflicts
  const seenNames = new Set<string>();
  const uniqueImages = indexedImages.filter(image => {
    if (seenNames.has(image.name)) {
      console.warn(`⚠️ Duplicate image found and removed: ${image.name}`);
      return false;
    }
    seenNames.add(image.name);
    return true;
  });

  console.log(`✅ Processed ${uniqueImages.length} unique images (${indexedImages.length - uniqueImages.length} duplicates removed)`);

  return uniqueImages;
  } catch (error) {
    console.error('❌ Error in processDirectory:', error);
    throw error;
  }
}

// Function to parse ComfyUI workflow and extract normalized metadata
function parseComfyUIMetadata(metadata: ComfyUIMetadata): BaseMetadata {
  const result: BaseMetadata = {
    prompt: '',
    model: '',
    width: 0,
    height: 0,
    steps: 0,
    scheduler: '',
    // Additional normalized fields
    models: [],
    loras: [],
    board: '',
    negativePrompt: '',
    cfgScale: 0,
    seed: undefined,
  };

  try {
    let workflow: any = metadata.workflow;
    let prompt: any = metadata.prompt;

    console.log('🔍 Parsing ComfyUI metadata:', {
      hasWorkflow: !!workflow,
      hasPrompt: !!prompt,
      workflowType: typeof workflow,
      promptType: typeof prompt
    });

    // Parse workflow if it's a string
    if (typeof workflow === 'string') {
      try {
        workflow = JSON.parse(workflow);
        console.log('✅ Parsed workflow JSON successfully');
      } catch (error) {
        console.warn('❌ Failed to parse ComfyUI workflow string:', error);
        return result;
      }
    }

    // Parse prompt if it's a string
    if (typeof prompt === 'string') {
      try {
        prompt = JSON.parse(prompt);
        console.log('✅ Parsed prompt JSON successfully');
      } catch (error) {
        console.warn('❌ Failed to parse ComfyUI prompt string:', error);
        return result;
      }
    }

    // Determine which data source to use (prefer workflow over prompt)
    const dataSource = workflow || prompt;
    if (!dataSource) {
      console.warn('❌ No valid workflow or prompt data found in ComfyUI metadata');
      return result;
    }

    // UNIFY NODE HANDLING: Check for API-style workflow ('nodes' array) vs. prompt-style (direct map)
    let nodeMap: { [key: string]: any } = {};
    const isApiFormat = Array.isArray(dataSource.nodes);

    if (isApiFormat) {
      console.log('🔍 Detected ComfyUI API/Workflow format');
      for (const node of dataSource.nodes) {
        // The API format uses numeric IDs, but we'll use strings for consistency
        nodeMap[String(node.id)] = node;
      }
    } else {
      console.log('🔍 Detected ComfyUI Prompt format');
      nodeMap = dataSource; // It's already a map
    }

    console.log('🔍 Processing ComfyUI data source with', Object.keys(nodeMap).length, 'nodes');

    // Log all node types found for debugging
    const nodeTypes = new Set<string>();
    const allNodes = [];
    for (const [nodeId, nodeData] of Object.entries(nodeMap)) {
      const node = nodeData as any;
      const classType = node.class_type || node.type || '';
      if (classType) nodeTypes.add(classType);
      allNodes.push({ id: nodeId, type: classType, inputs: Object.keys(node.inputs || {}) });
    }
    console.log('🔍 Found node types in workflow:', Array.from(nodeTypes));
    console.log('🔍 All nodes summary:', allNodes);

    // Extract data from nodes - handle both workflow format (with class_type) and prompt format
    for (const [nodeId, nodeData] of Object.entries(nodeMap)) {
      const node = nodeData as any;

      if (!node || typeof node !== 'object') continue;

      const classType = node.class_type || node.type || '';
      const inputs = node.inputs || {};

      console.log(`🔍 Processing node ${nodeId}: ${classType} with inputs:`, Object.keys(inputs));

      // Check if this node matches sampler criteria
      const isSamplerNode = classType.toLowerCase().includes('sampler') ||
          classType === 'KSampler' ||
          classType === 'SamplerCustom' ||
          classType === 'Sampler' ||
          classType === 'SamplerEuler' ||
          classType === 'SamplerEulerAncestral' ||
          classType === 'SamplerDPMPP2M' ||
          classType === 'SamplerDPMPP2MKarras' ||
          classType === 'SamplerDPMAdaptive' ||
          classType === 'SamplerLMS' ||
          classType === 'SamplerHeun' ||
          classType === 'SamplerDPM2' ||
          classType === 'SamplerDPM2Ancestral' ||
          classType === 'SamplerUniPC' ||
          classType === 'SamplerTCD' ||
          classType === 'SamplerLCM' ||
          classType.toLowerCase().includes('ksampler') ||
          classType.toLowerCase().includes('sample');

      if (isSamplerNode) {
        console.log(`🎯 FOUND SAMPLER NODE: ${nodeId} (${classType})`);
      }

      // Extract model from various checkpoint loader nodes
      if (classType.toLowerCase().includes('checkpoint') ||
          classType.toLowerCase().includes('model') ||
          classType === 'CheckpointLoaderSimple' ||
          classType === 'CheckpointLoader') {
        // Try different possible input names for checkpoint
        const ckptName = inputs.ckpt_name || inputs.checkpoint || inputs.model_name;
        if (ckptName && typeof ckptName === 'string') {
          result.models.push(ckptName);
          console.log(`✅ Found model: ${ckptName}`);
        }
      }

      // Extract LoRAs from various LoRA loader nodes
      if (classType.toLowerCase().includes('lora') ||
          classType === 'LoraLoader' ||
          classType === 'LoraLoaderModelOnly' ||
          classType === 'LoraLoaderModel') {
        const loraName = inputs.lora_name || inputs.lora || inputs.name;
        if (loraName && typeof loraName === 'string') {
          result.loras.push(loraName);
          console.log(`✅ Found LoRA: ${loraName}`);
        }
      }

      // Extract prompts from CLIP text encode nodes
      if (classType.toLowerCase().includes('clip') &&
          classType.toLowerCase().includes('text') &&
          (classType.toLowerCase().includes('encode') || classType === 'CLIPTextEncode' || classType === 'CLIPTextEncodeSDXL')) {
        const text = inputs.text || inputs.prompt || inputs.string;
        if (text && typeof text === 'string') {
          const isPositive = determinePromptType(nodeId, dataSource, classType);
          if (isPositive && !result.prompt) {
            result.prompt = text;
            console.log(`✅ Found positive prompt: ${text.substring(0, 50)}...`);
          } else if (!isPositive && !result.negativePrompt) {
            result.negativePrompt = text;
            console.log(`✅ Found negative prompt: ${text.substring(0, 50)}...`);
          }
        }
      }

      // Extract sampler parameters from various sampler nodes
      if (classType.toLowerCase().includes('sampler') ||
          classType === 'KSampler' ||
          classType === 'SamplerCustom' ||
          classType === 'Sampler' ||
          classType === 'SamplerEuler' ||
          classType === 'SamplerEulerAncestral' ||
          classType === 'SamplerDPMPP2M' ||
          classType === 'SamplerDPMPP2MKarras' ||
          classType === 'SamplerDPMAdaptive' ||
          classType === 'SamplerLMS' ||
          classType === 'SamplerHeun' ||
          classType === 'SamplerDPM2' ||
          classType === 'SamplerDPM2Ancestral' ||
          classType === 'SamplerUniPC' ||
          classType === 'SamplerTCD' ||
          classType === 'SamplerLCM' ||
          classType.toLowerCase().includes('ksampler') ||
          classType.toLowerCase().includes('sample')) {
        console.log(`🎯 FOUND SAMPLER NODE: ${nodeId} (${classType})`);
        // Try different input names
        const steps = inputs.steps || inputs.step_count || inputs.num_steps || inputs.steps_count;
        const cfg = inputs.cfg || inputs.cfg_scale || inputs.guidance_scale || inputs.scale || inputs.guidance || inputs.cfg_value;
        const seed = inputs.seed || inputs.noise_seed || inputs.seed_value;
        const samplerName = inputs.sampler_name || inputs.sampler || inputs.sampling_method || inputs.method;

        console.log(`🔍 Found sampler node ${nodeId} (${classType}) with inputs:`, inputs);

        // Check if inputs are strings that need parsing
        if (typeof steps === 'string') {
          const parsedSteps = parseInt(steps, 10);
          if (!isNaN(parsedSteps) && parsedSteps > 0) {
            result.steps = parsedSteps;
            console.log(`✅ Found steps (from string): ${parsedSteps}`);
          }
        } else if (typeof steps === 'number' && steps > 0) {
          result.steps = steps;
          console.log(`✅ Found steps: ${steps}`);
        } else {
          console.log(`❌ Steps not found or invalid: ${steps} (type: ${typeof steps})`);
        }

        if (typeof cfg === 'string') {
          const parsedCfg = parseFloat(cfg);
          if (!isNaN(parsedCfg) && parsedCfg > 0) {
            result.cfgScale = parsedCfg;
            console.log(`✅ Found CFG scale (from string): ${parsedCfg}`);
          }
        } else if (typeof cfg === 'number' && cfg > 0) {
          result.cfgScale = cfg;
          console.log(`✅ Found CFG scale: ${cfg}`);
        } else {
          console.log(`❌ CFG scale not found or invalid: ${cfg} (type: ${typeof cfg})`);
        }

        if (seed !== undefined && seed !== null) {
          let seedValue: number;
          if (Array.isArray(seed)) {
            // Handle seed references like ["46", 0] - these point to other nodes
            console.log(`🎯 Seed is array reference: ${JSON.stringify(seed)} - skipping for now`);
            // For now, skip array references - we'll look for actual seed values elsewhere
          } else if (typeof seed === 'string') {
            seedValue = parseInt(seed, 10);
            if (!isNaN(seedValue) && seedValue >= 0) {
              result.seed = seedValue;
              console.log(`✅ Found seed (from string): ${result.seed}`);
            }
          } else if (typeof seed === 'number') {
            if (seed >= 0) {
              result.seed = seed;
              console.log(`✅ Found seed: ${result.seed}`);
            }
          } else {
            console.log(`❌ Seed invalid type: ${typeof seed} = ${seed}`);
          }
        } else {
          console.log(`❌ Seed not found in inputs`);
        }
        if (samplerName && typeof samplerName === 'string') {
          result.scheduler = samplerName;
          console.log(`✅ Found sampler: ${samplerName}`);
        } else if (inputs.scheduler && typeof inputs.scheduler === 'string') {
          result.scheduler = inputs.scheduler;
          console.log(`✅ Found scheduler: ${inputs.scheduler}`);
        } else {
          console.log(`❌ Sampler name not found`);
        }
      }

      // Look for seed values in any node (including Seed Everywhere nodes)
      if (classType.toLowerCase().includes('seed') || classType === 'Seed Everywhere' || classType === 'Random Seed') {
        console.log(`🎯 FOUND SEED NODE: ${nodeId} (${classType})`);
        console.log(`🎯 SEED NODE INPUTS:`, JSON.stringify(inputs, null, 2));

        // Look for seed values in inputs
        for (const [key, value] of Object.entries(inputs)) {
          if (key.toLowerCase().includes('seed') && typeof value === 'number' && value > 0 && !result.seed) {
            result.seed = value;
            console.log(`✅ Found seed in ${key}: ${value}`);
            break;
          }
        }
      }
      if (classType.toLowerCase().includes('latent') ||
          classType === 'EmptyLatentImage' ||
          classType === 'LatentFromPrompt' ||
          classType === 'EmptyImage' ||
          classType === 'ImageSize' ||
          classType === 'LatentUpscale' ||
          classType === 'LatentDownscale' ||
          classType.toLowerCase().includes('image') ||
          classType.toLowerCase().includes('size') ||
          classType.toLowerCase().includes('dimension')) {
        const width = inputs.width || inputs.image_width || inputs.size_width || inputs.w || inputs.x;
        const height = inputs.height || inputs.image_height || inputs.size_height || inputs.h || inputs.y;

        console.log(`🔍 Found dimension node ${nodeId} (${classType}) with inputs:`, inputs);

        if (typeof width === 'number' && width > 0) {
          result.width = width;
          console.log(`✅ Found width: ${width}`);
        }
        if (typeof height === 'number' && height > 0) {
          result.height = height;
          console.log(`✅ Found height: ${height}`);
        }
      }
    }

    // Fallback: if no prompts found, look for any text inputs
    if (!result.prompt && !result.negativePrompt) {
      console.log('🔍 No prompts found through node analysis, trying fallback extraction');
      for (const [nodeId, nodeData] of Object.entries(dataSource)) {
        const node = nodeData as any;
        const inputs = node.inputs || {};
        if (inputs.text && typeof inputs.text === 'string') {
          const text = inputs.text.toLowerCase();
          // Simple heuristic for negative prompts
          if (text.includes('blur') || text.includes('deform') || text.includes('ugly') ||
              text.includes('worst') || text.includes('low quality') || text.includes('bad')) {
            if (!result.negativePrompt) {
              result.negativePrompt = inputs.text;
              console.log(`✅ Fallback negative prompt: ${inputs.text.substring(0, 50)}...`);
            }
          } else {
            if (!result.prompt) {
              result.prompt = inputs.text;
              console.log(`✅ Fallback positive prompt: ${inputs.text.substring(0, 50)}...`);
            }
          }
        }
      }
    }

    // Additional fallback: look for numeric parameters in any node that might contain generation settings
    if ((result.steps === 0 || result.cfgScale === 0) && !result.seed) {
      console.log('🔍 Looking for numeric parameters in any node');
      for (const [nodeId, nodeData] of Object.entries(dataSource)) {
        const node = nodeData as any;
        const inputs = node.inputs || {};
        const classType = node.class_type || node.type || '';

        // Look for common parameter names in any node
        const possibleSteps = inputs.steps || inputs.step_count || inputs.num_steps || inputs.steps_count || inputs.step || inputs.n_steps;
        const possibleCfg = inputs.cfg || inputs.cfg_scale || inputs.guidance_scale || inputs.scale || inputs.guidance || inputs.cfg_value || inputs.strength;
        const possibleSeed = inputs.seed || inputs.noise_seed || inputs.seed_value || inputs.random_seed;

        console.log(`🔍 Checking node ${nodeId} (${classType}) for parameters: steps=${possibleSteps}, cfg=${possibleCfg}, seed=${possibleSeed}`);

        if (typeof possibleSteps === 'string') {
          const parsed = parseInt(possibleSteps, 10);
          if (!isNaN(parsed) && parsed > 0 && parsed < 200 && result.steps === 0) {
            result.steps = parsed;
            console.log(`✅ Found steps in node ${nodeId} (${classType}): ${parsed}`);
          }
        } else if (typeof possibleSteps === 'number' && possibleSteps > 0 && possibleSteps < 200 && result.steps === 0) {
          result.steps = possibleSteps;
          console.log(`✅ Found steps in node ${nodeId} (${classType}): ${possibleSteps}`);
        }

        if (typeof possibleCfg === 'string') {
          const parsed = parseFloat(possibleCfg);
          if (!isNaN(parsed) && parsed > 0 && parsed < 50 && result.cfgScale === 0) {
            result.cfgScale = parsed;
            console.log(`✅ Found CFG scale in node ${nodeId} (${classType}): ${parsed}`);
          }
        } else if (typeof possibleCfg === 'number' && possibleCfg > 0 && possibleCfg < 50 && result.cfgScale === 0) {
          result.cfgScale = possibleCfg;
          console.log(`✅ Found CFG scale in node ${nodeId} (${classType}): ${possibleCfg}`);
        }

        if (possibleSeed !== undefined && possibleSeed !== null && result.seed === undefined) {
          let seedValue: number;
          if (typeof possibleSeed === 'string') {
            seedValue = parseInt(possibleSeed, 10);
          } else {
            seedValue = possibleSeed;
          }
          if (!isNaN(seedValue) && seedValue >= 0) {
            result.seed = seedValue;
            console.log(`✅ Found seed in node ${nodeId} (${classType}): ${result.seed}`);
          }
        }
      }
    }

    // Final comprehensive search: look for any node with generation parameters
    console.log('🔍 FINAL COMPREHENSIVE SEARCH: Looking for any node with generation parameters');
    for (const [nodeId, nodeData] of Object.entries(dataSource)) {
      const node = nodeData as any;
      const inputs = node.inputs || {};
      const classType = node.class_type || node.type || '';

      // Look for any input that could be steps, cfg, or seed
      for (const [inputKey, inputValue] of Object.entries(inputs)) {
        const key = inputKey.toLowerCase();
        const value = inputValue;

        console.log(`🔍 Checking input ${inputKey}=${value} (type: ${typeof value}) in node ${nodeId} (${classType})`);

        // Check for steps
        if ((key.includes('step') || key === 'steps' || key === 'n_steps') && result.steps === 0) {
          if (typeof value === 'number' && value > 0 && value < 200) {
            result.steps = value;
            console.log(`✅ FOUND STEPS in ${inputKey}: ${value}`);
          } else if (typeof value === 'string') {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0 && parsed < 200) {
              result.steps = parsed;
              console.log(`✅ FOUND STEPS in ${inputKey} (string): ${parsed}`);
            }
          }
        }

        // Check for CFG
        if ((key.includes('cfg') || key.includes('guidance') || key === 'scale' || key === 'strength') && result.cfgScale === 0) {
          if (typeof value === 'number' && value > 0 && value < 50) {
            result.cfgScale = value;
            console.log(`✅ FOUND CFG in ${inputKey}: ${value}`);
          } else if (typeof value === 'string') {
            const parsed = parseFloat(value);
            if (!isNaN(parsed) && parsed > 0 && parsed < 50) {
              result.cfgScale = parsed;
              console.log(`✅ FOUND CFG in ${inputKey} (string): ${parsed}`);
            }
          }
        }

        // Check for seed
        if ((key.includes('seed') || key === 'noise_seed') && result.seed === undefined) {
          if (typeof value === 'number' && value >= 0) {
            result.seed = value;
            console.log(`✅ FOUND SEED in ${inputKey}: ${value}`);
          } else if (typeof value === 'string') {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed >= 0) {
              result.seed = parsed;
              console.log(`✅ FOUND SEED in ${inputKey} (string): ${parsed}`);
            }
          }
        }
      }
    }

    // Set primary model if found
    if (result.models.length > 0) {
      result.model = result.models[0];
    }

    console.log('✅ ComfyUI metadata parsing complete:', {
      prompt: result.prompt ? result.prompt.substring(0, 30) + '...' : '',
      negativePrompt: result.negativePrompt ? result.negativePrompt.substring(0, 30) + '...' : '',
      model: result.model,
      models: result.models,
      loras: result.loras,
      steps: result.steps,
      cfgScale: result.cfgScale,
      seed: result.seed,
      scheduler: result.scheduler,
      width: result.width,
      height: result.height,
      dimensions: result.width && result.height ? `${result.width}x${result.height}` : 'unknown'
    });

  } catch (error) {
    console.error('❌ Failed to parse ComfyUI metadata:', error);
  }

  return result;
}

// Helper function to determine if a text node is for positive or negative prompt
function determinePromptType(nodeId: string, workflow: any, classType: string): boolean {
  try {
    const isApiFormat = Array.isArray(workflow.links) && Array.isArray(workflow.nodes);

    if (isApiFormat) {
      // API/Workflow format: Use the 'links' array to find connections
      for (const link of workflow.links) {
        const sourceNodeId = String(link[1]);
        if (sourceNodeId === nodeId) {
          const targetNodeId = link[3];
          const connectedNode = workflow.nodes.find((n: any) => n.id === targetNodeId);
          if (connectedNode) {
            const connectedNodeClass = connectedNode.type || '';
            if (connectedNodeClass.toLowerCase().includes('conditioning') || connectedNodeClass.toLowerCase().includes('positive')) {
              return true; // Positive prompt
            }
            if (connectedNodeClass.toLowerCase().includes('negative')) {
              return false; // Negative prompt
            }
          }
        }
      }
    } else {
      // Prompt format: Use the existing logic of checking input references
      for (const otherNodeData of Object.values(workflow)) {
        const otherNode = otherNodeData as any;
        if (!otherNode || !otherNode.inputs) continue;

        for (const inputValue of Object.values(otherNode.inputs)) {
          if (Array.isArray(inputValue) && String(inputValue[0]) === nodeId) {
            const connectedNodeClass = otherNode.class_type || '';
            if (connectedNodeClass.toLowerCase().includes('conditioning') || connectedNodeClass.toLowerCase().includes('positive')) {
              return true;
            }
            if (connectedNodeClass.toLowerCase().includes('negative')) {
              return false;
            }
          }
        }
      }
    }

    // Fallback: check the node's own class type for hints
    if (classType.toLowerCase().includes('positive')) return true;
    if (classType.toLowerCase().includes('negative')) return false;

  } catch (error) {
    console.warn('Failed to determine prompt type:', error);
  }
  return true; // Default to positive if we can't determine
}

// Function to parse Automatic1111 parameters string and extract normalized metadata
function parseA1111Metadata(parameters: string): BaseMetadata {
  const result: BaseMetadata = {
    prompt: '',
    model: '',
    width: 0,
    height: 0,
    steps: 0,
    scheduler: '',
    // Additional normalized fields
    negativePrompt: '',
    cfgScale: 0,
    seed: undefined,
  };

  try {
    // Extract prompt (everything before "Negative prompt:")
    const negativePromptIndex = parameters.indexOf('\nNegative prompt:');
    if (negativePromptIndex !== -1) {
      result.prompt = parameters.substring(0, negativePromptIndex).trim();
    } else {
      // If no negative prompt, take everything before the first parameter line
      const firstParamIndex = parameters.search(/\n[A-Z][a-z]+:/);
      if (firstParamIndex !== -1) {
        result.prompt = parameters.substring(0, firstParamIndex).trim();
      } else {
        result.prompt = parameters.trim();
      }
    }

    // Extract negative prompt
    if (negativePromptIndex !== -1) {
      const negativePromptEndIndex = parameters.indexOf('\n', negativePromptIndex + 1);
      if (negativePromptEndIndex !== -1) {
        result.negativePrompt = parameters.substring(negativePromptIndex + 17, negativePromptEndIndex).trim();
      } else {
        result.negativePrompt = parameters.substring(negativePromptIndex + 17).trim();
      }
    }

    // Extract model
    const modelMatch = parameters.match(/Model:\s*([^,\n]+)/i);
    if (modelMatch) {
      result.model = modelMatch[1].trim();
    }

    // Extract steps
    const stepsMatch = parameters.match(/Steps:\s*(\d+)/i);
    if (stepsMatch) {
      const steps = parseInt(stepsMatch[1], 10);
      if (!isNaN(steps)) {
        result.steps = steps;
      }
    }

    // Extract sampler/scheduler
    const samplerMatch = parameters.match(/Sampler:\s*([^,\n]+)/i);
    if (samplerMatch) {
      result.scheduler = samplerMatch[1].trim();
    }

    // Extract CFG scale
    const cfgMatch = parameters.match(/CFG scale:\s*([0-9.]+)/i);
    if (cfgMatch) {
      const cfgScale = parseFloat(cfgMatch[1]);
      if (!isNaN(cfgScale)) {
        result.cfgScale = cfgScale;
      }
    }

    // Extract seed
    const seedMatch = parameters.match(/Seed:\s*([0-9]+)/i);
    if (seedMatch) {
      const seed = parseInt(seedMatch[1], 10);
      if (!isNaN(seed)) {
        result.seed = seed;
      }
    }

    // Extract size (width x height)
    const sizeMatch = parameters.match(/Size:\s*(\d+)\s*x\s*(\d+)/i);
    if (sizeMatch) {
      const width = parseInt(sizeMatch[1], 10);
      const height = parseInt(sizeMatch[2], 10);
      if (!isNaN(width) && !isNaN(height)) {
        result.width = width;
        result.height = height;
      }
    }

  } catch (error) {
    console.warn('Failed to parse Automatic1111 parameters:', error);
  }

  return result;
}

// Function to extract CFG scale from metadata
function extractCfgScale(metadata: ImageMetadata): number | undefined {
  // First check if normalized metadata is available (faster path)
  if ('normalizedMetadata' in metadata && metadata.normalizedMetadata) {
    const normalized = metadata.normalizedMetadata;
    if (normalized.cfgScale !== undefined && typeof normalized.cfgScale === 'number') {
      console.log('🔍 Using normalized metadata for CFG scale extraction');
      return normalized.cfgScale;
    }
  }

  // DEBUG: Test parseA1111Metadata isoladamente
  const testParameters = "Steps: 14, Sampler: DPM2_beta, CFG scale: 3.5, Seed: 816785282215760";
  const testResult = parseA1111Metadata(testParameters);
  console.log('DEBUG parseA1111 test:', testResult);

  // DEBUG: Verificar se metadata.parameters existe
  console.log('DEBUG metadata.parameters:', metadata.parameters);
  console.log('DEBUG typeof metadata.parameters:', typeof metadata.parameters);

  // NOVO: Se tem parameters (ComfyUI com A1111 embarcado), parse com A1111
  if (metadata.parameters && typeof metadata.parameters === 'string') {
    const a1111Data = parseA1111Metadata(metadata.parameters);
    console.log('DEBUG a1111Data:', a1111Data);
    console.log('DEBUG a1111Data.cfgScale:', a1111Data.cfgScale);
    if (a1111Data.cfgScale) return a1111Data.cfgScale;
  }

  // Fallback to format-specific extraction
  // Handle InvokeAI metadata
  if (isInvokeAIMetadata(metadata)) {
    return metadata.cfg_scale;
  }

  // Handle Automatic1111 metadata
  if (isAutomatic1111Metadata(metadata)) {
    // Extract CFG scale from parameters string using regex
    const params = metadata.parameters;
    const cfgMatch = params.match(/CFG scale:\s*([0-9.]+)/i);
    if (cfgMatch) {
      const cfgScale = parseFloat(cfgMatch[1]);
      return isNaN(cfgScale) ? undefined : cfgScale;
    }
  }

  // Handle ComfyUI metadata
  if (isComfyUIMetadata(metadata)) {
    try {
      let workflow: any = metadata.workflow;
      if (typeof workflow === 'string') {
        workflow = JSON.parse(workflow);
      }

      if (workflow) {
        // Look for KSampler nodes which contain CFG scale
        for (const [nodeId, nodeData] of Object.entries(workflow)) {
          const node = nodeData as any;
          if (node.class_type === 'KSampler' && node.inputs && node.inputs.cfg) {
            const cfg = parseFloat(node.inputs.cfg);
            if (!isNaN(cfg)) {
              return cfg;
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to extract CFG scale from ComfyUI metadata:', error);
    }
  }

  // SPECIAL CASE: If we have normalizedMetadata but couldn't detect format,
  // it might be a cached ComfyUI image. Try to extract from normalizedMetadata directly
  if (metadata && typeof metadata === 'object' && 'normalizedMetadata' in metadata && (metadata as any).normalizedMetadata) {
    const normalized = (metadata as any).normalizedMetadata;
    console.log('🔍 No format detected but have normalizedMetadata - trying ComfyUI extraction for cfgScale');
    if (normalized.cfgScale !== undefined && typeof normalized.cfgScale === 'number') {
      return normalized.cfgScale;
    }
  }

  return undefined;
}

// Function to extract steps from metadata
function extractSteps(metadata: ImageMetadata): number | undefined {
  // First check if normalized metadata is available (faster path)
  if ('normalizedMetadata' in metadata && metadata.normalizedMetadata) {
    const normalized = metadata.normalizedMetadata;
    if (normalized.steps !== undefined && typeof normalized.steps === 'number') {
      console.log('🔍 Using normalized metadata for steps extraction');
      return normalized.steps;
    }
  }

  // SPECIAL CASE: If we have normalizedMetadata but couldn't detect format,
  // it might be a cached ComfyUI image. Try to extract from normalizedMetadata directly
  if (metadata && typeof metadata === 'object' && 'normalizedMetadata' in metadata && (metadata as any).normalizedMetadata) {
    const normalized = (metadata as any).normalizedMetadata;
    console.log('🔍 No format detected but have normalizedMetadata - trying ComfyUI extraction for steps');
    if (normalized.steps !== undefined && typeof normalized.steps === 'number') {
      return normalized.steps;
    }
  }

  // NOVO: Se tem parameters (ComfyUI com A1111 embarcado), parse com A1111
  if (metadata.parameters && typeof metadata.parameters === 'string') {
    const a1111Data = parseA1111Metadata(metadata.parameters);
    if (a1111Data.steps) return a1111Data.steps;
  }

  // Fallback to format-specific extraction
  // Handle InvokeAI metadata
  if (isInvokeAIMetadata(metadata)) {
    return metadata.steps;
  }

  // Handle Automatic1111 metadata
  if (isAutomatic1111Metadata(metadata)) {
    // Extract steps from parameters string using regex
    const params = metadata.parameters;
    const stepsMatch = params.match(/Steps:\s*([0-9]+)/i);
    if (stepsMatch) {
      const steps = parseInt(stepsMatch[1], 10);
      return isNaN(steps) ? undefined : steps;
    }
  }

  // Handle ComfyUI metadata
  if (isComfyUIMetadata(metadata)) {
    try {
      let workflow: any = metadata.workflow;
      if (typeof workflow === 'string') {
        workflow = JSON.parse(workflow);
      }

      if (workflow) {
        // Look for KSampler nodes which contain steps
        for (const [nodeId, nodeData] of Object.entries(workflow)) {
          const node = nodeData as any;
          if (node.class_type === 'KSampler' && node.inputs && node.inputs.steps) {
            const steps = parseInt(node.inputs.steps, 10);
            if (!isNaN(steps)) {
              return steps;
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to extract steps from ComfyUI metadata:', error);
    }
  }

  return undefined;
}

// Function to extract seed from metadata
function extractSeed(metadata: ImageMetadata): number | undefined {
  // First check if normalized metadata is available (faster path)
  if ('normalizedMetadata' in metadata && metadata.normalizedMetadata) {
    const normalized = metadata.normalizedMetadata;
    if (normalized.seed !== undefined && typeof normalized.seed === 'number') {
      console.log('🔍 Using normalized metadata for seed extraction');
      return normalized.seed;
    }
  }

  // NOVO: Se tem parameters (ComfyUI com A1111 embarcado), parse com A1111
  if (metadata.parameters && typeof metadata.parameters === 'string') {
    const a1111Data = parseA1111Metadata(metadata.parameters);
    if (a1111Data.seed) return a1111Data.seed;
  }

  // Fallback to format-specific extraction
  // Handle InvokeAI metadata
  if (isInvokeAIMetadata(metadata)) {
    return metadata.seed;
  }

  // Handle Automatic1111 metadata
  if (isAutomatic1111Metadata(metadata)) {
    // Extract seed from parameters string using regex
    const params = metadata.parameters;
    const seedMatch = params.match(/Seed:\s*([0-9]+)/i);
    if (seedMatch) {
      const seed = parseInt(seedMatch[1], 10);
      return isNaN(seed) ? undefined : seed;
    }
  }

  // Handle ComfyUI metadata
  if (isComfyUIMetadata(metadata)) {
    try {
      let workflow: any = metadata.workflow;
      if (typeof workflow === 'string') {
        workflow = JSON.parse(workflow);
      }

      if (workflow) {
        // Look for KSampler nodes which contain seed
        for (const [nodeId, nodeData] of Object.entries(workflow)) {
          const node = nodeData as any;
          if (node.class_type === 'KSampler' && node.inputs && node.inputs.seed) {
            const seed = parseInt(node.inputs.seed, 10);
            if (!isNaN(seed)) {
              return seed;
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to extract seed from ComfyUI metadata:', error);
    }
  }

  // SPECIAL CASE: If we have normalizedMetadata but couldn't detect format,
  // it might be a cached ComfyUI image. Try to extract from normalizedMetadata directly
  if (metadata && typeof metadata === 'object' && 'normalizedMetadata' in metadata && (metadata as any).normalizedMetadata) {
    const normalized = (metadata as any).normalizedMetadata;
    console.log('🔍 No format detected but have normalizedMetadata - trying ComfyUI extraction for seed');
    if (normalized.seed !== undefined && typeof normalized.seed === 'number') {
      return normalized.seed;
    }
  }

  return undefined;
}

// Function to extract dimensions from metadata
function extractDimensions(metadata: ImageMetadata): string | undefined {
  // First check if normalized metadata is available (faster path)
  if ('normalizedMetadata' in metadata && metadata.normalizedMetadata) {
    const normalized = metadata.normalizedMetadata;
    if (normalized.width && normalized.height) {
      console.log('🔍 Using normalized metadata for dimensions extraction');
      return `${normalized.width}x${normalized.height}`;
    }
  }

  // NOVO: Se tem parameters (ComfyUI com A1111 embarcado), parse com A1111
  if (metadata.parameters && typeof metadata.parameters === 'string') {
    const a1111Data = parseA1111Metadata(metadata.parameters);
    if (a1111Data.width && a1111Data.height) {
      return `${a1111Data.width}x${a1111Data.height}`;
    }
  }

  // Fallback to format-specific extraction
  // Handle InvokeAI metadata
  if (isInvokeAIMetadata(metadata)) {
    if (metadata.width && metadata.height) {
      return `${metadata.width}x${metadata.height}`;
    }
  }

  // Handle Automatic1111 metadata
  if (isAutomatic1111Metadata(metadata)) {
    // Extract dimensions from parameters string using regex
    const params = metadata.parameters;
    const sizeMatch = params.match(/Size:\s*([0-9]+x[0-9]+)/i);
    if (sizeMatch) {
      return sizeMatch[1];
    }
  }

  // Handle ComfyUI metadata
  if (isComfyUIMetadata(metadata)) {
    try {
      let workflow: any = metadata.workflow;
      if (typeof workflow === 'string') {
        workflow = JSON.parse(workflow);
      }

      if (workflow) {
        // Look for EmptyLatentImage nodes which contain dimensions
        for (const [nodeId, nodeData] of Object.entries(workflow)) {
          const node = nodeData as any;
          if (node.class_type === 'EmptyLatentImage' && node.inputs) {
            const width = node.inputs.width;
            const height = node.inputs.height;
            if (width && height) {
              return `${width}x${height}`;
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to extract dimensions from ComfyUI metadata:', error);
    }
  }

  return undefined;
}

// Export utility functions for use in other modules
export { extractPrompt, extractModels, extractLoras, extractScheduler, extractBoard, extractCfgScale, extractSteps, extractSeed, extractDimensions, extractNegativePrompt, parseImageMetadata, parseComfyUIMetadata, parseA1111Metadata };

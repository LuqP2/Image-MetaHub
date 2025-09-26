/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { type IndexedImage, type ImageMetadata, type InvokeAIMetadata, type Automatic1111Metadata, type ComfyUIMetadata, type BaseMetadata, isInvokeAIMetadata, isAutomatic1111Metadata, isComfyUIMetadata } from '../types';

// Function to extract models from metadata
function extractModels(metadata: ImageMetadata): string[] {
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

  console.log('❌ Unknown metadata format for models');
  return models;
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

  return loras;
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

  return 'Unknown';
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

  return '';
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

async function parseImageMetadata(file: File): Promise<ImageMetadata | null> {
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);

    // Check PNG signature
    if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
      return null; // Not a PNG file
    }

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

        // Collect relevant metadata chunks
        if (['invokeai_metadata', 'parameters', 'workflow', 'prompt'].includes(keyword) && text) {
          chunks[keyword] = text;
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
  // Use type assertion to work around incomplete TypeScript definitions
  const dirHandle = directoryHandle as any;
  for await (const entry of dirHandle.values()) {
    const newPath = path ? `${path}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      entries.push({handle: entry, path: newPath});
    } else if (entry.kind === 'directory') {
      // Fix: Explicitly cast entry to FileSystemDirectoryHandle as TypeScript fails to narrow the type.
      entries.push(...(await getFileHandlesRecursive(entry as FileSystemDirectoryHandle, newPath)));
    }
  }
  return entries;
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
  const allFileEntries = specificFiles || await getFileHandlesRecursive(directoryHandle);
  const pngFiles = allFileEntries.filter(entry => 
    entry.handle.name.toLowerCase().endsWith('.png') && 
    !isIntermediateImage(entry.handle.name)
  );

  // Try to find thumbnails directory
  let thumbnailsDir: FileSystemDirectoryHandle | null = null;
  try {
    thumbnailsDir = await directoryHandle.getDirectoryHandle('thumbnails');
    // console.log removed
  } catch (error) {
    // console.log removed
  }

  // Get thumbnail files if directory exists
  const thumbnailMap = new Map<string, FileSystemFileHandle>();
  if (thumbnailsDir) {
    const thumbnailEntries = await getFileHandlesRecursive(thumbnailsDir);
    const webpFiles = thumbnailEntries.filter(entry => entry.handle.name.toLowerCase().endsWith('.webp'));
    
    for (const thumbEntry of webpFiles) {
      // Map thumbnail name to PNG name (remove .webp, add .png)
      const pngName = thumbEntry.handle.name.replace(/\.webp$/i, '.png');
      thumbnailMap.set(pngName, thumbEntry.handle);
    }
    // console.log removed
  }

  const total = pngFiles.length;
  setProgress({ current: 0, total });

  const indexedImages: IndexedImage[] = [];
  let processedCount = 0;

  for (const fileEntry of pngFiles) {
    try {
      const file = await fileEntry.handle.getFile();
      const metadata = await parseImageMetadata(file);
      if (metadata) {
        const metadataString = JSON.stringify(metadata);
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
  
  return indexedImages;
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

    // Parse workflow if it's a string
    if (typeof workflow === 'string') {
      try {
        workflow = JSON.parse(workflow);
      } catch (error) {
        console.warn('Failed to parse ComfyUI workflow string:', error);
        return result;
      }
    }

    // Parse prompt if it's a string
    if (typeof prompt === 'string') {
      try {
        prompt = JSON.parse(prompt);
      } catch (error) {
        console.warn('Failed to parse ComfyUI prompt string:', error);
        return result;
      }
    }

    // If we have both workflow and prompt, use workflow as primary source
    const dataSource = workflow || prompt;
    if (!dataSource) {
      return result;
    }

    // Extract data from nodes
    for (const [nodeId, nodeData] of Object.entries(dataSource)) {
      const node = nodeData as any;

      if (!node || typeof node !== 'object') continue;

      const classType = node.class_type || '';

      // Extract model from CheckpointLoaderSimple or similar
      if (classType.toLowerCase().includes('checkpoint') && classType.toLowerCase().includes('loader')) {
        if (node.inputs && node.inputs.ckpt_name && typeof node.inputs.ckpt_name === 'string') {
          result.models.push(node.inputs.ckpt_name);
        }
      }

      // Extract LoRAs from LoraLoader nodes
      if (classType.toLowerCase().includes('lora') && classType.toLowerCase().includes('loader')) {
        if (node.inputs && node.inputs.lora_name && typeof node.inputs.lora_name === 'string') {
          result.loras.push(node.inputs.lora_name);
        }
      }

      // Extract prompt from CLIPTextEncode or similar text input nodes
      if (classType.toLowerCase().includes('clip') && classType.toLowerCase().includes('text') && classType.toLowerCase().includes('encode')) {
        if (node.inputs && node.inputs.text && typeof node.inputs.text === 'string') {
          // Check if this is connected to positive conditioning
          const isPositive = checkIfPositivePrompt(nodeId, dataSource);
          if (isPositive) {
            result.prompt = node.inputs.text;
          } else {
            result.negativePrompt = node.inputs.text;
          }
        }
      }

      // Extract sampler parameters from KSampler or similar
      if (classType.toLowerCase().includes('ksampler') || classType.toLowerCase().includes('sampler')) {
        if (node.inputs) {
          if (typeof node.inputs.steps === 'number') {
            result.steps = node.inputs.steps;
          }
          if (typeof node.inputs.cfg === 'number') {
            result.cfgScale = node.inputs.cfg;
          }
          if (typeof node.inputs.seed === 'number' || typeof node.inputs.seed === 'string') {
            const seedValue = typeof node.inputs.seed === 'string' ? parseInt(node.inputs.seed, 10) : node.inputs.seed;
            if (!isNaN(seedValue)) {
              result.seed = seedValue;
            }
          }
          if (node.inputs.sampler_name && typeof node.inputs.sampler_name === 'string') {
            result.scheduler = node.inputs.sampler_name;
          }
          if (node.inputs.scheduler && typeof node.inputs.scheduler === 'string') {
            result.scheduler = node.inputs.scheduler;
          }
        }
      }

      // Extract dimensions from EmptyLatentImage or similar
      if (classType.toLowerCase().includes('empty') && classType.toLowerCase().includes('latent')) {
        if (node.inputs) {
          if (typeof node.inputs.width === 'number') {
            result.width = node.inputs.width;
          }
          if (typeof node.inputs.height === 'number') {
            result.height = node.inputs.height;
          }
        }
      }
    }

    // Fallback: if no prompt found through nodes, try to extract from any text input
    if (!result.prompt) {
      for (const [nodeId, nodeData] of Object.entries(dataSource)) {
        const node = nodeData as any;
        if (node.inputs && node.inputs.text && typeof node.inputs.text === 'string') {
          // Simple heuristic: if text contains common negative words, it's negative
          const text = node.inputs.text.toLowerCase();
          if (text.includes('blur') || text.includes('deform') || text.includes('ugly') || text.includes('worst')) {
            result.negativePrompt = node.inputs.text;
          } else {
            result.prompt = node.inputs.text;
          }
          break; // Take the first text input we find
        }
      }
    }

  } catch (error) {
    console.warn('Failed to parse ComfyUI metadata:', error);
  }

  return result;
}

// Helper function to determine if a text node is for positive or negative prompt
function checkIfPositivePrompt(nodeId: string, workflow: any): boolean {
  try {
    // Look for connections from this node to conditioning nodes
    for (const [otherNodeId, otherNodeData] of Object.entries(workflow)) {
      const otherNode = otherNodeData as any;
      if (otherNode && otherNode.inputs) {
        // Check all inputs of other nodes to see if they reference our node
        for (const [inputName, inputValue] of Object.entries(otherNode.inputs)) {
          if (Array.isArray(inputValue) && inputValue.length >= 2 && inputValue[0] === nodeId) {
            // This node is connected to another node
            const connectedNodeClass = otherNode.class_type || '';
            if (connectedNodeClass.toLowerCase().includes('conditioning') ||
                connectedNodeClass.toLowerCase().includes('positive')) {
              return true;
            }
            if (connectedNodeClass.toLowerCase().includes('negative')) {
              return false;
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn('Failed to check prompt type:', error);
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
export { extractPrompt, extractModels, extractLoras, extractScheduler, extractBoard, extractCfgScale, extractSteps, extractSeed, extractDimensions, parseImageMetadata, parseComfyUIMetadata, parseA1111Metadata };

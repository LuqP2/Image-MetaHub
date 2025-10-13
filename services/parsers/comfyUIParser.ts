import { resolveAll } from './comfyui/traversalEngine';
import { ParserNode, NodeRegistry } from './comfyui/nodeRegistry';
import * as zlib from 'zlib';

type Graph = Record<string, ParserNode>;

interface ParseResult {
  data: any;
  detectionMethod: 'json' | 'base64' | 'compressed' | 'regex' | 'unknown';
  warnings: string[];
}

/**
 * Tenta parsear payload do ComfyUI com múltiplas estratégias de descompressão e fallback
 */
async function tryParseComfyPayload(raw: string): Promise<ParseResult | null> {
  const warnings: string[] = [];
  
  // 1. Try direct JSON
  try {
    const parsed = JSON.parse(raw);
    return { data: parsed, detectionMethod: 'json', warnings };
  } catch (e) {
    warnings.push('Direct JSON parse failed');
  }
  
  // 2. Base64 decode
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    return { data: parsed, detectionMethod: 'base64', warnings };
  } catch (e) {
    warnings.push('Base64 decode failed');
  }
  
  // 3. zlib/gzip decompression
  try {
    // Detect zlib magic bytes (\x78\x9c)
    const buffer = Buffer.from(raw, 'base64');
    if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
      const inflated = zlib.inflateSync(buffer);
      const parsed = JSON.parse(inflated.toString('utf8'));
      return { data: parsed, detectionMethod: 'compressed', warnings };
    }
  } catch (e) {
    warnings.push('zlib decompression failed');
  }
  
  // 4. Regex fallback - find large JSON blocks
  try {
    const match = raw.match(/\{[\s\S]{200,}\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      warnings.push('Used regex fallback to find JSON block');
      return { data: parsed, detectionMethod: 'regex', warnings };
    }
  } catch (e) {
    warnings.push('Regex JSON fallback failed');
  }
  
  return null;
}

/**
 * Detecção agressiva de payload ComfyUI em chunks PNG
 */
function detectComfyPayload(chunks: string[]): { payload: string; method: string } | null {
  const combinedText = chunks.join('\n').toLowerCase();
  
  // Procura por strings indicativas do ComfyUI
  const comfyIndicators = ['comfyui', 'workflow', 'nodes', 'comfy', 'class_type'];
  const hasComfyIndicator = comfyIndicators.some(indicator => combinedText.includes(indicator));
  
  if (hasComfyIndicator) {
    return { payload: chunks.join('\n'), method: 'keyword' };
  }
  
  // Regex para detectar blocos JSON grandes (>200 caracteres)
  const largeJsonMatch = chunks.join('\n').match(/\{[\s\S]{200,}\}/);
  if (largeJsonMatch) {
    return { payload: largeJsonMatch[0], method: 'regex_large_json' };
  }
  
  return null;
}

/**
 * Fallback regex inteligente para extrair parâmetros de strings de texto
 */
function extractParamsWithRegex(text: string): Partial<Record<string, any>> {
  const params: any = { raw_parsed_with_regex: true };
  
  // Prompt block
  const promptMatch = text.match(/Prompt[:\n]\s*(.+?)(?:\n(?:Negative prompt|Steps|Sampler|Seed)|$)/is);
  if (promptMatch) params.prompt = promptMatch[1].trim();
  
  // Negative prompt
  const negativeMatch = text.match(/Negative prompt[:\n]\s*(.+?)(?:\n(?:Steps|Sampler|Seed)|$)/is);
  if (negativeMatch) params.negativePrompt = negativeMatch[1].trim();
  
  // Steps
  const stepsMatch = text.match(/Steps[:=]\s*(\d{1,4})/i);
  if (stepsMatch) params.steps = parseInt(stepsMatch[1], 10);
  
  // CFG
  const cfgMatch = text.match(/(?:CFG|cfg_scale|guidance_scale)[:=]\s*([0-9]*\.?[0-9]+)/i);
  if (cfgMatch) params.cfg = parseFloat(cfgMatch[1]);
  
  // Sampler
  const samplerMatch = text.match(/Sampler[:=]\s*([A-Za-z0-9\-\_+]+)/i);
  if (samplerMatch) params.sampler_name = samplerMatch[1];
  
  // Seed
  const seedMatch = text.match(/Seed[:=]\s*(\d+)/i);
  if (seedMatch) params.seed = parseInt(seedMatch[1], 10);
  
  // Model
  const modelMatch = text.match(/Model[:=]\s*(.+?)(?:\n|,|$)/i);
  if (modelMatch) params.model = modelMatch[1].trim();
  
  return params;
}

/**
 * Advanced Seed Extraction with multiple formats:
 * - Numeric: "seed": 12345
 * - Hex: "seed": "0xabc123"
 * - Derived: "derived_seed": {...} → approximateSeed flag
 */
function extractAdvancedSeed(node: ParserNode, graph: Graph): { seed: number | null; approximateSeed?: boolean } {
  // Try numeric seed first (standard path)
  if (typeof node.inputs?.seed === 'number') {
    return { seed: node.inputs.seed };
  }
  
  // Try widgets_values for numeric seed
  if (Array.isArray(node.widgets_values)) {
    for (const value of node.widgets_values) {
      if (typeof value === 'number' && value >= 0 && value <= 18446744073709551615) {
        return { seed: value };
      }
    }
  }
  
  // Try hex format: "0xabc123"
  const hexMatch = JSON.stringify(node).match(/"seed"\s*:\s*"(0x[0-9a-fA-F]+)"/);
  if (hexMatch) {
    const hexSeed = parseInt(hexMatch[1], 16);
    if (!isNaN(hexSeed)) {
      return { seed: hexSeed };
    }
  }
  
  // Try derived_seed (randomized seed based on other inputs)
  if (node.inputs?.derived_seed || node.inputs?.random_seed) {
    // Use timestamp-based approximation
    const approximateSeed = Math.floor(Date.now() / 1000) % 2147483647;
    return { seed: approximateSeed, approximateSeed: true };
  }
  
  return { seed: null };
}

/**
 * Advanced Model Detection with hash mapping:
 * - Extracts model name from CheckpointLoader, LoraLoader nodes
 * - Maps model hashes to "unknown (hash: xxxx)" format
 */
function extractAdvancedModel(node: ParserNode, graph: Graph): string | null {
  // Try model_name from inputs
  if (typeof node.inputs?.model_name === 'string') {
    return node.inputs.model_name;
  }
  
  if (typeof node.inputs?.ckpt_name === 'string') {
    return node.inputs.ckpt_name;
  }
  
  // Try widgets_values for model name (string ending in .safetensors or .ckpt)
  if (Array.isArray(node.widgets_values)) {
    for (const value of node.widgets_values) {
      if (typeof value === 'string' && (value.endsWith('.safetensors') || value.endsWith('.ckpt') || value.endsWith('.pt'))) {
        return value;
      }
    }
  }
  
  // Try model hash fallback
  const hashMatch = JSON.stringify(node).match(/"(?:model_hash|hash)"\s*:\s*"([0-9a-fA-F]{8,})"/);
  if (hashMatch) {
    return `unknown (hash: ${hashMatch[1].substring(0, 8)})`;
  }
  
  // Traverse to CheckpointLoaderSimple or similar
  if (node.inputs?.model && Array.isArray(node.inputs.model)) {
    const [sourceId] = node.inputs.model;
    const sourceNode = graph[sourceId];
    if (sourceNode) {
      return extractAdvancedModel(sourceNode, graph);
    }
  }
  
  return null;
}

/**
 * Extract ControlNet, LoRA, and VAE with weights and parameters
 */
function extractAdvancedModifiers(graph: Graph): {
  controlnets: Array<{ name: string; weight?: number; module?: string; applied_to?: string }>;
  loras: Array<{ name: string; weight?: number }>;
  vaes: Array<{ name: string }>;
} {
  const controlnets: any[] = [];
  const loras: any[] = [];
  const vaes: any[] = [];
  
  for (const nodeId in graph) {
    const node = graph[nodeId];
    const classType = node.class_type.toLowerCase();
    
    // ControlNet detection
    if (classType.includes('controlnet')) {
      const name = node.inputs?.control_net_name || node.inputs?.model || 'unknown';
      const weight = node.inputs?.strength || node.inputs?.weight || 1.0;
      const module = node.inputs?.preprocessor || node.inputs?.module;
      const applied_to = node.inputs?.image ? 'image' : node.inputs?.latent ? 'latent' : undefined;
      
      controlnets.push({ name, weight, module, applied_to });
    }
    
    // LoRA detection
    if (classType.includes('lora')) {
      const name = node.inputs?.lora_name || node.widgets_values?.[0] || 'unknown';
      const weight = node.inputs?.strength_model || node.inputs?.weight || node.widgets_values?.[1] || 1.0;
      
      loras.push({ name, weight });
    }
    
    // VAE detection
    if (classType.includes('vae') && classType.includes('loader')) {
      const name = node.inputs?.vae_name || node.widgets_values?.[0] || 'unknown';
      vaes.push({ name });
    }
  }
  
  return { controlnets, loras, vaes };
}

/**
 * Extract edit history from SaveImage and LoadImage nodes
 */
function extractEditHistory(graph: Graph): Array<{ action: string; timestamp?: number; index?: number }> {
  const history: any[] = [];
  
  for (const nodeId in graph) {
    const node = graph[nodeId];
    
    if (node.class_type === 'SaveImage') {
      const timestamp = node.inputs?.timestamp || Date.now();
      history.push({ action: 'save', timestamp: Number(timestamp) });
    }
    
    if (node.class_type === 'LoadImage') {
      const filename = node.inputs?.image || node.widgets_values?.[0];
      const index = history.length;
      history.push({ action: 'load', filename, index });
    }
  }
  
  return history.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

/**
 * Detect ComfyUI version from metadata
 */
function extractComfyVersion(workflow: any, prompt: any): string | null {
  // Check workflow metadata
  if (workflow?.version) {
    return String(workflow.version);
  }
  
  if (workflow?.meta?.comfyui_version) {
    return String(workflow.meta.comfyui_version);
  }
  
  // Try regex on combined text
  const text = JSON.stringify(workflow) + JSON.stringify(prompt);
  const versionMatch = text.match(/"version"\s*:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?/);
  if (versionMatch) {
    return versionMatch[1];
  }
  
  return null;
}

/**
 * Constrói um mapa de nós simplificado a partir dos dados do workflow e do prompt.
 */
function createNodeMap(workflow: any, prompt: any): Graph {
    const graph: Graph = {};

    // Add/overlay from prompt (execution data: class_type, inputs)
    for (const [id, pNode] of Object.entries(prompt || {})) {
        graph[id] = {
            id,
            class_type: (pNode as any).class_type,
            inputs: (pNode as any).inputs || {},
            widgets_values: (pNode as any).widgets_values,  // Keep undefined if not present
            mode: 0,
        };
    }

    // Overlay from workflow (UI data: widgets_values, mode, type if missing)
    if (workflow?.nodes) {
        for (const wNode of workflow.nodes) {
            const id = wNode.id.toString();
            if (graph[id]) {
                graph[id].widgets_values = wNode.widgets_values || [];
                graph[id].mode = wNode.mode || 0;
                graph[id].class_type = graph[id].class_type || wNode.type;
            } else {
                graph[id] = {
                    id,
                    class_type: wNode.type,
                    inputs: {},
                    widgets_values: wNode.widgets_values || [],
                    mode: wNode.mode || 0,
                };
            }
            
            // For grouped workflow nodes: DON'T apply parent widgets to children
            // The child nodes already have correct values in their "inputs" from the prompt data
            // Applying parent widgets would break the indices since parent widgets are concatenated
            // The fallback logic in extractValue will read from inputs when widgets_values is empty
        }
    }

    // If workflow has links, populate inputs for nodes without them (fallback for incomplete prompts)
    if (workflow?.links) {
        for (const link of workflow.links) {
            const [, sourceId, sourceSlot, targetId, targetSlot, , inputName] = link; // Adjust based on link format
            const targetNode = graph[targetId.toString()];
            if (targetNode && inputName) {
                targetNode.inputs[inputName] = [sourceId.toString(), sourceSlot];
            }
        }
    }

    return graph;
}

/**
 * Encontra o nó terminal do grafo, que serve como ponto de partida para a travessia.
 * Prioriza nós de geração (KSampler) sobre pós-processamento (UltimateSDUpscale).
 */
function findTerminalNode(graph: Graph): ParserNode | null {
    let terminalNode: ParserNode | null = null;
    let kSamplerNode: ParserNode | null = null;
    
    for (const nodeId in graph) {
        const node = graph[nodeId];
        const nodeDef = NodeRegistry[node.class_type];
        
        if (nodeDef?.roles.includes('SINK')) {
            // Prioritize KSampler variants and workflow sampler nodes (main generation nodes)
            if (node.class_type.includes('KSampler') || node.class_type.includes('Sampler')) {
                kSamplerNode = node;
            } else if (!terminalNode) {
                terminalNode = node;
            }
        }
    }
    
    // Return KSampler if found, otherwise return any SINK node
    const result = kSamplerNode || terminalNode;
    return result;
}/**
 * Ponto de entrada principal. Resolve todos os parâmetros de metadados de um grafo.
 */
export function resolvePromptFromGraph(workflow: any, prompt: any): Record<string, any> {
  const telemetry = {
    detection_method: 'standard',
    unknown_nodes_count: 0,
    warnings: [] as string[],
  };
  
  const graph = createNodeMap(workflow, prompt);
  
  // Count unknown nodes for telemetry
  for (const nodeId in graph) {
    const node = graph[nodeId];
    if (!NodeRegistry[node.class_type]) {
      telemetry.unknown_nodes_count++;
      telemetry.warnings.push(`Unknown node type: ${node.class_type}`);
    }
  }
  
  const terminalNode = findTerminalNode(graph);

  if (!terminalNode) {
    console.error("[ComfyUI Parser] ❌ Não foi possível encontrar um nó terminal (SINK) no grafo.");
    console.error("[ComfyUI Parser] Available nodes:", Object.entries(graph).map(([id, n]) => `${id}:${n.class_type}`));
    telemetry.warnings.push('No terminal node found');
    
    // Try regex fallback on workflow text
    const workflowText = JSON.stringify(workflow) + JSON.stringify(prompt);
    const regexParams = extractParamsWithRegex(workflowText);
    
    if (Object.keys(regexParams).length > 1) {
      console.log("[ComfyUI Parser] ✅ Used regex fallback to extract parameters");
      telemetry.detection_method = 'regex_fallback';
      return { ...regexParams, _telemetry: telemetry };
    }
    
    return { _telemetry: telemetry };
  }
  
  // Note: width/height are NOT extracted from workflow, they're read from actual image dimensions
  const results = resolveAll({
    startNode: terminalNode,
    graph: graph,
    params: ['prompt', 'negativePrompt', 'seed', 'steps', 'cfg', 'model', 'sampler_name', 'scheduler', 'lora', 'vae', 'denoise']
  });

  // Post-processing: deduplicate arrays and clean up prompts
  if (results.lora && Array.isArray(results.lora)) {
    // Remove duplicates while preserving order of first appearance
    results.lora = Array.from(new Set(results.lora));
  }
  
  // Fix duplicated prompts - check if prompt contains repeated segments
  if (results.prompt && typeof results.prompt === 'string') {
    const trimmedPrompt = results.prompt.trim();
    
    // Split by common delimiters (comma, comma+space, double space)
    const segments = trimmedPrompt.split(/,\s*|,|  +/).filter(s => s.trim());
    
    // Remove duplicate segments while preserving order
    const uniqueSegments = Array.from(new Set(segments));
    
    // If we removed duplicates, reconstruct the prompt
    if (uniqueSegments.length < segments.length) {
      results.prompt = uniqueSegments.join(', ');
    }
    
    // Additional check: if the entire prompt is literally repeated (e.g., "abc abc")
    const words = trimmedPrompt.split(/\s+/);
    const half = Math.floor(words.length / 2);
    if (words.length >= 4 && words.length % 2 === 0) {
      const firstHalf = words.slice(0, half).join(' ');
      const secondHalf = words.slice(half).join(' ');
      if (firstHalf === secondHalf && firstHalf.length > 0) {
        results.prompt = firstHalf;
      }
    }
  }

  // Phase 2: Advanced extraction using terminal node
  const advancedSeed = extractAdvancedSeed(terminalNode, graph);
  if (advancedSeed.seed !== null) {
    results.seed = advancedSeed.seed;
    if (advancedSeed.approximateSeed) {
      results.approximateSeed = true;
      telemetry.warnings.push('Seed is approximate (derived from derived_seed or random_seed)');
    }
  }
  
  const advancedModel = extractAdvancedModel(terminalNode, graph);
  if (advancedModel) {
    results.model = advancedModel;
  }
  
  // Extract modifiers (ControlNet, LoRA, VAE)
  const modifiers = extractAdvancedModifiers(graph);
  if (modifiers.controlnets.length > 0) {
    results.controlnets = modifiers.controlnets;
  }
  if (modifiers.loras.length > 0) {
    // Merge with existing lora array from resolveAll
    const existingLoras = results.lora || [];
    results.loras = modifiers.loras; // Detailed lora info
    results.lora = Array.from(new Set([...existingLoras, ...modifiers.loras.map(l => l.name)])); // Backward compatibility
  }
  if (modifiers.vaes.length > 0) {
    results.vaes = modifiers.vaes;
  }
  
  // Extract edit history
  const editHistory = extractEditHistory(graph);
  if (editHistory.length > 0) {
    results.editHistory = editHistory;
  }
  
  // Extract ComfyUI version
  const comfyVersion = extractComfyVersion(workflow, prompt);
  if (comfyVersion) {
    results.comfyui_version = comfyVersion;
  }
  
  // Add telemetry data to results for debugging
  if (telemetry.unknown_nodes_count > 0 || telemetry.warnings.length > 0) {
    console.log('[ComfyUI Parser] Telemetry:', telemetry);
  }
  
  return { ...results, _telemetry: telemetry };
}

/**
 * Enhanced parsing with aggressive payload detection and decompression
 * This is the new entry point that should be used for robust ComfyUI parsing
 */
export async function parseComfyUIMetadataEnhanced(rawData: any): Promise<Record<string, any>> {
  const telemetry = {
    detection_method: 'unknown',
    warnings: [] as string[],
  };

  try {
    // If already an object, try to parse it directly
    if (typeof rawData === 'object' && rawData !== null) {
      const workflow = rawData.workflow;
      const prompt = rawData.prompt;
      return resolvePromptFromGraph(workflow, prompt);
    }

    // If string, try aggressive payload detection
    if (typeof rawData === 'string') {
      const parseResult = await tryParseComfyPayload(rawData);
      
      if (parseResult) {
        telemetry.detection_method = parseResult.detectionMethod;
        telemetry.warnings = parseResult.warnings;
        
        const data = parseResult.data;
        const workflow = data.workflow;
        const prompt = data.prompt;
        
        const results = resolvePromptFromGraph(workflow, prompt);
        return { ...results, _parse_telemetry: telemetry };
      }
    }

    // Fallback: try regex extraction if all else fails
    const textData = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
    const regexParams = extractParamsWithRegex(textData);
    
    if (Object.keys(regexParams).length > 1) {
      telemetry.detection_method = 'regex_only';
      return { ...regexParams, _parse_telemetry: telemetry };
    }

  } catch (error) {
    telemetry.warnings.push(`Parse error: ${error}`);
    console.error('[ComfyUI Parser Enhanced] Error:', error);
  }

  return { _parse_telemetry: telemetry };
}


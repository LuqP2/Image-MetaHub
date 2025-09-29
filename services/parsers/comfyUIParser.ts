import { ComfyUIMetadata, BaseMetadata, ComfyUIPrompt, ComfyUIWorkflow, ComfyUINode } from '../../types';

type NodeMap = { [id: string]: any };

/**
 * Recursively resolves a value from a node's input.
 * If the input is a link, it follows it to the source node and gets the value.
 * @param link The link array, e.g., ["node_id", output_index].
 * @param nodes The map of all nodes in the prompt.
 * @param visited A set to track visited nodes to prevent infinite loops.
 * @returns The resolved primitive value or null if not found.
 */
function findValueByLink(link: [string, number], nodes: NodeMap, visited: Set<string> = new Set()): any {
  const nodeId = link[0];
  if (visited.has(nodeId)) return null; // Circular reference detected
  visited.add(nodeId);

  const node = nodes[nodeId];
  if (!node) return null;

  // Try to find a direct value in the target node's inputs
  const inputs = node.inputs;
  // Common value fields in order of preference
  const valueFields = ['string', 'text', 'int', 'float', 'seed', 'noise_seed', 'steps', 'cfg', 'guidance', 'scheduler', 'sampler_name', 'unet_name', 'ckpt_name', 'lora_name', 'width', 'height'];
  for (const field of valueFields) {
    if (inputs[field] !== undefined) {
      // If this value is itself a link, recurse
      if (Array.isArray(inputs[field]) && inputs[field].length === 2 && typeof inputs[field][0] === 'string' && typeof inputs[field][1] === 'number') {
        return findValueByLink(inputs[field] as [string, number], nodes, visited);
      }
      return inputs[field]; // Found primitive value
    }
  }
  return null; // No recognizable value field found
}


// --- Main Parser Function ---

export function parseComfyUIMetadata(metadata: ComfyUIMetadata): BaseMetadata {
  const result: BaseMetadata & { loras: string[], models: string[] } = {
    format: 'ComfyUI [beta]',
    prompt: '',
    negativePrompt: '',
    model: 'Unknown',
    width: 0,
    height: 0,
    steps: 0,
    cfg_scale: 0,
    seed: 0,
    scheduler: 'Unknown',
    sampler: 'Unknown',
    loras: [],
    models: []
  };

  const dataSource = metadata.prompt || metadata.workflow;
  if (!dataSource) return result;

  const sourceObj = typeof dataSource === 'string' ? JSON.parse(dataSource) : dataSource;

  let nodes: NodeMap;

  // Normalize 'workflow' structure (array of nodes) to 'prompt' structure (map of nodes)
  if (sourceObj.nodes && Array.isArray(sourceObj.nodes)) {
    nodes = (sourceObj as ComfyUIWorkflow).nodes.reduce((acc, node) => {
      acc[node.id.toString()] = {
          inputs: node.inputs || {},
          class_type: (node as any).class_type || node.type, // Handle both 'type' and 'class_type' fields
          // A common property name for UI titles
          _meta: { title: node.properties?.['Node name for S&R'] || '' }
      };
      return acc;
    }, {} as NodeMap);
  } else {
    nodes = sourceObj as NodeMap;
  }

  // --- Data Extraction ---

  let samplerNodeId: string | null = null;

  // First pass: Find the main sampler and basic info
  for (const nodeId in nodes) {
    const node = nodes[nodeId];
    switch (node.class_type) {
      case 'KSampler':
      case 'KSamplerAdvanced':
        samplerNodeId = nodeId;
        result.steps = node.inputs.steps ?? result.steps;
        result.cfg_scale = node.inputs.cfg ?? node.inputs.guidance ?? node.inputs.conditioning_scale ?? result.cfg_scale;
        result.seed = node.inputs.seed ?? result.seed;
        result.scheduler = node.inputs.scheduler ?? result.scheduler;
        result.sampler = node.inputs.sampler_name ?? result.sampler;
        break;

      case 'CheckpointLoaderSimple':
      case 'CheckpointLoader':
        result.models.push(node.inputs.ckpt_name);
        break;

      case 'UNETLoader':
        result.models.push(node.inputs.unet_name);
        break;

      case 'LoraLoader':
      case 'LoraLoaderModelOnly':
        result.loras.push(node.inputs.lora_name);
        break;

      case 'FluxGuidance':
        result.cfg_scale = node.inputs.guidance ?? result.cfg_scale;
        break;

      case 'BasicScheduler':
         result.steps = node.inputs.steps ?? result.steps;
         result.scheduler = node.inputs.scheduler ?? result.scheduler;
         break;

      case 'SamplerCustom':
      case 'SamplerCustomAdvanced':
        result.cfg_scale = node.inputs.cfg ?? node.inputs.guidance ?? result.cfg_scale;
        result.sampler = node.inputs.sampler_name ?? result.sampler;
        break;

      case ' ConditioningCombine':
      case 'ConditioningSetTimestepRange':
        result.steps = node.inputs.end_step ?? result.steps;
        break;

      case 'EmptyLatentImage':
        // Latent dimensions are already in the correct scale (no need to multiply by 8)
        result.width = node.inputs.width ?? result.width;
        result.height = node.inputs.height ?? result.height;
        break;

      case 'Int Literal':
        if (node._meta?.title?.toLowerCase().includes('width')) {
            result.width = node.inputs.int ?? result.width;
        }
        if (node._meta?.title?.toLowerCase().includes('height')) {
            result.height = node.inputs.int ?? result.height;
        }
        break;
    }
  }

  // Second pass: Use the sampler node to trace prompts and other linked values
  if (samplerNodeId) {
    const samplerNode = nodes[samplerNodeId];
    
    // Extract prompts by following links
    if (samplerNode.inputs.positive && Array.isArray(samplerNode.inputs.positive)) {
      result.prompt = findValueByLink(samplerNode.inputs.positive, nodes) ?? result.prompt;
    }
    if (samplerNode.inputs.negative && Array.isArray(samplerNode.inputs.negative)) {
      result.negativePrompt = findValueByLink(samplerNode.inputs.negative, nodes) ?? result.negativePrompt;
    }
    
    // Extract other parameters by following links if not already set directly
    if (!result.seed && samplerNode.inputs.seed && Array.isArray(samplerNode.inputs.seed)) {
      result.seed = findValueByLink(samplerNode.inputs.seed, nodes) ?? result.seed;
    }
    if (!result.steps && samplerNode.inputs.steps && Array.isArray(samplerNode.inputs.steps)) {
      result.steps = findValueByLink(samplerNode.inputs.steps, nodes) ?? result.steps;
    }
    if (!result.cfg_scale && samplerNode.inputs.cfg && Array.isArray(samplerNode.inputs.cfg)) {
      result.cfg_scale = findValueByLink(samplerNode.inputs.cfg, nodes) ?? result.cfg_scale;
    }
    if (!result.cfg_scale && samplerNode.inputs.guidance && Array.isArray(samplerNode.inputs.guidance)) {
      result.cfg_scale = findValueByLink(samplerNode.inputs.guidance, nodes) ?? result.cfg_scale;
    }
    if (!result.sampler && samplerNode.inputs.sampler_name && Array.isArray(samplerNode.inputs.sampler_name)) {
      result.sampler = findValueByLink(samplerNode.inputs.sampler_name, nodes) ?? result.sampler;
    }
    if (!result.scheduler && samplerNode.inputs.scheduler && Array.isArray(samplerNode.inputs.scheduler)) {
      result.scheduler = findValueByLink(samplerNode.inputs.scheduler, nodes) ?? result.scheduler;
    }
  }

  // --- Final Cleanup ---
  if (result.models.length > 0) {
    // Prioritize checkpoint loaders for the main model name
    const checkpoint = result.models.find(m => m.toLowerCase().includes('.safetensors') || m.toLowerCase().includes('.ckpt'));
    result.model = checkpoint || result.models[0];
  }

  // Ensure no null/undefined values are returned
  for(const key in result) {
    if((result as any)[key] === null || (result as any)[key] === undefined) {
      const a = result as any;
      if (typeof a[key] === 'string') a[key] = '';
      if (typeof a[key] === 'number') a[key] = 0;
    }
  }

  return result;
}
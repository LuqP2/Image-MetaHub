import { ComfyUIMetadata, BaseMetadata, ComfyUIWorkflow, ComfyUIPrompt, ComfyUINode } from '../../types';

type Link = [string, number];

interface ParserNode {
  id: string;
  inputs: Record<string, any>;
  class_type: string;
  title?: string;
  properties?: Record<string, any>;
  widgets_values?: any[];
  links: [number, number, number, number, string, string][];
}
type NodeMap = { [id: string]: ParserNode };

function createNodeMap(workflow: ComfyUIWorkflow | null, prompt: ComfyUIPrompt): NodeMap {
    const nodeMap: NodeMap = {};
    const nodeDefs: { [id: string]: ComfyUINode } = {};

    // 1. First pass: Create all node entries from the workflow definition
    // This gives us access to metadata like input names by index.
    if (workflow?.nodes) {
        for (const node of workflow.nodes) {
            const nodeId = node.id.toString();
            nodeDefs[nodeId] = node;
            nodeMap[nodeId] = {
                id: nodeId,
                inputs: {}, // Inputs will be populated next
                class_type: node.type,
                title: (node as any).title || node.properties?.['Node name for S&R'],
                widgets_values: node.widgets_values,
                properties: node.properties,
                links: [], // This property is not used by the new parser but kept for type compatibility
            };
        }
    }

    // 2. Second pass: Populate inputs based on the workflow's links array.
    // This builds the default graph structure.
    if (workflow?.links) {
        for (const link of workflow.links) {
            const [linkId, sourceNodeId, sourceOutputSlot, targetNodeId, targetInputSlot, type] = link;
            const targetNodeDef = nodeDefs[targetNodeId.toString()];
            const targetNode = nodeMap[targetNodeId.toString()];

            if (targetNode && targetNodeDef && targetNodeDef.inputs) {
                const inputInfo = targetNodeDef.inputs[targetInputSlot];
                if (inputInfo) {
                    targetNode.inputs[inputInfo.name] = [sourceNodeId.toString(), sourceOutputSlot];
                }
            }
        }
    }

    // 3. Final pass: Overlay with prompt data. This is the source of truth for execution.
    // It contains the literal values and the actual connections used for the run.
    for (const [id, promptNode] of Object.entries(prompt)) {
        if (!nodeMap[id]) {
            // Node exists only in the prompt (less common, but possible)
            nodeMap[id] = {
                id,
                inputs: promptNode.inputs,
                class_type: promptNode.class_type,
                title: promptNode._meta?.title,
                widgets_values: undefined,
                properties: undefined,
                links: [],
            };
        } else {
            // Overwrite the inputs with the ones from the prompt, as they are the ground truth for this run.
            nodeMap[id].inputs = promptNode.inputs;
            // Also update class_type and title if they are in the prompt metadata.
            nodeMap[id].class_type = promptNode.class_type;
            if (promptNode._meta?.title) {
                nodeMap[id].title = promptNode._meta.title;
            }
        }
    }

    return nodeMap;
}

/**
 * Traces backwards from a given link to find an upstream node of a specific class type.
 * @param link The starting link [nodeId, outputIndex].
 * @param nodes The complete map of all nodes in the graph.
 * @param targetClassType The class type to search for (e.g., 'Sampler').
 * @param visited A set to track visited nodes to prevent infinite loops.
 * @returns The found ParserNode or null.
 */
function traceBackToNode(link: Link | undefined, nodes: NodeMap, predicate: (node: ParserNode) => boolean, visited: Set<string> = new Set()): ParserNode | null {
    if (!link || !Array.isArray(link) || link.length < 2) return null;

    const [nodeId, outputIndex] = link;
    const visitKey = `${nodeId}:${outputIndex}`;
    if (visited.has(visitKey)) return null; // Cycle detected
    visited.add(visitKey);

    const node = nodes[nodeId];
    if (!node) return null;

    // 1. Check if the current node matches the predicate
    if (predicate(node)) {
        return node;
    }

    // 2. Handle Pass-through nodes (e.g., Reroute) which just forward a single input.
    if (node.class_type.includes('Reroute')) {
        const inputLink = Object.values(node.inputs).find(input => Array.isArray(input));
        if (Array.isArray(inputLink) && inputLink.length >= 2) {
            return traceBackToNode(inputLink as Link, nodes, predicate, visited);
        }
    }

    // 3. Trace the primary input for image/latent data (e.g., from a VAEDecode).
    const upstreamLink = node.inputs.images || node.inputs.samples || node.inputs.image || node.inputs.latent || node.inputs.latent_image;
    if (Array.isArray(upstreamLink) && upstreamLink.length >= 2) {
        return traceBackToNode(upstreamLink as Link, nodes, predicate, visited);
    }
    
    // 4. Fallback for other potential pass-through nodes.
    const anyInputLink = Object.values(node.inputs).find(input => Array.isArray(input));
    if (Array.isArray(anyInputLink) && anyInputLink.length >= 2) {
        return traceBackToNode(anyInputLink as Link, nodes, predicate, visited);
    }

    return null;
}

function findTargetNode(nodes: NodeMap): ParserNode | null {
    const saveNode = Object.values(nodes).find(n => n.class_type.includes('Save'));
    if (saveNode) return saveNode;

    const previewNode = Object.values(nodes).find(n => n.class_type.includes('Preview'));
    if (previewNode) return previewNode;
    
    // Fallback: Find terminal KSampler
    const ksamplers = Object.values(nodes).filter(n => n.class_type.includes('Sampler'));
    if (ksamplers.length === 0) return null;
    if (ksamplers.length === 1) return ksamplers[0];

    const allLatentInputs = new Set<string>();
    for (const node of Object.values(nodes)) {
        if (node.class_type.includes('Sampler')) {
            const latentInput = node.inputs.latent_image;
            if (Array.isArray(latentInput) && typeof latentInput[0] === 'string') {
                allLatentInputs.add(latentInput[0]);
            }
        }
    }

    const terminalKSampler = ksamplers.find(s => !allLatentInputs.has(s.id));
    
    return terminalKSampler || ksamplers[ksamplers.length - 1];
}


function parseParametersString(parameters: string): Partial<BaseMetadata> {
    const result: Partial<BaseMetadata> = { loras: [], models: [] };
    const negativePromptKeyword = 'Negative prompt:';
    const stepsKeyword = '\nSteps:';
    const negativePromptIndex = parameters.indexOf(negativePromptKeyword);
    const stepsIndex = parameters.indexOf(stepsKeyword, negativePromptIndex);

    if (negativePromptIndex !== -1) {
        result.prompt = parameters.substring(0, negativePromptIndex).trim();
        const fromNegative = parameters.substring(negativePromptIndex + negativePromptKeyword.length);
        result.negativePrompt = fromNegative.substring(0, fromNegative.indexOf(stepsKeyword)).trim();
    } else if (stepsIndex !== -1) {
        result.prompt = parameters.substring(0, stepsIndex).trim();
    } else {
        result.prompt = parameters.trim();
    }

    const paramsPart = stepsIndex !== -1 ? parameters.substring(stepsIndex) : '';
    const stepsMatch = paramsPart.match(/Steps: (\d+)/);
    if (stepsMatch) result.steps = parseInt(stepsMatch[1], 10);

    const samplerMatch = paramsPart.match(/Sampler: ([^,]+)/);
    if (samplerMatch) {
        result.sampler = samplerMatch[1].trim();
        result.scheduler = samplerMatch[1].trim();
    }

    const cfgScaleMatch = paramsPart.match(/CFG scale: ([\d.]+)/);
    if (cfgScaleMatch) result.cfg_scale = parseFloat(cfgScaleMatch[1]);

    const seedMatch = paramsPart.match(/Seed: (\d+)/);
    if (seedMatch) result.seed = parseInt(seedMatch[1], 10);

    const sizeMatch = paramsPart.match(/Size: (\d+)x(\d+)/);
    if (sizeMatch) {
        result.width = parseInt(sizeMatch[1], 10);
        result.height = parseInt(sizeMatch[2], 10);
    }

    const modelMatch = paramsPart.match(/Model: ([^,]+)/);
    if (modelMatch) {
        result.model = modelMatch[1].trim();
        if(!result.models) result.models = [];
        result.models.push(result.model);
    }

    const loraRegex = /<lora:([^:]+):[^>]+>/g;
    let loraMatch;
    if (result.prompt) {
        while ((loraMatch = loraRegex.exec(result.prompt)) !== null) {
            if(!result.loras) result.loras = [];
            result.loras.push(loraMatch[1]);
        }
    }
    return result;
}

function traceNodeValue(link: Link | undefined, nodes: NodeMap, contextHint: string, visited: Set<string> = new Set()): any {
    if (!link || !Array.isArray(link) || link.length < 2) return null;

    const [nodeId, outputIndex] = link;
    const visitKey = `${nodeId}:${outputIndex}:${contextHint}`;
    if (visited.has(visitKey)) return null;
    visited.add(visitKey);

    const node = nodes[nodeId];
    if (!node) return null;
    
    const traceNext = (nextLink: any, newContextHint = contextHint) => {
        if (Array.isArray(nextLink) && nextLink.length >= 2) {
            return traceNodeValue(nextLink as Link, nodes, newContextHint, visited);
        }
        return null;
    }

    // 1. Check for literal text value. This is the base case for prompt tracing.
    // Nodes like "String Literal" or a CLIPTextEncode with text in its widget hold the value directly.
    if (node.class_type.includes('String') || node.class_type.includes('CLIPTextEncode')) {
        if (node.widgets_values && typeof node.widgets_values[0] === 'string') {
            return node.widgets_values[0];
        }
        // If it's a text-like node but the value isn't in the widget, it must be traced from its input.
        // This handles CLIPTextEncode being fed by a String Literal.
        return traceNext(node.inputs.string || node.inputs.text, 'text');
    }

    // 2. If no literal value, check if this is a special-case node or a pass-through.

    // 2a. Handle ConditioningZeroOut explicitly. This node's purpose is to create an empty prompt.
    if (node.class_type === 'ConditioningZeroOut') {
        return '';
    }
    
    // 2b. Handle general pass-through nodes for conditioning, pipes, etc.
    const passThroughTypes = ['Reroute', 'Pipe', 'ConditioningCombine', 'ConditioningSetTimestepRange', 'ControlNetApplyAdvanced', 'FluxGuidance'];
    if (passThroughTypes.some(type => node.class_type.includes(type))) {
        const primaryInput = node.inputs.conditioning || node.inputs.conditioning_1;
        if (primaryInput) return traceNext(primaryInput);
        
        const secondaryInput = node.inputs.conditioning_2;
        if (secondaryInput) return traceNext(secondaryInput);
        
        const anyInputLink = Object.values(node.inputs).find(input => Array.isArray(input));
        if (anyInputLink) return traceNext(anyInputLink);
    }

    // 2b. Handle Guider nodes (for CFG, prompts)
    if (node.class_type.includes('Guider')) {
        // The context hint tells us which original parameter we're looking for (e.g., 'positive', 'cfg').
        const contextInput = node.inputs[contextHint];
        if (contextInput) return traceNext(contextInput);
        
        // Fallback for generic guiders, just trace any input
        const anyInputLink = Object.values(node.inputs).find(input => Array.isArray(input));
        if (anyInputLink) return traceNext(anyInputLink);
    }

    // 2c. Handle Bus nodes
    if (node.class_type.includes('Bus')) {
        const contextInput = node.inputs[contextHint];
        if (contextInput) return traceNext(contextInput);
        const anyInputLink = Object.values(node.inputs).find(input => Array.isArray(input));
        if (anyInputLink) return traceNext(anyInputLink);
    }
    
    // 3. If not a pass-through, extract other types of values.

    // 3a. Extract literal values from standard input fields (API format, etc.)
    const valueFields = ['string', 'String', 'int', 'float', 'seed', 'sampler_name', 'scheduler', 'populated_text', 'unet_name', 'ckpt_name', 'model_name', 'lora_name', 'guidance', 'wildcard_text', 'text'];
    for (const field of valueFields) {
        if (node.inputs[field] !== undefined) {
            const value = node.inputs[field];
            return Array.isArray(value) ? traceNext(value) : value;
        }
    }
    
    // 3b. Handle special-case nodes like string concatenation or latent dimensions.
    if (node.class_type === 'CLIPTextEncodeFlux') {
        const clipL = traceNext(node.inputs.clip_l, 'clip_l') || '';
        const t5xxl = traceNext(node.inputs.t5xxl, 't5xxl') || '';
        // Simple concatenation, assuming order matters or they are complementary.
        return `${clipL}${t5xxl}`;
    }
    if (node.class_type === 'JWStringConcat') {
        const strA = traceNext(node.inputs.a, 'a') || '';
        const strB = traceNext(node.inputs.b, 'b') || '';
        return `${strA}${strB}`;
    }
    if (node.class_type.includes("Latent")) {
        const width = Array.isArray(node.inputs.width) ? traceNext(node.inputs.width, 'width') : node.inputs.width;
        const height = Array.isArray(node.inputs.height) ? traceNext(node.inputs.height, 'height') : node.inputs.height;
        if (width && height) return `${width}x${height}`;
    }

    // 4. Final fallbacks.
    if (node.widgets_values && node.widgets_values.length > outputIndex) {
        return node.widgets_values[outputIndex];
    }
    const anyInputLink = Object.values(node.inputs).find(input => Array.isArray(input));
    if (anyInputLink) return traceNext(anyInputLink);
    
    return null;
}

/**
 * Traces backwards from a start node to find an upstream node based on a specific context,
 * following a context-aware path. This prevents the trace from leaking into unrelated graph branches.
 * @param startNode The node to begin the search from.
 * @param targetKeys The input keys to look for (e.g., ['positive', 'guider']).
 * @param context The type of parameter being hunted (e.g., 'prompt', 'seed').
 * @param nodes The complete map of all nodes.
 * @param visited A set to track visited nodes and prevent cycles.
 * @returns The found ParserNode or null.
 */
function findUpstreamNodeByContext(startNode: ParserNode, targetKeys: string[], context: 'prompt' | 'seed' | 'sampler' | 'steps' | 'cfg' | 'dimensions' | 'any', nodes: NodeMap, visited: Set<string> = new Set()): ParserNode | null {
    if (!startNode || visited.has(startNode.id)) return null;
    visited.add(startNode.id);

    // Check if the current node already contains the target.
    for (const key of targetKeys) {
        if (key in startNode.inputs) {
            return startNode;
        }
    }

    // Define context-specific paths to prioritize the search.
    let contextPaths: string[] = [];
    switch (context) {
        case 'prompt':
            contextPaths = ['positive', 'negative', 'conditioning', 'guider', 'clip'];
            break;
        case 'seed':
            contextPaths = ['seed', 'noise_seed', 'noise', 'sampler'];
            break;
        case 'dimensions':
             contextPaths = ['upscale_model', 'vae']; // These are less common, but good to check
            break;
        case 'steps':
        case 'cfg':
        case 'sampler':
            contextPaths = ['sampler', 'sigmas', 'guider', 'model'];
            break;
    }

    // Always include the main data flow paths as a fallback to navigate the graph.
    const mainDataPaths = ['image', 'images', 'samples', 'latent', 'latent_image', 'any'];
    
    // Combine and prioritize context-specific paths, then main data paths.
    const prioritizedPaths = [...new Set([...contextPaths, ...mainDataPaths])];

    for (const key of prioritizedPaths) {
        if (key in startNode.inputs) { // Check if the input exists on the node
            const inputLink = startNode.inputs[key];
            if (Array.isArray(inputLink) && typeof inputLink[0] === 'string') {
                const upstreamNode = nodes[inputLink[0]];
                if (upstreamNode) {
                    const foundNode = findUpstreamNodeByContext(upstreamNode, targetKeys, context, nodes, visited);
                    if (foundNode) return foundNode;
                }
            }
        }
    }
    
    // Final fallback: search any remaining inputs that weren't in the prioritized list.
    for (const key in startNode.inputs) {
        if (!prioritizedPaths.includes(key)) {
            const inputLink = startNode.inputs[key];
            if (Array.isArray(inputLink) && typeof inputLink[0] === 'string') {
                const upstreamNode = nodes[inputLink[0]];
                if (upstreamNode) {
                    const foundNode = findUpstreamNodeByContext(upstreamNode, targetKeys, context, nodes, visited);
                    if (foundNode) return foundNode;
                }
            }
        }
    }

    return null;
}

function parseWorkflowAndPrompt(workflow: ComfyUIWorkflow | null, prompt: ComfyUIPrompt): Partial<BaseMetadata> {
    const result: Partial<BaseMetadata> = { models: [], loras: [] };
    const nodes = createNodeMap(workflow, prompt);
    const traceVal = (input: any, contextHint: string): any => traceNodeValue(input, nodes, contextHint);
    
    const outputNode = findTargetNode(nodes);

    if (outputNode) {
        const findAndTrace = (targetKeys: string[], context: 'prompt' | 'seed' | 'sampler' | 'steps' | 'cfg' | 'dimensions' | 'any'): any => {
            const sourceNode = findUpstreamNodeByContext(outputNode, targetKeys, context, nodes, new Set());
            if (sourceNode) {
                const foundKey = targetKeys.find(key => key in sourceNode.inputs);
                if (foundKey) {
                    const value = sourceNode.inputs[foundKey];
                    // If the value is an array, it's a link to be traced. Otherwise, it's a literal value.
                    return Array.isArray(value) ? traceVal(value, foundKey) : value;
                }
            }
            return null;
        };

        result.steps = findAndTrace(['steps', 'sigmas'], 'steps');
        result.cfg_scale = findAndTrace(['cfg'], 'cfg');
        result.seed = findAndTrace(['seed', 'noise_seed'], 'seed');
        result.sampler = findAndTrace(['sampler', 'sampler_name'], 'sampler');
        result.scheduler = findAndTrace(['scheduler'], 'sampler');
        result.prompt = findAndTrace(['positive', 'guider'], 'prompt');
        result.negativePrompt = findAndTrace(['negative', 'guider'], 'prompt');
        result.width = findAndTrace(['width'], 'dimensions');
        result.height = findAndTrace(['height'], 'dimensions');

        // Fallback for dimensions if they weren't found as direct inputs (e.g., in widgets)
        if (!result.width || !result.height) {
            const latentSourceNode = findUpstreamNodeByContext(outputNode, ['samples', 'latent_image'], 'dimensions', nodes, new Set());
            if (latentSourceNode?.class_type.includes("Latent") && latentSourceNode.widgets_values) {
                 if (typeof latentSourceNode.widgets_values[0] === 'number' && typeof latentSourceNode.widgets_values[1] === 'number') {
                     result.width = latentSourceNode.widgets_values[0];
                     result.height = latentSourceNode.widgets_values[1];
                 } else if (typeof latentSourceNode.widgets_values[0] === 'string' && latentSourceNode.widgets_values[0].includes('x')) {
                    const [w, h] = latentSourceNode.widgets_values[0].trim().split('x');
                    result.width = parseInt(w.trim(), 10);
                    result.height = parseInt(h.trim(), 10);
                }
            }
            const modelSamplingNode = findUpstreamNodeByContext(outputNode, ['model'], 'any', nodes, new Set());
            if(modelSamplingNode?.class_type === 'ModelSamplingFlux' && modelSamplingNode.widgets_values) {
                result.width = result.width || modelSamplingNode.widgets_values[2];
                result.height = result.height || modelSamplingNode.widgets_values[3];
            }
        }
    }
    
    for (const node of Object.values(nodes)) {
        const getValue = (key: string) => {
            const input = node.inputs[key];
            return Array.isArray(input) ? traceVal(input, key) : input;
        };

        if(node.class_type.includes("Loader") && !node.class_type.includes("Lora")) {
            const modelName = getValue('ckpt_name') || getValue('unet_name') || getValue('model_name');
            if(modelName && !(result.models as string[]).includes(modelName)) (result.models as string[]).push(modelName);
        }
        if(node.class_type.includes("LoraLoader")) {
            const loraName = getValue('lora_name');
            if(loraName && !(result.loras as string[]).includes(loraName)) (result.loras as string[]).push(loraName);
        }
        if (node.class_type === 'Power Lora Loader (rgthree)') {
            for (const key in node.inputs) {
                if (key.startsWith('lora_')) {
                    const loraInfo = node.inputs[key] as { on?: boolean, lora?: string };
                    if (loraInfo.on && loraInfo.lora && !(result.loras as string[]).includes(loraInfo.lora)) {
                        (result.loras as string[]).push(loraInfo.lora);
                    }
                }
            }
        }
    }
    
    if(result.models && result.models.length > 0) result.model = result.models[0];

    return result;
}

export function parseComfyUIMetadata(metadata: ComfyUIMetadata): BaseMetadata {
    // Step 1: Analyze the graph (Primary Source)
    let result: Partial<BaseMetadata> = {};
    if (metadata.prompt || metadata.workflow) {
        try {
            const promptStr = typeof metadata.prompt === 'string' ? metadata.prompt.replace(/\bNaN\b/g, 'null') : null;
            const workflowStr = typeof metadata.workflow === 'string' ? metadata.workflow.replace(/\bNaN\b/g, 'null') : null;
            
            const promptObj = promptStr ? JSON.parse(promptStr) : metadata.prompt;
            const workflowObj = workflowStr ? JSON.parse(workflowStr) : metadata.workflow;

            result = parseWorkflowAndPrompt(workflowObj, promptObj);
        } catch (e) {
            console.error("Failed to parse ComfyUI workflow/prompt:", e);
        }
    }

    // Step 2: Fallback to Parameters string (Secondary Source)
    if (metadata.parameters && typeof metadata.parameters === 'string') {
        try {
            const paramsData = parseParametersString(metadata.parameters);
            for (const key in paramsData) {
                const typedKey = key as keyof BaseMetadata;
                const graphValue = result[typedKey];
                
                // Only fill if the graph analysis didn't find a value.
                // Crucially, this preserves `0`, `false`, etc. from the graph.
                const isValueMissing = graphValue === undefined || graphValue === null || 
                                     graphValue === '' || (Array.isArray(graphValue) && graphValue.length === 0);

                if (isValueMissing) {
                    (result[typedKey] as any) = paramsData[typedKey];
                }
            }
        } catch (e) {
            console.error("Failed to parse ComfyUI parameters string:", e);
        }
    }

    // Step 3: Sanitize and apply safe defaults
    const sanitizeNumber = (value: any, defaultValue = 0) => {
        const num = Number(value);
        return isNaN(num) ? defaultValue : num;
    };

    return {
        format: 'ComfyUI',
        prompt: result.prompt ?? '',
        negativePrompt: result.negativePrompt ?? '',
        model: result.model ?? (result.models && result.models.length > 0 ? result.models[0] : 'Unknown'),
        width: sanitizeNumber(result.width),
        height: sanitizeNumber(result.height),
        steps: sanitizeNumber(result.steps),
        cfg_scale: sanitizeNumber(result.cfg_scale),
        seed: sanitizeNumber(result.seed),
        scheduler: result.scheduler ?? 'Unknown',
        sampler: result.sampler ?? 'Unknown',
        loras: result.loras ?? [],
        models: result.models ?? [],
    } as BaseMetadata;
}
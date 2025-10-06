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

    // 1. Initialize with workflow data (UI info, links)
    if (workflow?.nodes) {
        for (const node of workflow.nodes) {
            const nodeId = node.id.toString();
            nodeMap[nodeId] = {
                id: nodeId,
                links: node.outputs?.flatMap(output => 
                    (output.links || []).map(linkId => {
                        const targetNode = workflow.nodes.find(n => n.id === linkId);
                        // This structure isn't perfect but captures the essential link info
                        return [node.id, 0, targetNode?.id ?? 0, 0, 'LINK_TYPE', 'LINK_TYPE'] as [number, number, number, number, string, string];
                    })
                ) || [],
                inputs: node.inputs || {},
                class_type: node.type,
                title: (node as any).title || node.properties?.['Node name for S&R'],
                widgets_values: node.widgets_values,
                properties: node.properties,
            };
        }
    }

    // 2. Overlay with prompt data (Execution info)
    for (const [id, promptNode] of Object.entries(prompt)) {
        if (!nodeMap[id]) {
            // Create a stub if the node only exists in the prompt
            nodeMap[id] = {
                id,
                inputs: {},
                class_type: '',
                links: [],
            };
        }
        // Prompt data is the source of truth for execution
        nodeMap[id].inputs = promptNode.inputs;
        nodeMap[id].class_type = promptNode.class_type;
        if (promptNode._meta?.title) {
            nodeMap[id].title = promptNode._meta.title;
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
    const upstreamLink = node.inputs.samples || node.inputs.image || node.inputs.latent || node.inputs.latent_image;
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

/**
 * Finds the source node responsible for the final image generation (e.g., KSampler, UltimateSDUpscale).
 * It starts from an output node (like SaveImage) and traces backwards to find a node with sampler-like inputs.
 * @param outputNode The node that saves or previews the final image.
 * @param nodes The complete map of all nodes in the graph.
 * @returns The source sampler-like node or null if not found.
 */
function findImageSourceNode(outputNode: ParserNode, nodes: NodeMap): ParserNode | null {
    const isSamplerLike = (node: ParserNode): boolean => {
        // A node is considered sampler-like if it has these common parameter inputs.
        // This is a heuristic that should cover KSampler, UltimateSDUpscale, etc.
        const hasSeed = 'seed' in node.inputs;
        const hasSteps = 'steps' in node.inputs;
        const hasCfg = 'cfg' in node.inputs;
        return hasSeed && hasSteps && hasCfg;
    };

    // If the output node itself is the sampler, return it.
    if (isSamplerLike(outputNode)) {
        return outputNode;
    }

    // Start tracing back from the 'images' or 'samples' input of the output node.
    const inputLink = outputNode.inputs.images || outputNode.inputs.samples;
    if (!Array.isArray(inputLink) || inputLink.length < 2) {
        return null;
    }
    
    // The target is any node that looks like a sampler.
    return traceBackToNode(inputLink as Link, nodes, isSamplerLike);
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

    // 2. If no literal value, check if this is a pass-through node and recurse.
    
    // 2a. Handle general pass-through nodes for conditioning, pipes, etc.
    const passThroughTypes = ['Reroute', 'Pipe', 'ConditioningCombine', 'ConditioningSetTimestepRange', 'ConditioningZeroOut', 'ControlNetApplyAdvanced', 'FluxGuidance'];
    if (passThroughTypes.some(type => node.class_type.includes(type))) {
        const primaryInput = node.inputs.conditioning || node.inputs.conditioning_1;
        if (primaryInput) return traceNext(primaryInput);
        
        const secondaryInput = node.inputs.conditioning_2;
        if (secondaryInput) return traceNext(secondaryInput);
        
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
    const valueFields = ['string', 'String', 'int', 'float', 'seed', 'sampler_name', 'scheduler', 'populated_text', 'unet_name', 'ckpt_name', 'model_name', 'lora_name', 'guidance', 'wildcard_text'];
    for (const field of valueFields) {
        if (node.inputs[field] !== undefined) {
            const value = node.inputs[field];
            return Array.isArray(value) ? traceNext(value) : value;
        }
    }
    
    // 3b. Handle special-case nodes like string concatenation or latent dimensions.
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

function parseWorkflowAndPrompt(workflow: ComfyUIWorkflow | null, prompt: ComfyUIPrompt): Partial<BaseMetadata> {
    const result: Partial<BaseMetadata> = { models: [], loras: [] };
    const nodes = createNodeMap(workflow, prompt);

    const traceVal = (input: any, contextHint: string): any => traceNodeValue(input, nodes, contextHint);
    
    const outputNode = findTargetNode(nodes);
    if (outputNode) {
        const imageSourceNode = findImageSourceNode(outputNode, nodes);

        if (imageSourceNode) {
            // Universal Tracing: Apply recursive tracing to ALL parameters, not just prompts.
            // This correctly handles workflows where parameters originate in upstream nodes (e.g., BasicScheduler).
            result.steps = traceVal(imageSourceNode.inputs.steps || imageSourceNode.inputs.sigmas, 'steps');
            result.cfg_scale = traceVal(imageSourceNode.inputs.cfg, 'cfg');
            result.seed = traceVal(imageSourceNode.inputs.seed, 'seed');
            result.sampler = traceVal(imageSourceNode.inputs.sampler_name || imageSourceNode.inputs.sampler, 'sampler');
            result.scheduler = traceVal(imageSourceNode.inputs.scheduler, 'scheduler');

            result.prompt = traceVal(imageSourceNode.inputs.positive, 'positive');
            result.negativePrompt = traceVal(imageSourceNode.inputs.negative, 'negative');

            const sizeVal = traceVal(imageSourceNode.inputs.latent_image, 'latent_image');
            if (sizeVal && typeof sizeVal === 'string' && sizeVal.includes('x')) {
                const [width, height] = sizeVal.split('x');
                result.width = parseInt(width, 10);
                result.height = parseInt(height, 10);
            }
        }
    }

    // Fallback for width/height if not found via sampler
    if (!result.width || !result.height) {
        const latentNode = Object.values(nodes).find(n => n.class_type.includes('Latent'));
        if (latentNode) {
            result.width = Array.isArray(latentNode.inputs.width) ? traceVal(latentNode.inputs.width, 'width') : latentNode.inputs.width;
            result.height = Array.isArray(latentNode.inputs.height) ? traceVal(latentNode.inputs.height, 'height') : latentNode.inputs.height;
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

    // Step 3: Apply safe defaults (Tertiary Source)
    return {
        format: 'ComfyUI',
        prompt: result.prompt ?? '',
        negativePrompt: result.negativePrompt ?? '',
        model: result.model ?? (result.models && result.models.length > 0 ? result.models[0] : 'Unknown'),
        width: result.width ?? 0,
        height: result.height ?? 0,
        steps: result.steps ?? 0,
        cfg_scale: result.cfg_scale ?? 0,
        seed: result.seed ?? 0,
        scheduler: result.scheduler ?? 'Unknown',
        sampler: result.sampler ?? 'Unknown',
        loras: result.loras ?? [],
        models: result.models ?? [],
    } as BaseMetadata;
}
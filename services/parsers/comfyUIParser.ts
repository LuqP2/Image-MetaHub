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
function traceBackToNode(link: Link | undefined, nodes: NodeMap, targetClassType: string, visited: Set<string> = new Set()): ParserNode | null {
    if (!link || !Array.isArray(link) || link.length < 2) return null;

    const [nodeId, outputIndex] = link;
    const visitKey = `${nodeId}:${outputIndex}`;
    if (visited.has(visitKey)) return null; // Cycle detected
    visited.add(visitKey);

    const node = nodes[nodeId];
    if (!node) return null;

    // 1. Check if the current node is the target
    if (node.class_type.includes(targetClassType)) {
        return node;
    }

    // 2. Handle Pass-through nodes (e.g., Reroute) which just forward a single input.
    if (node.class_type.includes('Reroute')) {
        const inputLink = Object.values(node.inputs).find(input => Array.isArray(input));
        if (Array.isArray(inputLink) && inputLink.length >= 2) {
            return traceBackToNode(inputLink as Link, nodes, targetClassType, visited);
        }
    }

    // 3. Trace the primary input for image/latent data (e.g., from a VAEDecode).
    const upstreamLink = node.inputs.samples || node.inputs.image || node.inputs.latent || node.inputs.latent_image;
    if (Array.isArray(upstreamLink) && upstreamLink.length >= 2) {
        return traceBackToNode(upstreamLink as Link, nodes, targetClassType, visited);
    }
    
    // 4. Fallback for other potential pass-through nodes.
    const anyInputLink = Object.values(node.inputs).find(input => Array.isArray(input));
    if (Array.isArray(anyInputLink) && anyInputLink.length >= 2) {
        return traceBackToNode(anyInputLink as Link, nodes, targetClassType, visited);
    }

    return null;
}

/**
 * Finds the source KSampler node responsible for generating the final image.
 * It starts from an output node (like SaveImage) and traces backwards.
 * @param outputNode The node that saves or previews the final image.
 * @param nodes The complete map of all nodes in the graph.
 * @returns The source KSampler node or null if not found.
 */
function findSourceSampler(outputNode: ParserNode, nodes: NodeMap): ParserNode | null {
    // If the output node itself is a sampler, we've found it.
    if (outputNode.class_type.includes('Sampler')) {
        return outputNode;
    }

    // Start tracing back from the 'images' or 'samples' input of the output node.
    const inputLink = outputNode.inputs.images || outputNode.inputs.samples;
    if (!inputLink) {
        return null;
    }
    
    // The target is any kind of Sampler node.
    return traceBackToNode(inputLink, nodes, 'Sampler');
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
    if (visited.has(visitKey)) return null; // Cycle detected
    visited.add(visitKey);

    const node = nodes[nodeId];
    if (!node) return null;
    
    const traceNext = (nextLink: any, newContextHint = contextHint) => {
        return traceNodeValue(nextLink as Link, nodes, newContextHint, visited);
    }

    // 1. Special handling for prompt nodes to get the text directly.
    if (node.class_type.includes('CLIPTextEncode')) {
        // In many workflows (from UI), the text is in widgets_values.
        if (node.widgets_values && node.widgets_values.length > 0 && typeof node.widgets_values[0] === 'string') {
            return node.widgets_values[0];
        }
        // In the API format, the text is in inputs.text.
        if (node.inputs.text) {
            const textValue = node.inputs.text;
            return Array.isArray(textValue) ? traceNext(textValue, 'text') : textValue;
        }
    }

    // 2. Handle Pass-through nodes (Reroute, Pipe, and various Conditioning nodes)
    const passThroughTypes = ['Reroute', 'Pipe', 'ConditioningCombine', 'ConditioningSetTimestepRange', 'ConditioningZeroOut'];
    const isPassThrough = passThroughTypes.some(type => node.class_type.includes(type));
    if (isPassThrough) {
        // For conditioning nodes, the input is 'conditioning' or 'conditioning_1'/'conditioning_2'.
        // For others, it's usually just one input. We prioritize the most likely candidates.
        const primaryInput = node.inputs.conditioning || node.inputs.conditioning_1;
        if (primaryInput && Array.isArray(primaryInput)) {
            return traceNext(primaryInput);
        }
        // Fallback for the second input of a Combine node.
        const secondaryInput = node.inputs.conditioning_2;
         if (secondaryInput && Array.isArray(secondaryInput)) {
            return traceNext(secondaryInput);
        }
        // Generic fallback for any other pass-through that doesn't use a standard name.
        const anyInputLink = Object.values(node.inputs).find(input => Array.isArray(input));
        if (anyInputLink) return traceNext(anyInputLink);
    }

    // 3. Handle Bus nodes
    if (node.class_type.includes('Bus')) {
        const contextInput = node.inputs[contextHint];
        if (contextInput && Array.isArray(contextInput)) {
            return traceNext(contextInput);
        }
        const anyInputLink = Object.values(node.inputs).find(input => Array.isArray(input));
        if (anyInputLink) return traceNext(anyInputLink);
    }

    // 4. Extract literal value from other node types
    const valueFields = ['string', 'String', 'int', 'float', 'seed', 'sampler_name', 'scheduler', 'populated_text', 'unet_name', 'ckpt_name', 'model_name', 'lora_name', 'guidance', 'wildcard_text'];
    for (const field of valueFields) {
        if (node.inputs[field] !== undefined) {
            const value = node.inputs[field];
            return Array.isArray(value) ? traceNext(value) : value;
        }
    }
    
    // 5. Special case for latent dimensions
    if (node.class_type.includes("Latent")) {
        const width = Array.isArray(node.inputs.width) ? traceNext(node.inputs.width, 'width') : node.inputs.width;
        const height = Array.isArray(node.inputs.height) ? traceNext(node.inputs.height, 'height') : node.inputs.height;
        if (width && height) return `${width}x${height}`;
    }
    
    // 6. Special case for string concatenation
    if (node.class_type === 'JWStringConcat') {
        const strA = traceNext(node.inputs.a, 'a') || '';
        const strB = traceNext(node.inputs.b, 'b') || '';
        return `${strA}${strB}`;
    }

    // 7. Fallback to widget values for non-text nodes
    if (node.widgets_values && node.widgets_values.length > outputIndex) {
        return node.widgets_values[outputIndex];
    }

    // 8. Final fallback: try to trace any input link
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
        const samplerNode = findSourceSampler(outputNode, nodes);

        if (samplerNode) {
            const getSamplerValue = (key: string) => {
                const input = samplerNode.inputs[key];
                // If the input is a link, trace it. Otherwise, it's a literal value.
                return Array.isArray(input) ? traceVal(input, key) : input;
            };

            result.steps = getSamplerValue('steps');
            result.cfg_scale = getSamplerValue('cfg');
            result.seed = getSamplerValue('seed');
            result.sampler = getSamplerValue('sampler_name');
            result.scheduler = getSamplerValue('scheduler');

            result.prompt = traceVal(samplerNode.inputs.positive, 'positive');
            result.negativePrompt = traceVal(samplerNode.inputs.negative, 'negative');

            const sizeVal = traceVal(samplerNode.inputs.latent_image, 'latent_image');
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
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

    // Helper for recursive calls
    const traceNext = (nextLink: any, newContextHint = contextHint) => {
        return traceNodeValue(nextLink as Link, nodes, newContextHint, visited);
    }

    // 1. Handle Pass-through nodes (Reroute, Pipe, etc.)
    const isPassThrough = ['Reroute', 'Pipe'].some(type => node.class_type.includes(type));
    if (isPassThrough) {
        const inputLink = Object.values(node.inputs).find(input => Array.isArray(input));
        if (inputLink) return traceNext(inputLink);
    }

    // 2. Handle Bus nodes
    if (node.class_type.includes('Bus')) {
        const contextInput = node.inputs[contextHint];
        if (contextInput && Array.isArray(contextInput)) {
            return traceNext(contextInput);
        }
        // If direct context not found, try to find any link and continue tracing
        const anyInputLink = Object.values(node.inputs).find(input => Array.isArray(input));
        if (anyInputLink) return traceNext(anyInputLink);
    }

    // 3. Extract literal value from the node
    const valueFields = ['text', 'string', 'String', 'int', 'float', 'seed', 'sampler_name', 'scheduler', 'populated_text', 'unet_name', 'ckpt_name', 'model_name', 'lora_name', 'guidance', 'wildcard_text'];
    for (const field of valueFields) {
        if (node.inputs[field] !== undefined) {
            const value = node.inputs[field];
            return Array.isArray(value) ? traceNext(value) : value;
        }
    }
    
    // 4. Special case for latent dimensions
    if (node.class_type.includes("Latent")) {
        const width = Array.isArray(node.inputs.width) ? traceNext(node.inputs.width, 'width') : node.inputs.width;
        const height = Array.isArray(node.inputs.height) ? traceNext(node.inputs.height, 'height') : node.inputs.height;
        if (width && height) return `${width}x${height}`;
    }
    
    // 5. Special case for string concatenation
    if (node.class_type === 'JWStringConcat') {
        const strA = traceNext(node.inputs.a, 'a') || '';
        const strB = traceNext(node.inputs.b, 'b') || '';
        return `${strA}${strB}`;
    }

    // 6. Fallback to widget values
    if (node.widgets_values && node.widgets_values.length > outputIndex) {
        return node.widgets_values[outputIndex];
    }

    // 7. Final fallback: try to trace any input link
    const anyInputLink = Object.values(node.inputs).find(input => Array.isArray(input));
    if (anyInputLink) return traceNext(anyInputLink);
    
    return null;
}

function parseWorkflowAndPrompt(workflow: ComfyUIWorkflow | null, prompt: ComfyUIPrompt): Partial<BaseMetadata> {
    const result: Partial<BaseMetadata> = { models: [], loras: [] };
    const nodes = createNodeMap(workflow, prompt);

    const getVal = (input: any, contextHint: string): any => traceNodeValue(input, nodes, contextHint);
    
    const targetNode = findTargetNode(nodes);
    if (targetNode) {
        result.prompt = getVal(targetNode.inputs.positive, 'positive');
        result.negativePrompt = getVal(targetNode.inputs.negative, 'negative');
        result.steps = getVal(targetNode.inputs.steps, 'steps');
        result.cfg_scale = getVal(targetNode.inputs.cfg, 'cfg');
        result.seed = getVal(targetNode.inputs.seed || targetNode.inputs.seed_value, 'seed');
        result.sampler = getVal(targetNode.inputs.sampler_name, 'sampler_name');
        result.scheduler = getVal(targetNode.inputs.scheduler, 'scheduler');
        
        const sizeVal = getVal(targetNode.inputs.latent_image, 'latent_image') || getVal(targetNode.inputs.image, 'image');
        if (sizeVal && typeof sizeVal === 'string' && sizeVal.includes('x')) {
            const [width, height] = sizeVal.split('x');
            result.width = parseInt(width, 10);
            result.height = parseInt(height, 10);
        }
    }

    // Fallback for width/height if not found via target node
    if (!result.width || !result.height) {
        const latentNode = Object.values(nodes).find(n => n.class_type.includes('Latent'));
        if (latentNode) {
            result.width = getVal(latentNode.inputs.width, 'width');
            result.height = getVal(latentNode.inputs.height, 'height');
        }
    }
    
    for (const node of Object.values(nodes)) {
        if(node.class_type.includes("Loader") && !node.class_type.includes("Lora")) {
            const modelName = getVal(node.inputs.ckpt_name, 'ckpt_name') || getVal(node.inputs.unet_name, 'unet_name') || getVal(node.inputs.model_name, 'model_name') || node.inputs.ckpt_name || node.inputs.unet_name || node.inputs.model_name;
            if(modelName && !(result.models as string[]).includes(modelName)) (result.models as string[]).push(modelName);
        }
        if(node.class_type.includes("LoraLoader")) {
            const loraName = getVal(node.inputs.lora_name, 'lora_name') || node.inputs.lora_name;
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
    if (metadata.prompt) {
        try {
            const promptObj = typeof metadata.prompt === 'string' ? JSON.parse(metadata.prompt) : metadata.prompt;
            const workflowObj = metadata.workflow ? (typeof metadata.workflow === 'string' ? JSON.parse(metadata.workflow) : metadata.workflow) : null;
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
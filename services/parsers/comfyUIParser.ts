import { ComfyUIMetadata, BaseMetadata, ComfyUIWorkflow, ComfyUIPrompt, ComfyUINode } from '../../types';

type Link = [string, number];

interface ParserNode {
  id: string;
  inputs: Record<string, any>;
  class_type: string;
  title?: string;
  properties?: Record<string, any>;
  widgets_values?: any[];
}
type NodeMap = { [id: string]: ParserNode };

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

function traceNodeValue(link: Link | undefined, nodes: NodeMap, visited: Set<string> = new Set()): any {
    if (!link || !Array.isArray(link) || link.length < 2) return null;
    
    const [nodeId, outputIndex] = link;
    const visitKey = `${nodeId}:${outputIndex}`;
    if (visited.has(visitKey)) return null;
    visited.add(visitKey);

    const node = nodes[nodeId];
    if (!node) return null;

    const getNestedValue = (input: unknown): any => {
        if (Array.isArray(input) && typeof input[0] === 'string') {
            return traceNodeValue(input as Link, nodes, new Set(visited));
        }
        return input;
    }
    
    const valueFields = ['text', 'string', 'String', 'int', 'float', 'seed', 'sampler_name', 'scheduler', 'populated_text', 'unet_name', 'ckpt_name', 'model_name', 'lora_name', 'guidance', 'wildcard_text'];
    for (const field of valueFields) {
        if (node.inputs[field] !== undefined) {
            return getNestedValue(node.inputs[field]);
        }
    }
    
    if (node.class_type.includes("Latent")) {
        const width = getNestedValue(node.inputs.width);
        const height = getNestedValue(node.inputs.height);
        if (width && height) return `${width}x${height}`;
        
        const resolution = getNestedValue(node.inputs.resolution) || getNestedValue(node.inputs.dimensions);
        if (resolution && typeof resolution === 'string') {
            const match = resolution.match(/(\d+)\s*x\s*(\d+)/);
            if (match) return `${match[1]}x${match[2]}`;
        }
    }
    
    if (node.class_type === 'JWStringConcat') {
        const strA = traceNodeValue(node.inputs.a, nodes, new Set(visited)) || '';
        const strB = traceNodeValue(node.inputs.b, nodes, new Set(visited)) || '';
        return `${strA}${strB}`;
    }

    if (node.widgets_values && node.widgets_values.length > outputIndex) {
        return node.widgets_values[outputIndex];
    }

    for (const key in node.inputs) {
        if (Array.isArray(node.inputs[key])) {
            const val = getNestedValue(node.inputs[key]);
            if (val) return val;
        }
    }
    
    return null;
}

function parseWorkflowAndPrompt(workflow: ComfyUIWorkflow | null, prompt: ComfyUIPrompt): Partial<BaseMetadata> {
    const result: Partial<BaseMetadata> = { models: [], loras: [] };
    const nodes: NodeMap = {};

    if (workflow?.nodes) {
        workflow.nodes.forEach(node => {
            nodes[node.id.toString()] = {
                id: node.id.toString(),
                inputs: node.inputs || {},
                class_type: node.type,
                title: (node as any).title || node.properties?.['Node name for S&R'],
                widgets_values: node.widgets_values,
                properties: node.properties,
            };
        });
    }

    Object.entries(prompt).forEach(([id, promptNode]) => {
        if (!nodes[id]) nodes[id] = { id, inputs: {}, class_type: '' };
        nodes[id].inputs = promptNode.inputs;
        nodes[id].class_type = promptNode.class_type;
        if (promptNode._meta?.title) nodes[id].title = promptNode._meta.title;
    });

    const getVal = (input: any): any => traceNodeValue(input, nodes);
    
    const saverNode = Object.values(nodes).find(n => n.class_type.includes('Save'));
    if (saverNode) {
        result.prompt = getVal(saverNode.inputs.positive);
        result.negativePrompt = getVal(saverNode.inputs.negative);
        result.steps = getVal(saverNode.inputs.steps);
        result.cfg_scale = getVal(saverNode.inputs.cfg);
        result.seed = getVal(saverNode.inputs.seed || saverNode.inputs.seed_value);
        result.sampler = getVal(saverNode.inputs.sampler_name);
        result.scheduler = getVal(saverNode.inputs.scheduler);
        
        const width = getVal(saverNode.inputs.width);
        const height = getVal(saverNode.inputs.height);
        if (width && height) {
            result.width = width;
            result.height = height;
        }
    }

    if (!result.width || !result.height) {
        const latentNode = Object.values(nodes).find(n => n.class_type.includes('Latent'));
        if (latentNode) {
            const dims = getVal(latentNode.inputs.resolution) || getVal(latentNode.inputs.dimensions);
            if (dims && typeof dims === 'string') {
                const match = dims.match(/(\d+)\s*x\s*(\d+)/);
                if (match) {
                    result.width = parseInt(match[1].trim(), 10);
                    result.height = parseInt(match[2].trim(), 10);
                }
            } else {
                result.width = getVal(latentNode.inputs.width);
                result.height = getVal(latentNode.inputs.height);
            }
        }
    }
    
    for (const node of Object.values(nodes)) {
        if(node.class_type.includes("Loader") && !node.class_type.includes("Lora")) {
            const modelName = getVal(node.inputs.ckpt_name) || getVal(node.inputs.unet_name) || getVal(node.inputs.model_name) || node.inputs.ckpt_name || node.inputs.unet_name || node.inputs.model_name;
            if(modelName && !(result.models as string[]).includes(modelName)) (result.models as string[]).push(modelName);
        }
        if(node.class_type.includes("LoraLoader")) {
            const loraName = getVal(node.inputs.lora_name) || node.inputs.lora_name;
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
    let parsedData: Partial<BaseMetadata> = {};

    if (metadata.prompt) {
        const promptObj = typeof metadata.prompt === 'string' ? JSON.parse(metadata.prompt) : metadata.prompt;
        const workflowObj = metadata.workflow ? (typeof metadata.workflow === 'string' ? JSON.parse(metadata.workflow) : metadata.workflow) : null;
        const workflowParsedData = parseWorkflowAndPrompt(workflowObj, promptObj);
        parsedData = { ...parsedData, ...workflowParsedData };
    }

    if (metadata.parameters && typeof metadata.parameters === 'string') {
        const paramsData = parseParametersString(metadata.parameters);
        Object.keys(paramsData).forEach(key => {
            const typedKey = key as keyof BaseMetadata;
            const paramsValue = paramsData[typedKey];
            const workflowValue = parsedData[typedKey];
            
            if (paramsValue !== undefined && (workflowValue === undefined || workflowValue === null || (Array.isArray(workflowValue) && workflowValue.length === 0) || workflowValue === 0 || workflowValue === '' )) {
                (parsedData[typedKey] as any) = paramsValue;
            }
        });
    }

    return {
        format: 'ComfyUI',
        prompt: parsedData.prompt ?? '',
        negativePrompt: parsedData.negativePrompt ?? '',
        model: parsedData.model ?? 'Unknown',
        width: parsedData.width ?? 0,
        height: parsedData.height ?? 0,
        steps: parsedData.steps ?? 0,
        cfg_scale: parsedData.cfg_scale ?? 0,
        seed: parsedData.seed ?? 0,
        scheduler: parsedData.scheduler ?? 'Unknown',
        sampler: parsedData.sampler ?? 'Unknown',
        loras: parsedData.loras ?? [],
        models: parsedData.models ?? [],
    } as BaseMetadata;
}
import { ComfyUIMetadata, BaseMetadata } from '../../types';

// --- Extraction Functions ---

export function extractModelsFromComfyUI(metadata: ComfyUIMetadata): string[] {
    const models: Set<string> = new Set();
    const dataSource = metadata.prompt || metadata.workflow;
    if (!dataSource) return [];

    const sourceObj = typeof dataSource === 'string' ? JSON.parse(dataSource) : dataSource;

    for (const node of Object.values(sourceObj.nodes || sourceObj)) {
        const classType = (node as any).class_type || (node as any).type;
        if (classType && classType.toLowerCase().includes('checkpoint')) {
            const ckptName = (node as any).inputs?.ckpt_name;
            if (ckptName) models.add(ckptName);
        }
    }
    return Array.from(models);
}

export function extractLorasFromComfyUI(metadata: ComfyUIMetadata): string[] {
    const loras: Set<string> = new Set();
    const dataSource = metadata.prompt || metadata.workflow;
    if (!dataSource) return [];

    const sourceObj = typeof dataSource === 'string' ? JSON.parse(dataSource) : dataSource;

    for (const node of Object.values(sourceObj.nodes || sourceObj)) {
        const classType = (node as any).class_type || (node as any).type;
        if (classType && classType.toLowerCase().includes('lora')) {
            const loraName = (node as any).inputs?.lora_name;
            if (loraName) loras.add(loraName);
        }
    }
    return Array.from(loras);
}

export function extractSchedulerFromComfyUI(metadata: ComfyUIMetadata): string {
    const dataSource = metadata.prompt || metadata.workflow;
    if (!dataSource) return 'Unknown';

    const sourceObj = typeof dataSource === 'string' ? JSON.parse(dataSource) : dataSource;

    for (const node of Object.values(sourceObj.nodes || sourceObj)) {
        const classType = (node as any).class_type || (node as any).type;
        if (classType && classType.toLowerCase().includes('sampler')) {
            const scheduler = (node as any).inputs?.scheduler || (node as any).inputs?.sampler_name;
            if (scheduler) return scheduler;
        }
    }
    return 'Unknown';
}


// --- Main Parser Function ---

export function parseComfyUIMetadata(metadata: ComfyUIMetadata): BaseMetadata {
    const result: Partial<BaseMetadata> = {
        models: [],
        loras: [],
    };
    const dataSource = metadata.prompt || metadata.workflow;
    if (!dataSource) return result as BaseMetadata;

    const sourceObj = typeof dataSource === 'string' ? JSON.parse(dataSource) : dataSource;
    const nodes = sourceObj.nodes || sourceObj;

    for (const node of Object.values(nodes)) {
        const n = node as any;
        const classType = n.class_type || n.type;
        const inputs = n.inputs || {};

        if (classType?.toLowerCase().includes('sampler')) {
            result.steps = inputs.steps;
            result.cfg_scale = inputs.cfg;
            result.scheduler = inputs.scheduler || inputs.sampler_name;
            result.seed = inputs.seed;
        }
        if (classType?.toLowerCase().includes('checkpoint')) {
            if(inputs.ckpt_name) (result.models as string[]).push(inputs.ckpt_name);
        }
        if (classType?.toLowerCase().includes('lora')) {
            if(inputs.lora_name) (result.loras as string[]).push(inputs.lora_name);
        }
        if (classType?.toLowerCase().includes('cliptextencode')) {
             // Basic heuristic to distinguish positive/negative prompts
            if (JSON.stringify(inputs).toLowerCase().includes('negative')) {
                result.negativePrompt = inputs.text;
            } else {
                result.prompt = inputs.text;
            }
        }
        if (classType === 'EmptyLatentImage') {
            result.width = inputs.width;
            result.height = inputs.height;
        }
    }

    if (result.models && result.models.length > 0) {
        result.model = result.models[0];
    }

    return result as BaseMetadata;
}
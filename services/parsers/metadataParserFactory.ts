import { ImageMetadata, BaseMetadata, ComfyUIMetadata, InvokeAIMetadata, Automatic1111Metadata } from '../../types';
import { parseInvokeAIMetadata } from './invokeAIParser';
import { parseA1111Metadata } from './automatic1111Parser';
import { resolvePromptFromGraph } from './comfyUIParser';

function sanitizeJson(jsonString: string): string {
    // Replace NaN with null, as NaN is not valid JSON
    return jsonString.replace(/:\s*NaN/g, ': null');
}

interface ParserModule {
    parse: (metadata: any) => BaseMetadata;
}

export function getMetadataParser(metadata: ImageMetadata): ParserModule | null {
    if ('workflow' in metadata || ('prompt' in metadata && typeof metadata.prompt === 'object')) {
        return {
            parse: (data: ComfyUIMetadata) => {
                // Parse workflow and prompt if they are strings
                let workflow = data.workflow;
                let prompt = data.prompt;
                try {
                    if (typeof workflow === 'string') {
                        workflow = JSON.parse(sanitizeJson(workflow));
                    }
                    if (typeof prompt === 'string') {
                        prompt = JSON.parse(sanitizeJson(prompt));
                    }
                } catch (e) {
                    console.error("Failed to parse ComfyUI workflow/prompt JSON:", e);
                }
                const resolvedParams = resolvePromptFromGraph(workflow, prompt);
                return {
                    prompt: resolvedParams.prompt || '',
                    negativePrompt: resolvedParams.negativePrompt || '',
                    model: resolvedParams.model || '',
                    models: resolvedParams.model ? [resolvedParams.model] : [],
                    width: resolvedParams.width || 0,
                    height: resolvedParams.height || 0,
                    seed: resolvedParams.seed,
                    steps: resolvedParams.steps || 0,
                    cfg_scale: resolvedParams.cfg,
                    scheduler: resolvedParams.scheduler || '',
                    sampler: resolvedParams.sampler_name || '',
                    loras: Array.isArray(resolvedParams.lora) ? resolvedParams.lora : (resolvedParams.lora ? [resolvedParams.lora] : []),
                } as BaseMetadata;
            }
        };
    }
    if ('invokeai_metadata' in metadata) {
        return { parse: (data: InvokeAIMetadata) => parseInvokeAIMetadata(data) };
    }
    if ('parameters' in metadata && typeof metadata.parameters === 'string') {
        return { parse: (data: Automatic1111Metadata) => parseA1111Metadata(data.parameters) };
    }
    return null;
}

export function parseImageMetadata(metadata: ImageMetadata): BaseMetadata | null {
    const parser = getMetadataParser(metadata);
    if (parser) {
        return parser.parse(metadata);
    }
    return null;
}
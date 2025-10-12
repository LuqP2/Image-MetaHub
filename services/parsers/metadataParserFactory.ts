import { ImageMetadata, BaseMetadata, ComfyUIMetadata, InvokeAIMetadata, Automatic1111Metadata, SwarmUIMetadata, EasyDiffusionMetadata, EasyDiffusionJson, MidjourneyMetadata, ForgeMetadata, DalleMetadata } from '../../types';
import { parseInvokeAIMetadata } from './invokeAIParser';
import { parseA1111Metadata } from './automatic1111Parser';
import { parseSwarmUIMetadata } from './swarmUIParser';
import { parseEasyDiffusionMetadata, parseEasyDiffusionJson } from './easyDiffusionParser';
import { parseMidjourneyMetadata } from './midjourneyParser';
import { parseForgeMetadata } from './forgeParser';
import { parseDalleMetadata } from './dalleParser';
import { resolvePromptFromGraph } from './comfyUIParser';

function sanitizeJson(jsonString: string): string {
    // Replace NaN with null, as NaN is not valid JSON
    return jsonString.replace(/:\s*NaN/g, ': null');
}

interface ParserModule {
    parse: (metadata: any) => BaseMetadata;
}

export function getMetadataParser(metadata: ImageMetadata): ParserModule | null {
    // Check for DALL-E C2PA/EXIF metadata first (most specific)
    if ('c2pa_manifest' in metadata || 
        ('exif_data' in metadata && typeof metadata.exif_data === 'object') ||
        ('prompt' in metadata && 'model_version' in metadata && 
         (metadata.model_version?.includes('dall-e') || metadata.model_version?.includes('DALL-E')))) {
        return { parse: (data: DalleMetadata) => parseDalleMetadata(data) };
    }
    
    if ('sui_image_params' in metadata) {
        return { parse: (data: SwarmUIMetadata) => parseSwarmUIMetadata(data) };
    }
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
    if ('parameters' in metadata && 
        typeof metadata.parameters === 'string' && 
        metadata.parameters.includes('Prompt:') && 
        !('sui_image_params' in metadata) && 
        !metadata.parameters.includes('Model hash:')) {
        return { parse: (data: EasyDiffusionMetadata) => parseEasyDiffusionMetadata(data.parameters) };
    }
    if ('prompt' in metadata && typeof metadata.prompt === 'string' && !('parameters' in metadata)) {
        return { parse: (data: EasyDiffusionJson) => parseEasyDiffusionJson(data) };
    }
    if ('parameters' in metadata && 
        typeof metadata.parameters === 'string' && 
        (metadata.parameters.includes('Midjourney') || 
         metadata.parameters.includes('--v') || 
         metadata.parameters.includes('--ar') ||
         metadata.parameters.includes('--q') ||
         metadata.parameters.includes('--s'))) {
        return { parse: (data: MidjourneyMetadata) => parseMidjourneyMetadata(data.parameters) };
    }
    if ('parameters' in metadata && 
        typeof metadata.parameters === 'string' && 
        (metadata.parameters.includes('Forge') || 
         metadata.parameters.includes('Gradio') ||
         (metadata.parameters.includes('Steps:') && 
          metadata.parameters.includes('Sampler:') && 
          metadata.parameters.includes('Model hash:')))) {
        return { parse: (data: ForgeMetadata) => parseForgeMetadata(data) };
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
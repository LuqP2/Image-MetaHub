import { ImageMetadata, BaseMetadata, ComfyUIMetadata, InvokeAIMetadata, Automatic1111Metadata, SwarmUIMetadata, EasyDiffusionMetadata, EasyDiffusionJson, MidjourneyMetadata, NijiMetadata, ForgeMetadata, DalleMetadata, DreamStudioMetadata, FireflyMetadata, DrawThingsMetadata, FooocusMetadata } from '../../types';
import { parseInvokeAIMetadata } from './invokeAIParser';
import { parseA1111Metadata } from './automatic1111Parser';
import { parseSwarmUIMetadata } from './swarmUIParser';
import { parseEasyDiffusionMetadata, parseEasyDiffusionJson } from './easyDiffusionParser';
import { parseMidjourneyMetadata } from './midjourneyParser';
import { parseNijiMetadata } from './nijiParser';
import { parseForgeMetadata } from './forgeParser';
import { parseDalleMetadata } from './dalleParser';
import { parseFireflyMetadata } from './fireflyParser';
import { parseDreamStudioMetadata } from './dreamStudioParser';
import { parseDrawThingsMetadata } from './drawThingsParser';
import { parseFooocusMetadata } from './fooocusParser';
import { resolvePromptFromGraph } from './comfyUIParser';

function sanitizeJson(jsonString: string): string {
    // Replace NaN with null, as NaN is not valid JSON
    return jsonString.replace(/:\s*NaN/g, ': null');
}

interface ParserModule {
    parse: (metadata: any, fileBuffer?: ArrayBuffer) => BaseMetadata;
    generator: string;
}

export function getMetadataParser(metadata: ImageMetadata): ParserModule | null {
    // Check for DALL-E C2PA/EXIF metadata first (most specific)
    if ('c2pa_manifest' in metadata || 
        ('exif_data' in metadata && typeof metadata.exif_data === 'object') ||
        ('prompt' in metadata && 'model_version' in metadata && 
         (metadata.model_version?.includes('dall-e') || metadata.model_version?.includes('DALL-E')))) {
        console.log('🎯 Selected parser: DALL-E');
        return { parse: (data: DalleMetadata) => parseDalleMetadata(data), generator: 'DALL-E' };
    }

    // Check for Adobe Firefly C2PA/EXIF metadata (after DALL-E, similar structure)
    if ('c2pa_manifest' in metadata) {
        const manifest = metadata.c2pa_manifest as any;
        if (manifest?.['adobe:firefly'] || 
            (typeof manifest === 'string' && manifest.includes('adobe:firefly')) ||
            (manifest?.['c2pa.actions'] && JSON.stringify(manifest['c2pa.actions']).includes('firefly'))) {
            return { parse: (data: FireflyMetadata, fileBuffer?: ArrayBuffer) => parseFireflyMetadata(data, fileBuffer!), generator: 'Adobe Firefly' };
        }
    }
    if ('exif_data' in metadata && typeof metadata.exif_data === 'object') {
        const exif = metadata.exif_data as any;
        if (exif?.['adobe:firefly'] || exif?.Software?.includes('Firefly')) {
            return { parse: (data: FireflyMetadata, fileBuffer?: ArrayBuffer) => parseFireflyMetadata(data, fileBuffer!), generator: 'Adobe Firefly' };
        }
    }
    if ('firefly_version' in metadata || ('ai_generated' in metadata && metadata.ai_generated === true)) {
        return { parse: (data: FireflyMetadata, fileBuffer?: ArrayBuffer) => parseFireflyMetadata(data, fileBuffer!), generator: 'Adobe Firefly' };
    }
    
    if ('sui_image_params' in metadata) {
        return { parse: (data: SwarmUIMetadata) => parseSwarmUIMetadata(data), generator: 'SwarmUI' };
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
            },
            generator: 'ComfyUI'
        };
    }
    if ('invokeai_metadata' in metadata) {
        return { parse: (data: InvokeAIMetadata) => parseInvokeAIMetadata(data), generator: 'InvokeAI' };
    }
    // Check for Fooocus (before general A1111 detection)
    if ('parameters' in metadata && 
        typeof metadata.parameters === 'string' && 
        (metadata.parameters.includes('Fooocus') ||
         metadata.parameters.match(/Version:\s*f2\./i) ||
         metadata.parameters.match(/Model:\s*flux/i) ||
         metadata.parameters.includes('Distilled CFG Scale') ||
         metadata.parameters.match(/Module\s*1:\s*ae/i))) {
        console.log('🎯 Selected parser: Fooocus');
        console.log('   Fooocus detection reasons:');
        console.log(`   - Contains 'Fooocus': ${metadata.parameters.includes('Fooocus')}`);
        console.log(`   - Contains 'Version: f2.': ${!!metadata.parameters.match(/Version:\s*f2\./i)}`);
        console.log(`   - Contains 'Model: flux': ${!!metadata.parameters.match(/Model:\s*flux/i)}`);
        console.log(`   - Contains 'Distilled CFG Scale': ${metadata.parameters.includes('Distilled CFG Scale')}`);
        console.log(`   - Contains 'Module 1: ae': ${!!metadata.parameters.match(/Module\s*1:\s*ae/i)}`);
        return { parse: (data: FooocusMetadata) => parseFooocusMetadata(data), generator: 'Fooocus' };
    }
    if ('parameters' in metadata && typeof metadata.parameters === 'string') {
        return { parse: (data: Automatic1111Metadata) => parseA1111Metadata(data.parameters), generator: 'Automatic1111' };
    }
    if ('parameters' in metadata && 
        typeof metadata.parameters === 'string' && 
        (metadata.parameters.includes('DreamStudio') || 
         metadata.parameters.includes('Stability AI') ||
         (metadata.parameters.includes('Prompt:') && 
          metadata.parameters.includes('Negative prompt:') && 
          metadata.parameters.includes('Steps:') && 
          metadata.parameters.includes('Guidance:') &&
          !metadata.parameters.includes('Model hash:') &&
          !metadata.parameters.includes('Forge') &&
          !metadata.parameters.includes('Gradio')))) {
        return { parse: (data: DreamStudioMetadata) => parseDreamStudioMetadata(data.parameters), generator: 'DreamStudio' };
    }
    // Check for Draw Things (iOS/Mac AI app) - after DreamStudio, similar format
    if ('parameters' in metadata && 
        typeof metadata.parameters === 'string' && 
        (metadata.parameters.includes('iPhone') || 
         metadata.parameters.includes('iPad') || 
         metadata.parameters.includes('iPod') ||
         metadata.parameters.includes('Draw Things') ||
         (metadata.parameters.includes('Prompt:') && 
          metadata.parameters.includes('Steps:') && 
          metadata.parameters.includes('CFG scale:') &&
          !metadata.parameters.includes('Model hash:') &&
          !metadata.parameters.includes('Forge') &&
          !metadata.parameters.includes('Gradio') &&
          !metadata.parameters.includes('DreamStudio') &&
          !metadata.parameters.includes('Stability AI') &&
          !metadata.parameters.includes('--niji') &&
          !metadata.parameters.includes('Midjourney')))) {
        return { parse: (data: DrawThingsMetadata) => parseDrawThingsMetadata(data.parameters), generator: 'Draw Things' };
    }
    if ('parameters' in metadata && 
        typeof metadata.parameters === 'string' && 
        metadata.parameters.includes('Prompt:') && 
        !('sui_image_params' in metadata) && 
        !metadata.parameters.includes('Model hash:')) {
        return { parse: (data: EasyDiffusionMetadata) => parseEasyDiffusionMetadata(data.parameters), generator: 'Easy Diffusion' };
    }
    if ('prompt' in metadata && typeof metadata.prompt === 'string' && !('parameters' in metadata)) {
        return { parse: (data: EasyDiffusionJson) => parseEasyDiffusionJson(data), generator: 'Easy Diffusion' };
    }
    if ('parameters' in metadata && 
        typeof metadata.parameters === 'string' && 
        (metadata.parameters.includes('Midjourney') || 
         metadata.parameters.includes('--v') || 
         metadata.parameters.includes('--ar') ||
         metadata.parameters.includes('--q') ||
         metadata.parameters.includes('--s'))) {
        return { parse: (data: MidjourneyMetadata) => parseMidjourneyMetadata(data.parameters), generator: 'Midjourney' };
    }
    if ('parameters' in metadata && 
        typeof metadata.parameters === 'string' && 
        metadata.parameters.includes('--niji')) {
        return { parse: (data: NijiMetadata) => parseNijiMetadata(data.parameters), generator: 'Niji' };
    }
    if ('parameters' in metadata && 
        typeof metadata.parameters === 'string' && 
        (metadata.parameters.includes('Forge') || 
         metadata.parameters.includes('Gradio') ||
         (metadata.parameters.includes('Steps:') && 
          metadata.parameters.includes('Sampler:') && 
          metadata.parameters.includes('Model hash:')))) {
        return { parse: (data: ForgeMetadata) => parseForgeMetadata(data), generator: 'Forge' };
    }
    
    console.log('❌ No parser found for metadata');
    return null;
}

export function parseImageMetadata(metadata: ImageMetadata, fileBuffer?: ArrayBuffer): BaseMetadata | null {
    const parser = getMetadataParser(metadata);
    if (parser) {
        const result = parser.parse(metadata, fileBuffer);
        result.generator = parser.generator;
        return result;
    }
    return null;
}
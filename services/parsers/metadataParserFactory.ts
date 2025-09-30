import { ImageMetadata, BaseMetadata, ComfyUIMetadata, InvokeAIMetadata, Automatic1111Metadata } from '../../types';
import { parseInvokeAIMetadata } from './invokeAIParser';
import { parseA1111Metadata } from './automatic1111Parser';
import { parseComfyUIMetadata } from './comfyUIParser';

interface ParserModule {
    parse: (metadata: any) => BaseMetadata;
}

export function getMetadataParser(metadata: ImageMetadata): ParserModule | null {
    if ('workflow' in metadata || ('prompt' in metadata && typeof metadata.prompt === 'object')) {
        return { parse: (data: ComfyUIMetadata) => parseComfyUIMetadata(data) };
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
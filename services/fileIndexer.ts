import { type IndexedImage, type ImageMetadata, isInvokeAIMetadata, isAutomatic1111Metadata, isComfyUIMetadata, BaseMetadata } from '../types';
import { parse } from 'exifr';
import { parseImageMetadata as parseMetadataWithFactory, getMetadataParser } from './parsers/metadataParserFactory';
import { extractModelsFromInvokeAI, extractLorasFromInvokeAI, extractBoardFromInvokeAI } from './parsers/invokeAIParser';
import { extractModelsFromAutomatic1111, extractLorasFromAutomatic1111 } from './parsers/automatic1111Parser';
import { extractModelsFromComfyUI, extractLorasFromComfyUI, extractSchedulerFromComfyUI } from './parsers/comfyUIParser';

// --- High-Level Extraction Functions (using format-specific parsers) ---

export function extractModels(metadata: ImageMetadata): string[] {
    if (isInvokeAIMetadata(metadata)) return extractModelsFromInvokeAI(metadata);
    if (isAutomatic1111Metadata(metadata)) return extractModelsFromAutomatic1111(metadata);
    if (isComfyUIMetadata(metadata)) return extractModelsFromComfyUI(metadata);
    return [];
}

export function extractLoras(metadata: ImageMetadata): string[] {
    if (isInvokeAIMetadata(metadata)) return extractLorasFromInvokeAI(metadata);
    if (isAutomatic1111Metadata(metadata)) return extractLorasFromAutomatic1111(metadata);
    if (isComfyUIMetadata(metadata)) return extractLorasFromComfyUI(metadata);
    return [];
}

export function extractScheduler(metadata: ImageMetadata): string {
    if (isInvokeAIMetadata(metadata)) return metadata.scheduler || 'Unknown';
    if (isAutomatic1111Metadata(metadata)) {
        const samplerMatch = metadata.parameters.match(/Sampler:\s*([^,]+)/i);
        return samplerMatch ? samplerMatch[1].trim() : 'Unknown';
    }
    if (isComfyUIMetadata(metadata)) return extractSchedulerFromComfyUI(metadata);
    return 'Unknown';
}

export function extractBoard(metadata: ImageMetadata): string {
    if (isInvokeAIMetadata(metadata)) return extractBoardFromInvokeAI(metadata);
    return 'Uncategorized';
}

export function extractPrompt(metadata: ImageMetadata): string {
    const normalized = parseMetadataWithFactory(metadata);
    return normalized?.prompt || '';
}

export function extractNegativePrompt(metadata: ImageMetadata): string | undefined {
    const normalized = parseMetadataWithFactory(metadata);
    return normalized?.negativePrompt;
}

export function extractCfgScale(metadata: ImageMetadata): number | undefined {
    const normalized = parseMetadataWithFactory(metadata);
    return normalized?.cfg_scale;
}

export function extractSteps(metadata: ImageMetadata): number | undefined {
    const normalized = parseMetadataWithFactory(metadata);
    return normalized?.steps;
}

export function extractSeed(metadata: ImageMetadata): number | undefined {
    const normalized = parseMetadataWithFactory(metadata);
    return normalized?.seed;
}

export function extractDimensions(metadata: ImageMetadata): string | undefined {
    const normalized = parseMetadataWithFactory(metadata);
    if (normalized?.width && normalized?.height) {
        return `${normalized.width}x${normalized.height}`;
    }
    return undefined;
}


// --- Core File Processing ---

async function parsePNGMetadata(buffer: ArrayBuffer): Promise<ImageMetadata | null> {
    const view = new DataView(buffer);
    let offset = 8;
    const decoder = new TextDecoder();
    const chunks: { [key: string]: string } = {};

    while (offset < buffer.byteLength) {
        const length = view.getUint32(offset);
        const type = decoder.decode(buffer.slice(offset + 4, offset + 8));

        if (type === 'tEXt') {
            const chunkData = buffer.slice(offset + 8, offset + 8 + length);
            const chunkString = decoder.decode(chunkData);
            const [keyword, text] = chunkString.split('\0');
            if (['invokeai_metadata', 'parameters', 'workflow', 'prompt'].includes(keyword) && text) {
                chunks[keyword] = text;
            }
        }

        if (type === 'IEND') break;
        offset += 12 + length;
    }

    if (chunks.workflow) return { workflow: JSON.parse(chunks.workflow), prompt: chunks.prompt ? JSON.parse(chunks.prompt) : undefined };
    if (chunks.invokeai_metadata) return { invokeai_metadata: JSON.parse(chunks.invokeai_metadata) };
    if (chunks.parameters) return { parameters: chunks.parameters };
    if (chunks.prompt) return { prompt: JSON.parse(chunks.prompt) };

    return null;
}

async function parseJPEGMetadata(buffer: ArrayBuffer): Promise<ImageMetadata | null> {
    const exifData = await parse(buffer, { pick: ['UserComment', 'ImageDescription'] });
    const metadataText = exifData.UserComment || exifData.ImageDescription;
    if (!metadataText) return null;

    try {
        return JSON.parse(metadataText);
    } catch {
        return { parameters: metadataText };
    }
}

export async function parseFileMetadata(file: File): Promise<ImageMetadata | null> {
    const buffer = await file.arrayBuffer();
    if (file.type === 'image/png') {
        return parsePNGMetadata(buffer);
    }
    if (file.type === 'image/jpeg') {
        return parseJPEGMetadata(buffer);
    }
    return null;
}

export function isIntermediateImage(filename: string): boolean {
    return /^(intermediate|canvas|controlnet|inpaint|[a-f0-9]+)\_/.test(filename.toLowerCase());
}

export async function processDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  setProgress: (progress: { current: number; total: number }) => void,
  specificFiles?: { handle: FileSystemFileHandle; path: string }[],
  directoryName?: string
): Promise<IndexedImage[]> {
    const allFileEntries = specificFiles || []; // Simplified, will be fleshed out in hook
    const imageFiles = allFileEntries.filter(entry => !isIntermediateImage(entry.handle.name));

    const indexedImages: IndexedImage[] = [];
    let processedCount = 0;
    const total = imageFiles.length;
    setProgress({ current: 0, total });

    for (const fileEntry of imageFiles) {
        try {
            const file = await fileEntry.handle.getFile();
            const metadata = await parseFileMetadata(file);
            if (metadata) {
                const normalized = parseMetadataWithFactory(metadata);
                if (normalized) {
                    indexedImages.push({
                        id: fileEntry.path,
                        name: fileEntry.handle.name,
                        handle: fileEntry.handle,
                        metadata,
                        metadataString: JSON.stringify(metadata),
                        lastModified: file.lastModified,
                        models: normalized.models || [],
                        loras: normalized.loras || [],
                        scheduler: normalized.scheduler || 'Unknown',
                        board: normalized.board || 'Uncategorized',
                        prompt: normalized.prompt,
                        negativePrompt: normalized.negativePrompt,
                        cfgScale: normalized.cfg_scale,
                        steps: normalized.steps,
                        seed: normalized.seed,
                        dimensions: normalized.width ? `${normalized.width}x${normalized.height}` : undefined,
                        directoryName,
                    });
                }
            }
        } catch (error) {
            console.error(`Skipping file ${fileEntry.handle.name}:`, error);
        }
        processedCount++;
        setProgress({ current: processedCount, total });
    }
    return indexedImages;
}
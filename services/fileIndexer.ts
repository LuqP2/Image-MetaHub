/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { type IndexedImage, type ImageMetadata, type BaseMetadata, isInvokeAIMetadata, isAutomatic1111Metadata, isComfyUIMetadata, ComfyUIMetadata, InvokeAIMetadata } from '../types';
import { parse } from 'exifr';
import { parseComfyUIMetadata } from './parsers/comfyUIParser';
import { parseInvokeAIMetadata } from './parsers/invokeAIParser';
import { parseA1111Metadata } from './parsers/automatic1111Parser';

// Electron detection for optimized batch reading
const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

// Main parsing function for PNG files
async function parsePNGMetadata(buffer: ArrayBuffer): Promise<ImageMetadata | null> {
  const view = new DataView(buffer);
  let offset = 8;
  const decoder = new TextDecoder();
  const chunks: { [key: string]: string } = {};

  while (offset < view.byteLength) {
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

  // Prioritize workflow for ComfyUI, then parameters for A1111, then InvokeAI
  if (chunks.workflow) {
    // console.log('✅ Detected "workflow" chunk, treating as ComfyUI metadata.');
    const comfyMetadata: ComfyUIMetadata = {};
    if (chunks.workflow) comfyMetadata.workflow = chunks.workflow;
    if (chunks.prompt) comfyMetadata.prompt = chunks.prompt;
    return comfyMetadata;
  } else if (chunks.parameters) {
    // console.log('✅ Detected "parameters" chunk, treating as A1111-style metadata.');
    return { parameters: chunks.parameters };
  } else if (chunks.invokeai_metadata) {
    // console.log('✅ Detected "invokeai_metadata" chunk, treating as InvokeAI metadata.');
    return JSON.parse(chunks.invokeai_metadata);
  } else if (chunks.prompt) {
    // console.log('✅ Detected "prompt" chunk, treating as ComfyUI (prompt only) metadata.');
    return { prompt: chunks.prompt };
  }

  return null;
}

// Main parsing function for JPEG files
async function parseJPEGMetadata(buffer: ArrayBuffer): Promise<ImageMetadata | null> {
  try {
    const exifData = await parse(buffer, { pick: ['UserComment', 'ImageDescription'] });
    if (!exifData) return null;
    
    const metadataText = exifData.UserComment || exifData.ImageDescription || '';

    if (!metadataText) return null;

    // A1111-style data is often not valid JSON, so we check for its characteristic pattern first.
    if (metadataText.includes('Steps:') && metadataText.includes('Sampler:')) {
      // console.log(`✅ Detected A1111-style parameters in JPEG.`);
      return { parameters: metadataText };
    }

    // Try to parse as JSON for other formats like InvokeAI or ComfyUI
    try {
      const parsedMetadata = JSON.parse(metadataText);
      if (isInvokeAIMetadata(parsedMetadata)) {
        // console.log(`✅ Successfully parsed InvokeAI JSON metadata from JPEG.`);
        return parsedMetadata;
      } else {
        // console.log(`✅ Successfully parsed ComfyUI JSON metadata from JPEG.`);
        return parsedMetadata;
      }
    } catch (jsonError) {
      // console.warn(`⚠️ Could not parse JPEG metadata as any known format.`);
      return null;
    }
  } catch (error) {
    console.error('❌ Failed to parse JPEG EXIF metadata:', error);
    return null;
  }
}

// Main image metadata parser
async function parseImageMetadata(file: File): Promise<ImageMetadata | null> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  if (view.getUint32(0) === 0x89504E47 && view.getUint32(4) === 0x0D0A1A0A) {
    return parsePNGMetadata(buffer);
  }
  if (view.getUint16(0) === 0xFFD8) {
    return parseJPEGMetadata(buffer);
  }
  return null;
}

/**
 * Processes a single file entry to extract metadata and create an IndexedImage object.
 * This function encapsulates the logic that was previously duplicated.
 */
async function processSingleFile(fileEntry: { handle: FileSystemFileHandle, path: string }): Promise<IndexedImage | null> {
  try {
    const file = await fileEntry.handle.getFile();
    const rawMetadata = await parseImageMetadata(file);

    let normalizedMetadata: BaseMetadata | undefined;
    if (rawMetadata) {
      if (isComfyUIMetadata(rawMetadata)) {
        normalizedMetadata = parseComfyUIMetadata(rawMetadata as ComfyUIMetadata);
      } else if (isAutomatic1111Metadata(rawMetadata)) {
        normalizedMetadata = parseA1111Metadata(rawMetadata.parameters);
      } else if (isInvokeAIMetadata(rawMetadata)) {
        normalizedMetadata = parseInvokeAIMetadata(rawMetadata as InvokeAIMetadata);
      }
    }

    return {
      id: fileEntry.path,
      name: fileEntry.handle.name,
      handle: fileEntry.handle,
      metadata: normalizedMetadata ? { ...rawMetadata, normalizedMetadata } : rawMetadata || {},
      metadataString: JSON.stringify(rawMetadata) || '',
      lastModified: file.lastModified,
      models: normalizedMetadata?.models || [],
      loras: normalizedMetadata?.loras || [],
      scheduler: normalizedMetadata?.scheduler || '',
      board: normalizedMetadata?.board || '',
      prompt: normalizedMetadata?.prompt || '',
      negativePrompt: normalizedMetadata?.negativePrompt || '',
      cfgScale: normalizedMetadata?.cfgScale || normalizedMetadata?.cfg_scale || 0,
      steps: normalizedMetadata?.steps || 0,
      seed: normalizedMetadata?.seed,
      dimensions: normalizedMetadata?.dimensions || `${normalizedMetadata?.width || 0}x${normalizedMetadata?.height || 0}`,
    } as IndexedImage;
  } catch (error) {
    console.error(`Skipping file ${fileEntry.handle.name} due to an error:`, error);
    return null;
  }
}

/**
 * Processes an array of file entries in batches to avoid blocking the main thread.
 * Invokes a callback with each batch of processed images.
 */
export async function processFiles(
  fileEntries: { handle: FileSystemFileHandle, path: string }[],
  setProgress: (progress: { current: number; total: number }) => void,
  onBatchProcessed: (batch: IndexedImage[]) => void
): Promise<void> {
  const imageFiles = fileEntries.filter(entry => /\.(png|jpg|jpeg)$/i.test(entry.handle.name));
  const total = imageFiles.length;
  let processedCount = 0;
  const BATCH_SIZE = 50; // For sending data to the store
  const CONCURRENCY_LIMIT = 10; // Limit of files processed in parallel
  let batch: IndexedImage[] = [];

  // Async pool implementation for controlled concurrency
  async function asyncPool<T, R>(
    concurrency: number,
    iterable: T[],
    iteratorFn: (item: T) => Promise<R>
  ): Promise<R[]> {
    const ret: Promise<R>[] = [];
    const executing = new Set<Promise<R>>();

    for (const item of iterable) {
      const p = Promise.resolve().then(() => iteratorFn(item));
      ret.push(p);
      executing.add(p);

      const clean = () => executing.delete(p);
      p.then(clean).catch(clean);

      if (executing.size >= concurrency) {
        await Promise.race(executing);
      }
    }

    return Promise.all(ret);
  }

  const iteratorFn = async (fileEntry: { handle: FileSystemFileHandle, path: string }): Promise<IndexedImage | null> => {
    const indexedImage = await processSingleFile(fileEntry);
    processedCount++;

    // Update progress after each file
    setProgress({ current: processedCount, total });

    return indexedImage;
  };

  // Process files with controlled concurrency
  const results = await asyncPool(CONCURRENCY_LIMIT, imageFiles, iteratorFn);

  // Filter valid images and collect them into batches
  for (const indexedImage of results) {
    if (indexedImage) {
      batch.push(indexedImage);

      if (batch.length >= BATCH_SIZE) {
        onBatchProcessed(batch);
        batch = [];
        // Yield to the main thread to allow UI updates after a batch is sent
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }

  // Process any remaining images in the last batch
  if (batch.length > 0) {
    onBatchProcessed(batch);
  }
}
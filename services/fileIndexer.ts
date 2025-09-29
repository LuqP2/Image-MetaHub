/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { type IndexedImage, type ImageMetadata, type InvokeAIMetadata, type Automatic1111Metadata, type ComfyUIMetadata, type BaseMetadata, isInvokeAIMetadata, isAutomatic1111Metadata, isComfyUIMetadata } from '../types';
import { parse } from 'exifr';
import { parseComfyUIMetadata } from './parsers/comfyUIParser';

// Function to parse InvokeAI metadata and extract normalized metadata
function parseInvokeAIMetadata(metadata: InvokeAIMetadata): BaseMetadata {
  const result: BaseMetadata = {
    format: 'invokeai',
    prompt: '',
    negativePrompt: '',
    model: '',
    width: 0,
    height: 0,
    steps: 0,
    scheduler: '',
    cfgScale: 0,
    seed: undefined,
    loras: [],
  };

  try {
    // Extract prompt
    if (typeof metadata.positive_prompt === 'string') {
      result.prompt = metadata.positive_prompt;
    } else if (typeof metadata.prompt === 'string') {
      result.prompt = metadata.prompt;
    } else if (Array.isArray(metadata.prompt)) {
      result.prompt = metadata.prompt.map(p => (typeof p === 'string' ? p : p?.prompt || '')).join(' ');
    }

    // Extract negative prompt
    if (typeof metadata.negative_prompt === 'string') {
      result.negativePrompt = metadata.negative_prompt;
    }

    // Extract model
    if (typeof metadata.model === 'string') {
      result.model = metadata.model.split('/').pop()?.split('\\').pop() || metadata.model;
      result.models = [result.model]; // Convert to array for filtering
    } else if ((metadata.model as any)?.model_name) {
      result.model = (metadata.model as any).model_name;
      result.models = [result.model]; // Convert to array for filtering
    } else {
      result.models = []; // Empty array if no model found
    }

    // Extract dimensions
    if (metadata.width && metadata.height) {
      result.width = metadata.width;
      result.height = metadata.height;
    }

    // Extract other parameters
    result.steps = metadata.steps || 0;
    result.scheduler = metadata.scheduler || '';
    result.cfgScale = metadata.cfg_scale;
    result.seed = metadata.seed;

    // Extract LoRAs
    try {
      if (Array.isArray(metadata.loras)) {
          result.loras = metadata.loras.map((lora: any) => lora?.lora?.model_name || lora?.model_name || '').filter(name => name);
      }
    } catch (error) {
      console.warn('Error extracting LoRAs:', error);
      result.loras = [];
    }

  } catch (error) {
    console.error('Error parsing InvokeAI metadata:', error);
  }

  return result;
}

// Function to parse Automatic1111 parameters string and extract normalized metadata
function parseA1111Metadata(parameters: string): BaseMetadata {
  const result: BaseMetadata = {
    format: 'automatic1111',
    prompt: '',
    negativePrompt: '',
    model: '',
    width: 0,
    height: 0,
    steps: 0,
    cfgScale: 0,
    seed: undefined,
    sampler: '',
    scheduler: '',
    loras: [],
  };

  try {
    const negPromptIndex = parameters.indexOf('Negative prompt:');
    const paramsIndex = parameters.indexOf('Steps:');

    if (negPromptIndex > -1) {
      result.prompt = parameters.substring(0, negPromptIndex).trim();
      const rest = parameters.substring(negPromptIndex + 'Negative prompt:'.length);
      result.negativePrompt = rest.substring(0, rest.indexOf('Steps:')).trim();
    } else if (paramsIndex > -1) {
      result.prompt = parameters.substring(0, paramsIndex).trim();
    }

    const stepsMatch = parameters.match(/Steps: (\d+)/);
    if (stepsMatch) result.steps = parseInt(stepsMatch[1], 10);

    const samplerMatch = parameters.match(/Sampler: ([^,]+)/);
    if (samplerMatch) {
      result.sampler = samplerMatch[1].trim();
      result.scheduler = result.sampler; // Ensure consistency for filtering
    }

    const cfgScaleMatch = parameters.match(/CFG scale: ([\d.]+)/);
    if (cfgScaleMatch) result.cfgScale = parseFloat(cfgScaleMatch[1]);

    const seedMatch = parameters.match(/Seed: (\d+)/);
    if (seedMatch) result.seed = parseInt(seedMatch[1], 10);

    const sizeMatch = parameters.match(/Size: (\d+)x(\d+)/);
    if (sizeMatch) {
      result.width = parseInt(sizeMatch[1], 10);
      result.height = parseInt(sizeMatch[2], 10);
    }

    const modelMatch = parameters.match(/Model: ([^,]+)/);
    if (modelMatch) result.model = modelMatch[1].trim();

    // Convert single model to models array for filtering
    result.models = result.model ? [result.model] : [];

    // Extract LoRAs from prompt
    const loraRegex = /<lora:([^:]+):[^>]+>/g;
    let loraMatch;
    while ((loraMatch = loraRegex.exec(result.prompt)) !== null) {
      result.loras.push(loraMatch[1]);
    }

  } catch (error) {
    console.warn('Failed to parse Automatic1111 parameters:', error);
  }

  return result;
}

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
    console.log('✅ Detected "workflow" chunk, treating as ComfyUI metadata.');
    const comfyMetadata: ComfyUIMetadata = {};
    if (chunks.workflow) comfyMetadata.workflow = chunks.workflow;
    if (chunks.prompt) comfyMetadata.prompt = chunks.prompt;
    return comfyMetadata;
  } else if (chunks.parameters) {
    console.log('✅ Detected "parameters" chunk, treating as A1111-style metadata.');
    return { parameters: chunks.parameters };
  } else if (chunks.invokeai_metadata) {
    console.log('✅ Detected "invokeai_metadata" chunk, treating as InvokeAI metadata.');
    return JSON.parse(chunks.invokeai_metadata);
  } else if (chunks.prompt) {
    console.log('✅ Detected "prompt" chunk, treating as ComfyUI (prompt only) metadata.');
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
      console.log(`✅ Detected A1111-style parameters in JPEG.`);
      return { parameters: metadataText };
    }

    // Try to parse as JSON for other formats like InvokeAI or ComfyUI
    try {
      const parsedMetadata = JSON.parse(metadataText);
      if (isInvokeAIMetadata(parsedMetadata)) {
        console.log(`✅ Successfully parsed InvokeAI JSON metadata from JPEG.`);
        return parsedMetadata;
      } else {
        console.log(`✅ Successfully parsed ComfyUI JSON metadata from JPEG.`);
        return parsedMetadata;
      }
    } catch (jsonError) {
      console.warn(`⚠️ Could not parse JPEG metadata as any known format.`);
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

// Recursive file handle getter
export async function getFileHandlesRecursive(
  directoryHandle: FileSystemDirectoryHandle,
  path: string = ''
): Promise<{handle: FileSystemFileHandle, path: string}[]> {
  const entries = [];
  for await (const entry of (directoryHandle as any).values()) {
    const newPath = path ? `${path}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      entries.push({handle: entry, path: newPath});
    } else if (entry.kind === 'directory') {
      entries.push(...(await getFileHandlesRecursive(entry, newPath)));
    }
  }
  return entries;
}

// Main directory processing function
export async function processDirectory(
  directoryHandle: FileSystemDirectoryHandle | string,
  setProgress: (progress: { current: number; total: number }) => void
): Promise<IndexedImage[]> {
  let allFileEntries: {handle: FileSystemFileHandle, path: string}[];

  if (typeof directoryHandle === 'string') {
    // Electron mode: files are already listed, but since we don't have them here, this shouldn't happen
    // For now, throw error
    throw new Error('processDirectory with string not implemented');
  } else {
    allFileEntries = await getFileHandlesRecursive(directoryHandle);
  }

  const imageFiles = allFileEntries.filter(entry => /\.(png|jpg|jpeg)$/i.test(entry.handle.name));
  const total = imageFiles.length;
  let processedCount = 0;

  const indexedImages = await Promise.all(imageFiles.map(async (fileEntry) => {
    try {
      const file = await fileEntry.handle.getFile();
      const rawMetadata = await parseImageMetadata(file);

      let normalizedMetadata: BaseMetadata | undefined;
      if (rawMetadata) {
        if (isComfyUIMetadata(rawMetadata)) {
          normalizedMetadata = parseComfyUIMetadata(rawMetadata);
        } else if (isAutomatic1111Metadata(rawMetadata)) {
          normalizedMetadata = parseA1111Metadata(rawMetadata.parameters);
        } else if (isInvokeAIMetadata(rawMetadata)) {
          normalizedMetadata = parseInvokeAIMetadata(rawMetadata);
        }
      }

      processedCount++;
      setProgress({ current: processedCount, total });

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
  }));

  return indexedImages.filter((image): image is IndexedImage => image !== null);
}

// Process array of file entries
export async function processFiles(
  fileEntries: {handle: FileSystemFileHandle, path: string}[],
  setProgress: (progress: { current: number; total: number }) => void
): Promise<IndexedImage[]> {
  const imageFiles = fileEntries.filter(entry => /\.(png|jpg|jpeg)$/i.test(entry.handle.name));
  const total = imageFiles.length;
  let processedCount = 0;

  const indexedImages = await Promise.all(imageFiles.map(async (fileEntry) => {
    try {
      const file = await fileEntry.handle.getFile();
      const rawMetadata = await parseImageMetadata(file);

      let normalizedMetadata: BaseMetadata | undefined;
      if (rawMetadata) {
        if (isComfyUIMetadata(rawMetadata)) {
          normalizedMetadata = parseComfyUIMetadata(rawMetadata);
        } else if (isAutomatic1111Metadata(rawMetadata)) {
          normalizedMetadata = parseA1111Metadata(rawMetadata.parameters);
        } else if (isInvokeAIMetadata(rawMetadata)) {
          normalizedMetadata = parseInvokeAIMetadata(rawMetadata);
        }
      }

      processedCount++;
      setProgress({ current: processedCount, total });

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
  }));

  return indexedImages.filter((image): image is IndexedImage => image !== null);
}
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { type IndexedImage, type ImageMetadata, type BaseMetadata, isInvokeAIMetadata, isAutomatic1111Metadata, isComfyUIMetadata, isSwarmUIMetadata, isEasyDiffusionMetadata, isEasyDiffusionJson, isMidjourneyMetadata, ComfyUIMetadata, InvokeAIMetadata, SwarmUIMetadata, EasyDiffusionMetadata, EasyDiffusionJson, MidjourneyMetadata } from '../types';
import { parse } from 'exifr';
import { resolvePromptFromGraph } from './parsers/comfyUIParser';
import { parseInvokeAIMetadata } from './parsers/invokeAIParser';
import { parseA1111Metadata } from './parsers/automatic1111Parser';
import { parseSwarmUIMetadata } from './parsers/swarmUIParser';
import { parseEasyDiffusionMetadata, parseEasyDiffusionJson } from './parsers/easyDiffusionParser';
import { parseMidjourneyMetadata } from './parsers/midjourneyParser';

function sanitizeJson(jsonString: string): string {
    // Replace NaN with null, as NaN is not valid JSON
    return jsonString.replace(/:\s*NaN/g, ': null');
}

// Electron detection for optimized batch reading
const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

/**
 * Attempts to read a sidecar JSON file for Easy Diffusion metadata
 * @param imagePath Path to the image file (e.g., /path/to/image.png)
 * @returns Parsed JSON metadata or null if not found/valid
 */
async function tryReadEasyDiffusionSidecarJson(imagePath: string): Promise<EasyDiffusionJson | null> {
  try {
    // Generate JSON path by replacing extension with .json
    const jsonPath = imagePath.replace(/\.(png|jpg|jpeg)$/i, '.json');
    
    if (!isElectron || !jsonPath || jsonPath === imagePath) {
      return null; // Only works in Electron environment
    }

    console.log(`🔍 Checking for Easy Diffusion sidecar JSON: ${jsonPath}`);
    
    // Try to read the JSON file
    const result = await (window as any).electronAPI.readFile(jsonPath);
    if (!result.success || !result.data) {
      console.log(`📄 No sidecar JSON found at: ${jsonPath}`);
      return null;
    }

    // Parse the JSON
    const jsonText = result.data.toString('utf-8');
    const parsedJson = JSON.parse(jsonText);
    
    // Validate that it looks like Easy Diffusion JSON
    if (typeof parsedJson === 'object' && parsedJson.prompt && typeof parsedJson.prompt === 'string') {
      console.log(`✅ Found valid Easy Diffusion sidecar JSON: ${jsonPath}`);
      return parsedJson as EasyDiffusionJson;
    } else {
      console.log(`⚠️ JSON found but doesn't match Easy Diffusion format: ${jsonPath}`);
      return null;
    }
  } catch (error) {
    console.warn(`❌ Error reading/parsing Easy Diffusion sidecar JSON for ${imagePath}:`, error);
    return null;
  }
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
    } else if (type === 'iTXt') {
      const chunkData = new Uint8Array(buffer.slice(offset + 8, offset + 8 + length));
      const keywordEndIndex = chunkData.indexOf(0);
      if (keywordEndIndex === -1) {
        offset += 12 + length;
        continue;
      }
      const keyword = decoder.decode(chunkData.slice(0, keywordEndIndex));

      if (['invokeai_metadata', 'parameters', 'workflow', 'prompt'].includes(keyword)) {
        const compressionFlag = chunkData[keywordEndIndex + 1];
        if (compressionFlag === 0) {
          // 0 -> uncompressed, which is what we expect from A1111
          let currentIndex = keywordEndIndex + 3; // Skip null separator, compression flag, and method

          const langTagEndIndex = chunkData.indexOf(0, currentIndex);
          if (langTagEndIndex === -1) {
            offset += 12 + length;
            continue;
          }
          currentIndex = langTagEndIndex + 1;

          const translatedKwEndIndex = chunkData.indexOf(0, currentIndex);
          if (translatedKwEndIndex === -1) {
            offset += 12 + length;
            continue;
          }
          currentIndex = translatedKwEndIndex + 1;

          const text = decoder.decode(chunkData.slice(currentIndex));
          chunks[keyword] = text;
        }
      }
    }
    if (type === 'IEND') break;
    offset += 12 + length;
  }

  // Configure debug logging
  const DEBUG = false;
  const log = (...args: any[]) => DEBUG && console.log(...args);

  // Prioritize workflow for ComfyUI, then parameters for A1111, then InvokeAI
  if (chunks.workflow) {
    log('✅ Detected "workflow" chunk, treating as ComfyUI metadata.');
    const comfyMetadata: ComfyUIMetadata = {};
    if (chunks.workflow) comfyMetadata.workflow = chunks.workflow;
    if (chunks.prompt) comfyMetadata.prompt = chunks.prompt;
    return comfyMetadata;
  } else if (chunks.parameters) {
    log('✅ Detected "parameters" chunk, treating as A1111-style metadata.');
    return { parameters: chunks.parameters };
  } else if (chunks.invokeai_metadata) {
    log('✅ Detected "invokeai_metadata" chunk, treating as InvokeAI metadata.');
    return JSON.parse(chunks.invokeai_metadata);
  } else if (chunks.prompt) {
    log('✅ Detected "prompt" chunk, treating as ComfyUI (prompt only) metadata.');
    return { prompt: chunks.prompt };
  }

  return null;
}

// Main parsing function for JPEG files
async function parseJPEGMetadata(buffer: ArrayBuffer): Promise<ImageMetadata | null> {
  try {
    // Extract EXIF data with UserComment support
    const exifData = await parse(buffer, {
      userComment: true,
      mergeOutput: true,
      sanitize: false,
      reviveValues: true
    });
    
    if (!exifData) return null;
    
    // Check all possible field names for UserComment (A1111 and SwarmUI store metadata here in JPEGs)
    let metadataText: any = 
      exifData.UserComment || 
      exifData.userComment ||
      exifData['User Comment'] ||
      exifData.ImageDescription || 
      exifData.Parameters ||
      null;
    
    if (!metadataText) return null;
    
    // Convert Uint8Array to string if needed (exifr returns UserComment as Uint8Array)
    if (metadataText instanceof Uint8Array) {
      // UserComment in EXIF has 8-byte character code prefix (e.g., "ASCII\0\0\0", "UNICODE\0")
      // Find where the actual data starts (look for '{' character for JSON data)
      let startOffset = 0;
      for (let i = 0; i < Math.min(20, metadataText.length); i++) {
        if (metadataText[i] === 0x7B) { // '{' character
          startOffset = i;
          break;
        }
      }
      
      // If no JSON found at start, skip the standard 8-byte prefix
      if (startOffset === 0 && metadataText.length > 8) {
        startOffset = 8;
      }
      
      // Remove null bytes (0x00) that can interfere with decoding
      const cleanedData = Array.from(metadataText.slice(startOffset)).filter(byte => byte !== 0x00);
      metadataText = new TextDecoder('utf-8').decode(new Uint8Array(cleanedData));
    } else if (typeof metadataText !== 'string') {
      // Convert other types to string
      metadataText = typeof metadataText === 'object' ? JSON.stringify(metadataText) : String(metadataText);
    }

    if (!metadataText) {
      console.log('⚠️ No UserComment or similar field found in JPEG');
      return null;
    }

    // A1111-style data is often not valid JSON, so we check for its characteristic pattern first.
    if (metadataText.includes('Steps:') && metadataText.includes('Sampler:') && metadataText.includes('Model hash:')) {
      console.log(`✅ Detected A1111-style parameters in JPEG UserComment.`);
      return { parameters: metadataText };
    }

    // Easy Diffusion uses similar format but without Model hash
    if (metadataText.includes('Prompt:') && metadataText.includes('Steps:') && metadataText.includes('Sampler:') && !metadataText.includes('Model hash:')) {
      console.log(`✅ Detected Easy Diffusion parameters in JPEG UserComment.`);
      return { parameters: metadataText };
    }

    // Midjourney uses parameter flags like --v, --ar, --q, --s
    if (metadataText.includes('--v') || metadataText.includes('--ar') || metadataText.includes('--q') || metadataText.includes('--s') || metadataText.includes('Midjourney')) {
      console.log(`✅ Detected Midjourney parameters in JPEG UserComment.`);
      return { parameters: metadataText };
    }

    // Try to parse as JSON for other formats like SwarmUI, InvokeAI or ComfyUI
    try {
      const parsedMetadata = JSON.parse(metadataText);
      
      // Check for SwarmUI format (sui_image_params)
      if (parsedMetadata.sui_image_params) {
        console.log(`✅ Detected SwarmUI metadata in JPEG.`);
        return parsedMetadata;
      }
      
      if (isInvokeAIMetadata(parsedMetadata)) {
        console.log(`✅ Successfully parsed InvokeAI JSON metadata from JPEG.`);
        return parsedMetadata;
      } else if (isComfyUIMetadata(parsedMetadata)) {
        console.log(`✅ Successfully parsed ComfyUI JSON metadata from JPEG.`);
        return parsedMetadata;
      } else {
        console.log(`✅ Successfully parsed generic JSON metadata from JPEG.`);
        return parsedMetadata;
      }
    } catch (jsonError) {
      console.warn(`⚠️ Could not parse JPEG metadata as JSON, might be plain text format.`);
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
async function processSingleFile(
  fileEntry: { handle: FileSystemFileHandle, path: string },
  directoryId: string
): Promise<IndexedImage | null> {
  try {
    const file = await fileEntry.handle.getFile();
    let rawMetadata = await parseImageMetadata(file);

    // Try to read sidecar JSON for Easy Diffusion (fallback if no embedded metadata)
    if (!rawMetadata || (!isEasyDiffusionMetadata(rawMetadata) && !isEasyDiffusionJson(rawMetadata))) {
      const sidecarJson = await tryReadEasyDiffusionSidecarJson(fileEntry.path);
      if (sidecarJson) {
        rawMetadata = sidecarJson;
        console.log(`🎯 Using Easy Diffusion sidecar JSON metadata for: ${fileEntry.path}`);
      }
    }

    let normalizedMetadata: BaseMetadata | undefined;
    if (rawMetadata) {
      if (isSwarmUIMetadata(rawMetadata)) {
        normalizedMetadata = parseSwarmUIMetadata(rawMetadata as SwarmUIMetadata);
      } else if (isComfyUIMetadata(rawMetadata)) {
        const comfyMetadata = rawMetadata as ComfyUIMetadata;
        // Parse workflow and prompt if they are strings
        let workflow = comfyMetadata.workflow;
        let prompt = comfyMetadata.prompt;
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
        normalizedMetadata = {
          prompt: resolvedParams.prompt || '',
          negativePrompt: resolvedParams.negativePrompt || '',
          model: resolvedParams.model || '',
          models: resolvedParams.model ? [resolvedParams.model] : [],
          width: 0,  // Will be filled from actual image dimensions below
          height: 0, // Will be filled from actual image dimensions below
          seed: resolvedParams.seed,
          steps: resolvedParams.steps || 0,
          cfg_scale: resolvedParams.cfg,
          scheduler: resolvedParams.scheduler || '',
          sampler: resolvedParams.sampler_name || '',
          loras: Array.isArray(resolvedParams.lora) ? resolvedParams.lora : (resolvedParams.lora ? [resolvedParams.lora] : []),
        };
      } else if (isAutomatic1111Metadata(rawMetadata)) {
        normalizedMetadata = parseA1111Metadata(rawMetadata.parameters);
      } else if (isEasyDiffusionMetadata(rawMetadata)) {
        normalizedMetadata = parseEasyDiffusionMetadata(rawMetadata.parameters);
      } else if (isEasyDiffusionJson(rawMetadata)) {
        normalizedMetadata = parseEasyDiffusionJson(rawMetadata as EasyDiffusionJson);
      } else if (isMidjourneyMetadata(rawMetadata)) {
        normalizedMetadata = parseMidjourneyMetadata(rawMetadata.parameters);
      } else if (isInvokeAIMetadata(rawMetadata)) {
        normalizedMetadata = parseInvokeAIMetadata(rawMetadata as InvokeAIMetadata);
      }
    }

    // Read actual image dimensions
    if (normalizedMetadata) {
      try {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            normalizedMetadata!.width = img.width;
            normalizedMetadata!.height = img.height;
            URL.revokeObjectURL(objectUrl);
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Failed to load image'));
          };
          img.src = objectUrl;
        });
      } catch (e) {
        console.warn('Failed to read image dimensions:', e);
        // Keep width/height as 0 if failed
      }
    }

    // Determine the best date for sorting (generation date vs file date)
    let sortDate = file.lastModified;

    // For Electron files, try to get creation date
    if (isElectron && (fileEntry.handle as any)._filePath) {
      try {
        const filePath = (fileEntry.handle as any)._filePath;
        const stats = await (window as any).electronAPI.getFileStats(filePath);
        if (stats && stats.success && stats.stats && stats.stats.birthtimeMs) {
          // Use creation date for all files - this is more accurate for sorting
          // AI-generated images should be sorted by when they were created, not modified
          sortDate = stats.stats.birthtimeMs;
        }
      } catch (error) {
        // Fall back to lastModified if we can't get creation date
        console.warn('Could not get file creation date, using lastModified:', error);
      }
    }

    return {
      id: `${directoryId}::${fileEntry.path}`,
      name: fileEntry.handle.name,
      handle: fileEntry.handle,
      directoryId,
      metadata: normalizedMetadata ? { ...rawMetadata, normalizedMetadata } : rawMetadata || {},
      metadataString: JSON.stringify(rawMetadata) || '',
      lastModified: sortDate, // Use the determined sort date
      models: normalizedMetadata?.models || [],
      loras: normalizedMetadata?.loras || [],
      scheduler: normalizedMetadata?.scheduler || '',
      board: normalizedMetadata?.board || '',
      prompt: normalizedMetadata?.prompt || '',
      negativePrompt: normalizedMetadata?.negativePrompt || '',
      cfgScale: normalizedMetadata?.cfgScale || normalizedMetadata?.cfg_scale || null,
      steps: normalizedMetadata?.steps || null,
      seed: normalizedMetadata?.seed || null,
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
  onBatchProcessed: (batch: IndexedImage[]) => void,
  directoryId: string
): Promise<void> {
  const imageFiles = fileEntries.filter(entry => /\.(png|jpg|jpeg)$/i.test(entry.handle.name));
  const total = imageFiles.length;
  let processedCount = 0;
  const BATCH_SIZE = 50; // For sending data to the store
  const CONCURRENCY_LIMIT = 20; // Limit of files processed in parallel (increased for Electron IPC)
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
    const indexedImage = await processSingleFile(fileEntry, directoryId);
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
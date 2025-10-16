/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { type IndexedImage, type ImageMetadata, type BaseMetadata, isInvokeAIMetadata, isAutomatic1111Metadata, isComfyUIMetadata, isSwarmUIMetadata, isEasyDiffusionMetadata, isEasyDiffusionJson, isMidjourneyMetadata, isNijiMetadata, isForgeMetadata, isDalleMetadata, isFireflyMetadata, isDreamStudioMetadata, isDrawThingsMetadata, ComfyUIMetadata, InvokeAIMetadata, SwarmUIMetadata, EasyDiffusionMetadata, EasyDiffusionJson, MidjourneyMetadata, NijiMetadata, ForgeMetadata, DalleMetadata, FireflyMetadata, DrawThingsMetadata, FooocusMetadata } from '../types';
import { parse } from 'exifr';
import { resolvePromptFromGraph } from './parsers/comfyUIParser';
import { parseInvokeAIMetadata } from './parsers/invokeAIParser';
import { parseA1111Metadata } from './parsers/automatic1111Parser';
import { parseSwarmUIMetadata } from './parsers/swarmUIParser';
import { parseEasyDiffusionMetadata, parseEasyDiffusionJson } from './parsers/easyDiffusionParser';
import { parseMidjourneyMetadata } from './parsers/midjourneyParser';
import { parseNijiMetadata } from './parsers/nijiParser';
import { parseForgeMetadata } from './parsers/forgeParser';
import { parseDalleMetadata } from './parsers/dalleParser';
import { parseFireflyMetadata } from './parsers/fireflyParser';
import { parseDreamStudioMetadata } from './parsers/dreamStudioParser';
import { parseDrawThingsMetadata } from './parsers/drawThingsParser';
import { parseFooocusMetadata } from './parsers/fooocusParser';

function sanitizeJson(jsonString: string): string {
    // Replace NaN with null, as NaN is not valid JSON
    return jsonString.replace(/:\s*NaN/g, ': null');
}

// Electron detection for optimized batch reading
const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

// Helper function to chunk array into smaller arrays
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Attempts to read a sidecar JSON file for Easy Diffusion metadata
 * @param imagePath Path to the image file (e.g., /path/to/image.png)
 * @returns Parsed JSON metadata or null if not found/valid
 */
async function tryReadEasyDiffusionSidecarJson(imagePath: string): Promise<EasyDiffusionJson | null> {
  try {
    // Generate JSON path by replacing extension with .json
    const jsonPath = imagePath.replace(/\.(png|jpg|jpeg)$/i, '.json');
    
    // Check if path is absolute (has drive letter on Windows or starts with / on Unix)
    const isAbsolutePath = /^[a-zA-Z]:\\/.test(jsonPath) || jsonPath.startsWith('/');
    
    if (!isElectron || !jsonPath || jsonPath === imagePath || !isAbsolutePath) {
      return null; // Only works in Electron environment with absolute paths
    }

    // Try to read the JSON file (silent - no logging)
    const result = await (window as any).electronAPI.readFile(jsonPath);
    if (!result.success || !result.data) {
      return null;
    }

    // Parse the JSON
    const jsonText = result.data.toString('utf-8');
    const parsedJson = JSON.parse(jsonText);
    
    // Validate that it looks like Easy Diffusion JSON
    if (typeof parsedJson === 'object' && parsedJson.prompt && typeof parsedJson.prompt === 'string') {
      return parsedJson as EasyDiffusionJson;
    } else {
      return null;
    }
  } catch (error) {
    // Silent error - most images won't have sidecar JSON
    return null;
  }
}

// Main parsing function for PNG files
async function parsePNGMetadata(buffer: ArrayBuffer): Promise<ImageMetadata | null> {
  console.log('🔍 Starting PNG metadata parsing...');
  const view = new DataView(buffer);
  let offset = 8;
  const decoder = new TextDecoder();
  const chunks: { [key: string]: string } = {};
  
  // OPTIMIZATION: Stop early if we found all needed chunks
  let foundChunks = 0;
  const maxChunks = 4; // invokeai_metadata, parameters, workflow, prompt

  while (offset < view.byteLength && foundChunks < maxChunks) {
    const length = view.getUint32(offset);
    const type = decoder.decode(buffer.slice(offset + 4, offset + 8));
    
    // Log ALL chunk types found
    console.log(`🔍 Found PNG chunk type: ${type} (length: ${length})`);

    if (type === 'tEXt') {
      const chunkData = buffer.slice(offset + 8, offset + 8 + length);
      const chunkString = decoder.decode(chunkData);
      const [keyword, text] = chunkString.split('\0');
      
      // Log ALL text chunks found, not just the expected ones
      console.log(`📦 Found PNG text chunk: "${keyword}" (length: ${text?.length || 0})`);
      if (text && text.length > 0) {
        console.log(`   Content preview: ${text.substring(0, 150)}${text.length > 150 ? '...' : ''}`);
      }
      
      if (['invokeai_metadata', 'parameters', 'Parameters', 'workflow', 'prompt'].includes(keyword) && text) {
        chunks[keyword.toLowerCase()] = text;
        foundChunks++;
        console.log(`✅ Added to processing queue: ${keyword} -> ${keyword.toLowerCase()}`);
        
        // Special logging for Fooocus detection
        if (keyword.toLowerCase() === 'parameters') {
          console.log('🎯 Found parameters chunk - checking for Fooocus patterns:');
          console.log(`   Contains 'Fooocus': ${text.includes('Fooocus')}`);
          console.log(`   Contains 'Version: f2.': ${text.match(/Version:\s*f2\./i) ? 'YES' : 'NO'}`);
          console.log(`   Contains 'flux': ${text.match(/Model:\s*flux/i) ? 'YES' : 'NO'}`);
          console.log(`   Contains 'Module 1: ae': ${text.match(/Module\s*1:\s*ae/i) ? 'YES' : 'NO'}`);
          
          // Log full content for debugging
          console.log('🎯 Full parameters content for analysis:');
          console.log(text);
        }
      }
    } else if (type === 'iTXt') {
      const chunkData = new Uint8Array(buffer.slice(offset + 8, offset + 8 + length));
      const keywordEndIndex = chunkData.indexOf(0);
      if (keywordEndIndex === -1) {
        offset += 12 + length;
        continue;
      }
      const keyword = decoder.decode(chunkData.slice(0, keywordEndIndex));

      if (['invokeai_metadata', 'parameters', 'Parameters', 'workflow', 'prompt'].includes(keyword)) {
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
          foundChunks++;
        }
      }
    }
    if (type === 'IEND') break;
    offset += 12 + length;
  }

  // Configure debug logging
  const DEBUG = true;
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
    console.log('🔍 Parameters content preview:', chunks.parameters.substring(0, 100));
    return { parameters: chunks.parameters };
  } else if (chunks.invokeai_metadata) {
    log('✅ Detected "invokeai_metadata" chunk, treating as InvokeAI metadata.');
    return JSON.parse(chunks.invokeai_metadata);
  } else if (chunks.prompt) {
    log('✅ Detected "prompt" chunk, treating as ComfyUI (prompt only) metadata.');
    return { prompt: chunks.prompt };
  }

  // If no PNG chunks found, try to extract EXIF data from PNG (some tools like Fooocus save metadata in EXIF)
  console.log('🔍 No PNG text chunks found, trying EXIF extraction from PNG...');
  try {
    const exifResult = await parseJPEGMetadata(buffer);
    if (exifResult) {
      console.log('✅ Found EXIF metadata in PNG file!');
      return exifResult;
    } else {
      console.log('❌ No EXIF metadata found in PNG file');
    }
  } catch (exifError) {
    console.log('❌ EXIF extraction from PNG failed:', exifError);
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
    
    console.log('📋 Found EXIF metadata text from field:', 
      exifData.UserComment ? 'UserComment' :
      exifData.userComment ? 'userComment' :
      exifData['User Comment'] ? 'User Comment' :
      exifData.ImageDescription ? 'ImageDescription' :
      exifData.Parameters ? 'Parameters' : 'unknown'
    );
    
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

    // Forge uses A1111-style parameters but includes "Forge" or "Gradio" indicators
    if ((metadataText.includes('Forge') || metadataText.includes('Gradio')) && 
        metadataText.includes('Steps:') && metadataText.includes('Sampler:') && metadataText.includes('Model hash:')) {
      console.log(`✅ Detected Forge parameters in JPEG UserComment.`);
      return { parameters: metadataText };
    }

    // Draw Things (iOS/Mac AI app) uses SD-like format with mobile device indicators
    if ((metadataText.includes('iPhone') || metadataText.includes('iPad') || metadataText.includes('iPod') || metadataText.includes('Draw Things')) &&
        metadataText.includes('Prompt:') && metadataText.includes('Steps:') && metadataText.includes('CFG scale:') &&
        !metadataText.includes('Model hash:') && !metadataText.includes('Forge') && !metadataText.includes('Gradio') &&
        !metadataText.includes('DreamStudio') && !metadataText.includes('Stability AI') && !metadataText.includes('--niji')) {
      console.log(`✅ Detected Draw Things parameters in JPEG UserComment.`);
      return { parameters: metadataText };
    }

    // Try to parse as JSON for other formats like SwarmUI, InvokeAI, ComfyUI, or DALL-E
    try {
      const parsedMetadata = JSON.parse(metadataText);
      
      // Check for DALL-E C2PA manifest
      if (parsedMetadata.c2pa_manifest || 
          (parsedMetadata.exif_data && (parsedMetadata.exif_data['openai:dalle'] || 
                                        parsedMetadata.exif_data.Software?.includes('DALL-E')))) {
        console.log(`✅ Detected DALL-E C2PA/EXIF metadata in JPEG.`);
        return parsedMetadata;
      }
      
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
 * Optimized version that accepts pre-loaded file data to avoid redundant IPC calls.
 */
async function processSingleFileOptimized(
  fileEntry: { handle: FileSystemFileHandle, path: string },
  directoryId: string,
  fileData?: ArrayBuffer
): Promise<IndexedImage | null> {
  try {
    let file: File;
    let rawMetadata: ImageMetadata | null;

    // If file data is provided (from batch read), parse directly from buffer
    if (fileData) {
      // OPTIMIZED: Parse directly from ArrayBuffer, create File object later only if needed
      const view = new DataView(fileData);
      if (view.getUint32(0) === 0x89504E47 && view.getUint32(4) === 0x0D0A1A0A) {
        console.log(`🖼️ Processing PNG file: ${fileEntry.handle.name}`);
        rawMetadata = await parsePNGMetadata(fileData);
      } else if (view.getUint16(0) === 0xFFD8) {
        rawMetadata = await parseJPEGMetadata(fileData);
      } else {
        rawMetadata = null;
      }
      // Create File object for dimension reading (if needed later)
      const blob = new Blob([fileData]);
      file = new File([blob], fileEntry.handle.name, { lastModified: Date.now() });
    } else {
      // Fallback to individual file read (browser path)
      file = await fileEntry.handle.getFile();
      rawMetadata = await parseImageMetadata(file);
    }

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
      // Check for Fooocus first (before other parsers)
      if ('parameters' in rawMetadata && 
          typeof rawMetadata.parameters === 'string' && 
          (rawMetadata.parameters.includes('Fooocus') ||
           rawMetadata.parameters.match(/Version:\s*f2\./i) ||
           rawMetadata.parameters.match(/Model:\s*flux/i) ||
           rawMetadata.parameters.includes('Distilled CFG Scale') ||
           rawMetadata.parameters.match(/Module\s*1:\s*ae/i))) {
        console.log('🎯 Detected Fooocus metadata, parsing...');
        normalizedMetadata = parseFooocusMetadata(rawMetadata as FooocusMetadata);
      } else if (isSwarmUIMetadata(rawMetadata)) {
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
      } else if (isNijiMetadata(rawMetadata)) {
        console.log(`✅ Successfully parsed Niji Journey metadata.`);
        normalizedMetadata = parseNijiMetadata(rawMetadata.parameters);
      } else if (isForgeMetadata(rawMetadata)) {
        normalizedMetadata = parseForgeMetadata(rawMetadata);
      } else if (isDalleMetadata(rawMetadata)) {
        normalizedMetadata = parseDalleMetadata(rawMetadata);
      } else if (isFireflyMetadata(rawMetadata)) {
        console.log(`✅ Successfully parsed Adobe Firefly metadata.`);
        normalizedMetadata = parseFireflyMetadata(rawMetadata, fileData!);
      } else if (isDreamStudioMetadata(rawMetadata)) {
        console.log(`✅ Successfully parsed DreamStudio metadata.`);
        normalizedMetadata = parseDreamStudioMetadata(rawMetadata.parameters);
      } else if (isDrawThingsMetadata(rawMetadata)) {
        console.log(`✅ Successfully parsed Draw Things metadata.`);
        normalizedMetadata = parseDrawThingsMetadata(rawMetadata.parameters);
      } else if (isInvokeAIMetadata(rawMetadata)) {
        normalizedMetadata = parseInvokeAIMetadata(rawMetadata as InvokeAIMetadata);
      }
    }

    // Read actual image dimensions - OPTIMIZED: Only if not already in metadata
    if (normalizedMetadata && (!normalizedMetadata.width || !normalizedMetadata.height)) {
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
      metadataString: rawMetadata ? JSON.stringify(rawMetadata) : '', // OPTIMIZED: Skip stringify if no metadata
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
 * Processes a single file entry (wrapper for backward compatibility).
 */
async function processSingleFile(
  fileEntry: { handle: FileSystemFileHandle, path: string },
  directoryId: string
): Promise<IndexedImage | null> {
  return processSingleFileOptimized(fileEntry, directoryId, undefined);
}

/**
 * Processes an array of file entries in batches to avoid blocking the main thread.
 * Invokes a callback with each batch of processed images.
 * OPTIMIZED: Uses batch file reading in Electron to reduce IPC overhead.
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
  const FILE_READ_BATCH_SIZE = 100; // Number of files to read at once (Electron only)
  const CONCURRENCY_LIMIT = isElectron ? 50 : 20; // Higher concurrency in Electron (less IPC overhead)
  let batch: IndexedImage[] = [];

  // Check if we're in Electron and can use optimized batch reading
  const useOptimizedPath = isElectron && (window as any).electronAPI?.readFilesBatch;

  // ===== OPTIMIZED PATH: Batch file reading (Electron only) =====
  if (useOptimizedPath) {
    console.log(`🚀 Using optimized batch file reading for ${total} images`);
    
    // Split files into read batches to reduce IPC overhead
    const fileReadBatches = chunkArray(imageFiles, FILE_READ_BATCH_SIZE);
    
    for (const readBatch of fileReadBatches) {
      // Extract ABSOLUTE file paths for batch reading (required for security check)
      const filePaths = readBatch.map(entry => {
        const filePath = (entry.handle as any)._filePath;
        if (!filePath) {
          console.error('Missing _filePath on file handle:', entry.handle.name);
        }
        return filePath;
      }).filter(Boolean);
      
      // Read all files in this batch at once via IPC
      const batchReadResult = await (window as any).electronAPI.readFilesBatch(filePaths);
      
      if (!batchReadResult.success) {
        console.error('Batch file read failed, falling back to individual reads');
        // Fall back to processing files individually
        for (const fileEntry of readBatch) {
          const indexedImage = await processSingleFile(fileEntry, directoryId);
          processedCount++;
          setProgress({ current: processedCount, total });
          
          if (indexedImage) {
            batch.push(indexedImage);
            if (batch.length >= BATCH_SIZE) {
              onBatchProcessed(batch);
              batch = [];
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
        }
        continue;
      }
      
      // Process files with pre-loaded data
      const fileDataMap = new Map<string, ArrayBuffer>();
      for (const fileResult of batchReadResult.files) {
        if (fileResult.success && fileResult.data) {
          fileDataMap.set(fileResult.path, fileResult.data.buffer || fileResult.data);
        }
      }
      
      // Process this read batch with concurrency (all in parallel since data is pre-loaded)
      const results = await Promise.all(
        readBatch.map(async (fileEntry) => {
          const filePath = (fileEntry.handle as any)._filePath;
          const fileData = fileDataMap.get(filePath);
          
          const indexedImage = await processSingleFileOptimized(fileEntry, directoryId, fileData);
          processedCount++;
          
          return indexedImage;
        })
      );
      
      // Update progress once per batch (more efficient)
      setProgress({ current: processedCount, total });
      
      // Collect results into batches
      for (const indexedImage of results) {
        if (indexedImage) {
          batch.push(indexedImage);
          if (batch.length >= BATCH_SIZE) {
            onBatchProcessed(batch);
            batch = [];
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
      }
    }
    
    // Process any remaining images
    if (batch.length > 0) {
      onBatchProcessed(batch);
    }
    
    console.log(`✅ Completed optimized batch processing of ${total} images`);
    return;
  }
  
  // ===== STANDARD PATH: Individual file reading (Browser or fallback) =====
  console.log(`📂 Using standard file reading for ${total} images`);
  
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
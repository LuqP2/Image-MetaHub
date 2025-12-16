/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { IncrementalCacheWriter, type CacheImageMetadata } from './cacheManager';

import { type IndexedImage, type ImageMetadata, type BaseMetadata, isInvokeAIMetadata, isAutomatic1111Metadata, isComfyUIMetadata, isSwarmUIMetadata, isEasyDiffusionMetadata, isEasyDiffusionJson, isMidjourneyMetadata, isNijiMetadata, isForgeMetadata, isDalleMetadata, isFireflyMetadata, isDreamStudioMetadata, isDrawThingsMetadata, ComfyUIMetadata, InvokeAIMetadata, SwarmUIMetadata, EasyDiffusionMetadata, EasyDiffusionJson, MidjourneyMetadata, NijiMetadata, ForgeMetadata, DalleMetadata, FireflyMetadata, DrawThingsMetadata, FooocusMetadata } from '../types';
import { parse } from 'exifr';
import { resolvePromptFromGraph } from './parsers/comfyUIParser';
import { parseInvokeAIMetadata } from './parsers/invokeAIParser';
import { parseA1111Metadata } from './parsers/automatic1111Parser';
import { parseSwarmUIMetadata } from './parsers/swarmUIParser';

// Simple throttle utility to avoid excessive progress updates
function throttle<T extends (...args: any[]) => any>(func: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastCall = 0;

  return ((...args: any[]) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    } else {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        func(...args);
      }, delay - (now - lastCall));
    }
  }) as T;
}

// Extended FileSystemFileHandle interface for Electron compatibility
interface ElectronFileHandle extends FileSystemFileHandle {
  _filePath?: string;
}

interface CatalogFileEntry {
  handle: FileSystemFileHandle;
  path: string;
  lastModified: number;
  size?: number;
  type?: string;
  birthtimeMs?: number;
}
import { parseEasyDiffusionMetadata, parseEasyDiffusionJson } from './parsers/easyDiffusionParser';
import { parseMidjourneyMetadata } from './parsers/midjourneyParser';
import { parseNijiMetadata } from './parsers/nijiParser';
import { parseForgeMetadata } from './parsers/forgeParser';
import { parseDalleMetadata } from './parsers/dalleParser';
import { parseFireflyMetadata } from './parsers/fireflyParser';
import { parseDreamStudioMetadata } from './parsers/dreamStudioParser';
import { parseDrawThingsMetadata } from './parsers/drawThingsParser';
import { parseFooocusMetadata } from './parsers/fooocusParser';
import { parseSDNextMetadata } from './parsers/sdNextParser';

function sanitizeJson(jsonString: string): string {
    // Replace NaN with null, as NaN is not valid JSON
    return jsonString.replace(/:\s*NaN/g, ': null');
}

// Electron detection for optimized batch reading
const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
const isProduction = Boolean(
  (typeof globalThis !== 'undefined' && (globalThis as any)?.process?.env?.NODE_ENV === 'production') ||
  (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.PROD)
);
const shouldLogPngDebug = Boolean(
  (typeof globalThis !== 'undefined' && (globalThis as any)?.process?.env?.PNG_DEBUG === 'true') ||
  (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.VITE_PNG_DEBUG)
);

// Helper function to chunk array into smaller arrays
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Decode iTXt text payload (supports uncompressed and deflate-compressed)
async function decodeITXtText(
  data: Uint8Array,
  compressionFlag: number,
  decoder: TextDecoder
): Promise<string> {
  if (compressionFlag === 0) {
    return decoder.decode(data);
  }

  if (compressionFlag === 1) {
    // Deflate-compressed (zlib) text
    try {
      // Prefer browser-native DecompressionStream (Chromium/Electron)
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate');
        // Ensure we pass a real ArrayBuffer (not SharedArrayBuffer) to Blob to satisfy TS/DOM types
        const arrayCopy = new Uint8Array(data.byteLength);
        arrayCopy.set(data);
        const arrayBuf = arrayCopy.buffer;
        const decompressedStream = new Blob([arrayBuf]).stream().pipeThrough(ds);
        const decompressedBuffer = await new Response(decompressedStream).arrayBuffer();
        return decoder.decode(decompressedBuffer);
      }
      // Fallback for Node.js (should rarely be needed in renderer)
      if (typeof require !== 'undefined') {
        const zlib = await import('zlib');
        const inflated = zlib.inflateSync(Buffer.from(data));
        return decoder.decode(inflated);
      }
    } catch (err) {
      if (shouldLogPngDebug) {
        console.warn('[PNG DEBUG] Failed to decompress iTXt chunk', err);
      }
      return '';
    }
  }

  return '';
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
  } catch {
    // Silent error - most images won't have sidecar JSON
    return null;
  }
}

// Main parsing function for PNG files
async function parsePNGMetadata(buffer: ArrayBuffer): Promise<ImageMetadata | null> {
  const view = new DataView(buffer);
  let offset = 8;
  const decoder = new TextDecoder();
  const chunks: { [key: string]: string } = {};
  
  // OPTIMIZATION: Stop early if we found all needed chunks
  let foundChunks = 0;
  const maxChunks = 5; // invokeai_metadata, parameters, workflow, prompt, Description

  while (offset < view.byteLength && foundChunks < maxChunks) {
    const length = view.getUint32(offset);
    const type = decoder.decode(buffer.slice(offset + 4, offset + 8));
    
    if (type === 'tEXt') {
      const chunkData = buffer.slice(offset + 8, offset + 8 + length);
      const chunkString = decoder.decode(chunkData);
      const [keyword, text] = chunkString.split('\0');
      
      if (['invokeai_metadata', 'parameters', 'Parameters', 'workflow', 'prompt', 'Description'].includes(keyword) && text) {
        chunks[keyword.toLowerCase()] = text;
        foundChunks++;
      }
    } else if (type === 'iTXt') {
      const chunkData = new Uint8Array(buffer.slice(offset + 8, offset + 8 + length));
      const keywordEndIndex = chunkData.indexOf(0);
      if (keywordEndIndex === -1) {
        offset += 12 + length;
        continue;
      }
      const keyword = decoder.decode(chunkData.slice(0, keywordEndIndex));

      if (['invokeai_metadata', 'parameters', 'Parameters', 'workflow', 'prompt', 'Description'].includes(keyword)) {
        const compressionFlag = chunkData[keywordEndIndex + 1];
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

        const text = await decodeITXtText(chunkData.slice(currentIndex), compressionFlag, decoder);
        if (text) {
          chunks[keyword.toLowerCase()] = text;
          foundChunks++;
        }
      }
    }
    if (type === 'IEND') break;
    offset += 12 + length;
  }

  // Prioritize workflow for ComfyUI, then parameters for A1111, then InvokeAI
  if (chunks.workflow) {
    const comfyMetadata: ComfyUIMetadata = {};
    if (chunks.workflow) comfyMetadata.workflow = chunks.workflow;
    if (chunks.prompt) comfyMetadata.prompt = chunks.prompt;
    return comfyMetadata;
  } else if (chunks.parameters || chunks.description) {
    const paramsValue = chunks.parameters || chunks.description;
    if (shouldLogPngDebug) {
      console.log('[PNG DEBUG] Found parameters chunk:', {
        length: paramsValue.length,
        preview: paramsValue.substring(0, 150),
        hasSuiImageParams: paramsValue.includes('sui_image_params')
      });
    }
    return { parameters: paramsValue };
  } else if (chunks.invokeai_metadata) {
    return JSON.parse(chunks.invokeai_metadata);
  } else if (chunks.prompt) {
    return { prompt: chunks.prompt };
  }

  // Always try to extract EXIF/XMP data from PNG (many modern apps like Draw Things use XMP)
  try {
    const exifResult = await parseJPEGMetadata(buffer);
    if (exifResult) {
      return exifResult;
    }
  } catch {
    // Silent error - EXIF extraction may fail
  }

  // If no EXIF found, try PNG chunks as fallback
  // ...existing code...
}

// Main parsing function for JPEG files
async function parseJPEGMetadata(buffer: ArrayBuffer): Promise<ImageMetadata | null> {
  try {
    // Extract EXIF data with UserComment and XMP support
    const exifData = await parse(buffer, {
      userComment: true,
      xmp: true,
      mergeOutput: true,
      sanitize: false,
      reviveValues: true
    });
    
    if (!exifData) return null;
    
    // Check all possible field names for UserComment (A1111 and SwarmUI store metadata here in JPEGs)
    // Also check XMP Description for Draw Things and other XMP-based metadata
    let metadataText: string | Uint8Array | undefined = 
      exifData.UserComment || 
      exifData.userComment ||
      exifData['User Comment'] ||
      exifData.ImageDescription || 
      exifData.Parameters ||
      exifData.Description || // XMP Description
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
      return null;
    }

    // ========== CRITICAL FIX: Check for ComfyUI FIRST (before other patterns) ==========
    // ComfyUI images stored as JPEG with A1111-style parameters in EXIF
    if (metadataText.includes('Version: ComfyUI')) {
      return { parameters: metadataText };
    }

    // No ComfyUI detected, checking other patterns...

    // ========== DRAW THINGS XMP FORMAT DETECTION ==========
    // Draw Things stores metadata in XMP format: {"lang":"x-default","value":"{JSON}"}
    if (metadataText.includes('"lang":"x-default"') && metadataText.includes('"value":')) {
      try {
        const xmpData = JSON.parse(metadataText);
        if (xmpData.value && typeof xmpData.value === 'string') {
          const innerJson = xmpData.value;
          // Check if the inner JSON contains Draw Things characteristics
          if (innerJson.includes('"c":') && (innerJson.includes('"model":') || innerJson.includes('"sampler":') || innerJson.includes('"scale":'))) {
            // Return in the expected format with Draw Things indicators so it gets routed to Draw Things parser
            return { parameters: 'Draw Things ' + innerJson, userComment: innerJson };
          }
        }
      } catch {
        // Not valid JSON, continue with other checks
      }
    }

    // A1111-style data is often not valid JSON, so we check for its characteristic pattern first.
    // Check for Civitai resources format first (A1111 without Model hash but with Civitai resources)
    if (metadataText.includes('Civitai resources:') && metadataText.includes('Steps:')) {
      return { parameters: metadataText };
    }
    if (metadataText.includes('Steps:') && metadataText.includes('Sampler:') && metadataText.includes('Model hash:')) {
      return { parameters: metadataText };
    }

    // Easy Diffusion uses similar format but without Model hash
    if (metadataText.includes('Prompt:') && metadataText.includes('Steps:') && metadataText.includes('Sampler:') && !metadataText.includes('Model hash:')) {
      return { parameters: metadataText };
    }

    // Midjourney uses parameter flags like --v, --ar, --q, --s
    if (metadataText.includes('--v') || metadataText.includes('--ar') || metadataText.includes('--q') || metadataText.includes('--s') || metadataText.includes('Midjourney')) {
      return { parameters: metadataText };
    }

    // Forge uses A1111-style parameters but includes "Forge" or "Gradio" indicators
    if ((metadataText.includes('Forge') || metadataText.includes('Gradio')) && 
        metadataText.includes('Steps:') && metadataText.includes('Sampler:') && metadataText.includes('Model hash:')) {
      return { parameters: metadataText };
    }

    // Draw Things (iOS/Mac AI app) - SIMPLIFIED: If it has Guidance Scale + Steps + Sampler, it's Draw Things
    if (metadataText.includes('Guidance Scale:') && metadataText.includes('Steps:') && metadataText.includes('Sampler:') &&
        !metadataText.includes('Model hash:') && !metadataText.includes('Forge') && !metadataText.includes('Gradio') &&
        !metadataText.includes('DreamStudio') && !metadataText.includes('Stability AI') && !metadataText.includes('--niji')) {
      // Extract UserComment JSON if available
      let userComment: string | undefined;
      if (exifData.UserComment || exifData.userComment || exifData['User Comment']) {
        const comment = exifData.UserComment || exifData.userComment || exifData['User Comment'];
        if (typeof comment === 'string' && comment.includes('{')) {
          userComment = comment;
        }
      }
      return { parameters: metadataText, userComment };
    }

    // Try to parse as JSON for other formats like SwarmUI, InvokeAI, ComfyUI, or DALL-E
    try {
      const parsedMetadata = JSON.parse(metadataText);

      // Check for DALL-E C2PA manifest
      if (parsedMetadata.c2pa_manifest ||
          (parsedMetadata.exif_data && (parsedMetadata.exif_data['openai:dalle'] ||
                                        parsedMetadata.exif_data.Software?.includes('DALL-E')))) {
        return parsedMetadata;
      }

      // Check for SwarmUI format (sui_image_params)
      if (parsedMetadata.sui_image_params) {
        return parsedMetadata;
      }

      if (isInvokeAIMetadata(parsedMetadata)) {
        return parsedMetadata;
      } else if (isComfyUIMetadata(parsedMetadata)) {
        return parsedMetadata;
      } else {
        return parsedMetadata;
      }
    } catch {
      // JSON parsing failed - check for ComfyUI patterns in raw text
      // ComfyUI sometimes stores workflow/prompt as JSON strings in EXIF
      if (metadataText.includes('"workflow"') || metadataText.includes('"prompt"') ||
          metadataText.includes('last_node_id') || metadataText.includes('class_type') ||
          metadataText.includes('Version: ComfyUI')) {
        // Try to extract workflow and prompt from the text
        try {
          // Look for workflow JSON
          const workflowMatch = metadataText.match(/"workflow"\s*:\s*(\{[^}]*\}|\[[^\]]*\]|"[^"]*")/);
          const promptMatch = metadataText.match(/"prompt"\s*:\s*(\{[^}]*\}|\[[^\]]*\]|"[^"]*")/);

          const comfyMetadata: Partial<ComfyUIMetadata> = {};

          if (workflowMatch) {
            try {
              comfyMetadata.workflow = JSON.parse(workflowMatch[1]);
            } catch {
              comfyMetadata.workflow = workflowMatch[1];
            }
          }

          if (promptMatch) {
            try {
              comfyMetadata.prompt = JSON.parse(promptMatch[1]);
            } catch {
              comfyMetadata.prompt = promptMatch[1];
            }
          }

          // If we found either workflow or prompt, return as ComfyUI metadata
          if (comfyMetadata.workflow || comfyMetadata.prompt) {
            return comfyMetadata;
          }

          // Special case: If we detected "Version: ComfyUI" but couldn't extract workflow/prompt,
          // this might be a ComfyUI image with parameters stored in A1111-style format
          // Return it as parameters so it gets parsed by A1111 parser which can handle ComfyUI format
          if (metadataText.includes('Version: ComfyUI')) {
            return { parameters: metadataText };
          }
        } catch {
          // Silent error - pattern matching failed
        }
      }

      // Silent error - JSON parsing may fail
      return null;
    }
  } catch {
    // Silent error - EXIF parsing may fail
    return null;
  }
}

// Extract dimensions without decoding the full image
function extractDimensionsFromBuffer(buffer: ArrayBuffer): { width: number; height: number } | null {
  const view = new DataView(buffer);

  // PNG signature + IHDR
  if (view.getUint32(0) === 0x89504E47 && view.getUint32(4) === 0x0D0A1A0A) {
    // IHDR chunk starts at byte 16, big-endian
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  // JPEG SOF markers
  if (view.getUint16(0) === 0xFFD8) {
    let offset = 2;
    const length = view.byteLength;
    while (offset < length) {
      if (view.getUint8(offset) !== 0xFF) {
        break;
      }
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2, false);

      // SOF0 - SOF15 (except padding markers)
      if (marker >= 0xC0 && marker <= 0xC3 || marker >= 0xC5 && marker <= 0xC7 || marker >= 0xC9 && marker <= 0xCB || marker >= 0xCD && marker <= 0xCF) {
        const height = view.getUint16(offset + 5, false);
        const width = view.getUint16(offset + 7, false);
        if (width > 0 && height > 0) {
          return { width, height };
        }
        break;
      }

      // Prevent infinite loop
      if (size < 2) {
        break;
      }
      offset += 2 + size;
    }
  }

  return null;
}

// Main image metadata parser
async function parseImageMetadata(file: File): Promise<{ metadata: ImageMetadata | null; buffer: ArrayBuffer }> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  
  if (!isProduction) {
    console.log('[FILE DEBUG] Processing file:', {
      name: file.name,
      size: file.size,
      isPNG: view.getUint32(0) === 0x89504E47,
      isJPEG: view.getUint16(0) === 0xFFD8,
    });
  }
  
  if (view.getUint32(0) === 0x89504E47 && view.getUint32(4) === 0x0D0A1A0A) {
    const result = await parsePNGMetadata(buffer);
    if (!isProduction) {
      console.log('[FILE DEBUG] PNG metadata result:', {
        name: file.name,
        hasResult: !!result,
        resultType: result ? Object.keys(result)[0] : 'none',
      });
    }
    return { metadata: result, buffer };
  }
  if (view.getUint16(0) === 0xFFD8) {
    return { metadata: await parseJPEGMetadata(buffer), buffer };
  }
  return { metadata: null, buffer };
}

/**
 * Processes a single file entry to extract metadata and create an IndexedImage object.
 * Optimized version that accepts pre-loaded file data to avoid redundant IPC calls.
 */
async function processSingleFileOptimized(
  fileEntry: CatalogFileEntry,
  directoryId: string,
  fileData?: ArrayBuffer
): Promise<IndexedImage | null> {
  try {
    let file: File;
    let rawMetadata: ImageMetadata | null;
    let bufferForDimensions: ArrayBuffer | undefined;

    // If file data is provided (from batch read), parse directly from buffer
    if (fileData) {
      // OPTIMIZED: Parse directly from ArrayBuffer, create File object later only if needed
      const view = new DataView(fileData);
      if (view.getUint32(0) === 0x89504E47 && view.getUint32(4) === 0x0D0A1A0A) {
        rawMetadata = await parsePNGMetadata(fileData);
      } else if (view.getUint16(0) === 0xFFD8) {
        rawMetadata = await parseJPEGMetadata(fileData);
      } else {
        rawMetadata = null;
      }
      bufferForDimensions = fileData;
      // Create File object for dimension reading (if needed later)
      const blob = new Blob([fileData]);
      file = new File([blob], fileEntry.handle.name, { lastModified: Date.now() });
    } else {
      // Fallback to individual file read (browser path)
      file = await fileEntry.handle.getFile();
      const parsed = await parseImageMetadata(file);
      rawMetadata = parsed.metadata;
      bufferForDimensions = parsed.buffer;
    }

    // Try to read sidecar JSON for Easy Diffusion (fallback if no embedded metadata)
    if (!rawMetadata) {
      const sidecarJson = await tryReadEasyDiffusionSidecarJson(fileEntry.path);
      if (sidecarJson) {
        rawMetadata = sidecarJson;
      }
    }

// ==============================================================================
// SUBSTITUA o bloco inteiro de parsing (linhas ~304-360) por este código:
// Comece a substituir em: let normalizedMetadata: BaseMetadata | undefined;
// Termine antes de: // Read actual image dimensions
// ==============================================================================

let normalizedMetadata: BaseMetadata | undefined;
if (rawMetadata) {
  
  // Priority 1: Check for ComfyUI (has unique 'workflow' structure)
  if (isComfyUIMetadata(rawMetadata)) {
    const comfyMetadata = rawMetadata as ComfyUIMetadata;
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
      // console.error("Failed to parse ComfyUI workflow/prompt JSON:", e);
    }
    const resolvedParams = resolvePromptFromGraph(workflow, prompt);
    normalizedMetadata = {
      prompt: resolvedParams.prompt || '',
      negativePrompt: resolvedParams.negativePrompt || '',
      model: resolvedParams.model || '',
      models: resolvedParams.model ? [resolvedParams.model] : [],
      width: 0,
      height: 0,
      seed: resolvedParams.seed,
      steps: resolvedParams.steps || 0,
      cfg_scale: resolvedParams.cfg,
      scheduler: resolvedParams.scheduler || '',
      sampler: resolvedParams.sampler_name || '',
      loras: Array.isArray(resolvedParams.lora) ? resolvedParams.lora : (resolvedParams.lora ? [resolvedParams.lora] : []),
    };
  }
  
  // Priority 2: Check for text-based formats (A1111, Forge, Fooocus all use 'parameters' string)
  else if ('parameters' in rawMetadata && typeof rawMetadata.parameters === 'string') {
    const params = rawMetadata.parameters;
    
    // Sub-priority 2.0: Check if parameters contains SwarmUI JSON format
    // SwarmUI can save metadata as JSON string in parameters field
    if (params.trim().startsWith('{') && params.includes('sui_image_params')) {
      try {
        const parsedParams = JSON.parse(params);
        if (parsedParams.sui_image_params) {
          normalizedMetadata = parseSwarmUIMetadata(parsedParams as SwarmUIMetadata);
        }
      } catch {
        // Not valid SwarmUI JSON, continue with other checks
      }
    }
    
    // Sub-priority 2.1: SD.Next (has "App: SD.Next" indicator)
    if (!normalizedMetadata && params.includes('App: SD.Next')) {
      normalizedMetadata = parseSDNextMetadata(params);
    }
    
    // Sub-priority 2.2: Forge (most specific - has Model hash + Forge/Gradio)
    else if (!normalizedMetadata && (params.includes('Forge') || params.includes('Gradio')) && 
        params.includes('Steps:') && params.includes('Sampler:') && params.includes('Model hash:')) {
      normalizedMetadata = parseForgeMetadata(rawMetadata);
    }
    
    // Sub-priority 2.3: Fooocus (specific indicators but NO Model hash)
    // CRITICAL: Must check for absence of Model hash to avoid capturing Forge/A1111
    else if (!normalizedMetadata && (params.includes('Fooocus') || 
             (params.includes('Sharpness:') && !params.includes('Model hash:')))) {
      normalizedMetadata = parseFooocusMetadata(rawMetadata as FooocusMetadata);
    }
    
    // Sub-priority 2.4: A1111/ComfyUI hybrid (has Model hash or Version indicators, or Civitai resources)
    // This catches: standard A1111, ComfyUI with A1111 format, Forge variants, and A1111 with Civitai resources
    else if (!normalizedMetadata && (params.includes('Model hash:') ||
             params.includes('Version: ComfyUI') ||
             /Version:\s*f\d+\./i.test(params) ||  // Forge versions like f2.0.1
             params.includes('Distilled CFG Scale') ||
             /Module\s*\d+:/i.test(params) ||
             params.includes('Civitai resources:'))) {
      normalizedMetadata = parseA1111Metadata(params);
    }
    
    // Sub-priority 2.5: Other parameter-based formats
    else if (!normalizedMetadata && (params.includes('DreamStudio') || params.includes('Stability AI'))) {
      normalizedMetadata = parseDreamStudioMetadata(params);
    }
    else if (!normalizedMetadata && (params.includes('iPhone') || params.includes('iPad') || params.includes('Draw Things')) &&
             !params.includes('Model hash:')) {
      const userComment = 'userComment' in rawMetadata ? String(rawMetadata.userComment) : undefined;
      normalizedMetadata = parseDrawThingsMetadata(params, userComment);
    }
    else if (!normalizedMetadata && params.includes('--niji')) {
      normalizedMetadata = parseNijiMetadata(params);
    }
    else if (!normalizedMetadata && (params.includes('--v') || params.includes('--ar') || params.includes('Midjourney'))) {
      normalizedMetadata = parseMidjourneyMetadata(params);
    }
    else if (!normalizedMetadata && params.includes('Prompt:') && params.includes('Steps:')) {
      // Generic SD-like format - try Easy Diffusion
      normalizedMetadata = parseEasyDiffusionMetadata(params);
    }
    else if (!normalizedMetadata) {
      // Fallback: Try A1111 parser for any other parameter string
      normalizedMetadata = parseA1111Metadata(params);
    }
  }
  
  // Priority 3: SwarmUI (has unique 'sui_image_params' structure)
  else if (isSwarmUIMetadata(rawMetadata)) {
    normalizedMetadata = parseSwarmUIMetadata(rawMetadata as SwarmUIMetadata);
  }
  
  // Priority 4: Easy Diffusion JSON (simple JSON with 'prompt' field)
  else if (isEasyDiffusionJson(rawMetadata)) {
    normalizedMetadata = parseEasyDiffusionJson(rawMetadata as EasyDiffusionJson);
  }
  
  // Priority 5: DALL-E (has C2PA manifest)
  else if (isDalleMetadata(rawMetadata)) {
    normalizedMetadata = parseDalleMetadata(rawMetadata);
  }
  
  // Priority 6: Firefly (has C2PA with Adobe signatures)
  else if (isFireflyMetadata(rawMetadata)) {
    normalizedMetadata = parseFireflyMetadata(rawMetadata, fileData!);
  }
  
  // Priority 7: InvokeAI (fallback for remaining metadata)
  else if (isInvokeAIMetadata(rawMetadata)) {
    normalizedMetadata = parseInvokeAIMetadata(rawMetadata as InvokeAIMetadata);
  }
  
  // Priority 8: Unknown format
  else {
    // Unknown metadata format, no parser applied
  }
}

// ==============================================================================
// FIM DA SUBSTITUIÇÃO - O código seguinte (Read actual image dimensions) 
// deve permanecer como está
// ==============================================================================
    const fallbackType = fileEntry.handle.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    const normalizedFileType = fileEntry.type ?? (file.type || fallbackType);
    const normalizedFileSize = fileEntry.size ?? file.size;

    // Read actual image dimensions - OPTIMIZED: Only if not already in metadata
    if (normalizedMetadata && (!normalizedMetadata.width || !normalizedMetadata.height) && bufferForDimensions) {
      const dims = extractDimensionsFromBuffer(bufferForDimensions);
      if (dims) {
        normalizedMetadata.width = normalizedMetadata.width || dims.width;
        normalizedMetadata.height = normalizedMetadata.height || dims.height;
      }
    }

    // Determine the best date for sorting (generation date vs file date)
    const sortDate = fileEntry.birthtimeMs ?? fileEntry.lastModified ?? file.lastModified;

    return {
      id: `${directoryId}::${fileEntry.path}`,
      name: fileEntry.handle.name,
      handle: fileEntry.handle,
      thumbnailStatus: 'pending',
      thumbnailError: null,
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
      fileSize: normalizedFileSize,
      fileType: normalizedFileType,
    } as IndexedImage;
  } catch (error) {
    console.error(`Skipping file ${fileEntry.handle.name} due to an error:`, error);
    return null;
  }
}

/**
 * Processes an array of file entries in batches to avoid blocking the main thread.
 * Invokes a callback with each batch of processed images.
 * OPTIMIZED: Uses batch file reading in Electron to reduce IPC overhead.
 */
interface CatalogEntryState {
  image: IndexedImage;
  chunkIndex: number;
  chunkOffset: number;
  needsEnrichment: boolean;
  source?: CatalogFileEntry;
}

interface PhaseTelemetry {
  startTime: number;
  processed: number;
  bytesWritten: number;
  ipcCalls: number;
  diskWrites: number;
}

interface ProcessFilesOptions {
  cacheWriter?: IncrementalCacheWriter | null;
  concurrency?: number;
  flushChunkSize?: number;
  preloadedImages?: IndexedImage[];
  fileStats?: Map<string, { size?: number; type?: string; birthtimeMs?: number }>;
  onEnrichmentBatch?: (batch: IndexedImage[]) => void;
  enrichmentBatchSize?: number;
  onEnrichmentProgress?: (progress: { processed: number; total: number } | null) => void;
  hydratePreloadedImages?: boolean;
}

export interface ProcessFilesResult {
  phaseB: Promise<void>;
}

function mapIndexedImageToCache(image: IndexedImage): CacheImageMetadata {
  return {
    id: image.id,
    name: image.name,
    metadataString: image.metadataString,
    metadata: image.metadata,
    lastModified: image.lastModified,
    models: image.models,
    loras: image.loras,
    scheduler: image.scheduler,
    board: image.board,
    prompt: image.prompt,
    negativePrompt: image.negativePrompt,
    cfgScale: image.cfgScale,
    steps: image.steps,
    seed: image.seed,
    dimensions: image.dimensions,
    enrichmentState: image.enrichmentState,
    fileSize: image.fileSize,
    fileType: image.fileType,
  };
}

export async function processFiles(
  fileEntries: CatalogFileEntry[],
  setProgress: (progress: { current: number; total: number }) => void,
  onBatchProcessed: (batch: IndexedImage[]) => void,
  directoryId: string,
  directoryName: string,
  scanSubfolders: boolean,
  _onDeletion: (deletedFileIds: string[]) => void,
  abortSignal?: AbortSignal,
  waitWhilePaused?: () => Promise<void>,
  options: ProcessFilesOptions = {}
): Promise<ProcessFilesResult> {
  if (abortSignal?.aborted) {
    return { phaseB: Promise.resolve() };
  }

  const cacheWriter = options.cacheWriter ?? null;
  const chunkThreshold = options.flushChunkSize ?? cacheWriter?.targetChunkSize ?? 512;
  const concurrencyLimit = options.concurrency ?? 4;
  const enrichmentBatchSize = options.enrichmentBatchSize ?? 256;
  const statsLookup = options.fileStats ?? new Map<string, { size?: number; type?: string; birthtimeMs?: number }>();

  const phaseAStats: PhaseTelemetry = {
    startTime: performance.now(),
    processed: 0,
    bytesWritten: 0,
    ipcCalls: 0,
    diskWrites: 0,
  };
  const phaseBStats: PhaseTelemetry = {
    startTime: 0,
    processed: 0,
    bytesWritten: 0,
    ipcCalls: 0,
    diskWrites: 0,
  };

  performance.mark('indexing:phaseA:start');

  const catalogState = new Map<string, CatalogEntryState>();
  const chunkRecords: CacheImageMetadata[][] = [];
  const chunkMap = new Map<string, { chunkIndex: number; offset: number }>();
  const enrichmentQueue: CatalogEntryState[] = [];
  const chunkBuffer: IndexedImage[] = [];
  const uiBatch: IndexedImage[] = [];
  const BATCH_SIZE = 50;
  const totalPhaseAFiles = (options.preloadedImages?.length ?? 0) + fileEntries.length;
  const totalNewFiles = fileEntries.length;
  let processedNew = 0;
  let nextPhaseALog = 5000;

  const pushUiBatch = async (force = false) => {
    if (uiBatch.length === 0) {
      return;
    }
    if (!force && uiBatch.length < BATCH_SIZE) {
      return;
    }
    onBatchProcessed([...uiBatch]);
    uiBatch.length = 0;
    await new Promise(resolve => setTimeout(resolve, 0));
  };

  const flushChunk = async (force = false) => {
    if (chunkBuffer.length === 0) {
      return;
    }
    if (!force && chunkBuffer.length < chunkThreshold) {
      return;
    }

    const chunkImages = chunkBuffer.splice(0, chunkBuffer.length);
    const metadataChunk = chunkImages.map(mapIndexedImageToCache);
    const chunkIndex = chunkRecords.length;
    chunkRecords.push(metadataChunk);

    chunkImages.forEach((img, offset) => {
      chunkMap.set(img.id, { chunkIndex, offset });
      const entry = catalogState.get(img.id);
      if (entry) {
        entry.chunkIndex = chunkIndex;
        entry.chunkOffset = offset;
      }
    });

    if (cacheWriter) {
      const flushStart = performance.now();
      await cacheWriter.append(chunkImages, metadataChunk);
      const duration = performance.now() - flushStart;
      const bytesWritten = JSON.stringify(metadataChunk).length;
      phaseAStats.bytesWritten += bytesWritten;
      phaseAStats.diskWrites += 1;
      phaseAStats.ipcCalls += 1;
      performance.mark('indexing:phaseA:chunk-flush', {
        detail: { chunkIndex, durationMs: duration, bytesWritten }
      });
    }
  };

  const maybeLogPhaseA = () => {
    if (phaseAStats.processed === 0) {
      return;
    }
    if (phaseAStats.processed >= nextPhaseALog || phaseAStats.processed === totalPhaseAFiles) {
      const elapsed = performance.now() - phaseAStats.startTime;
      const avg = phaseAStats.processed > 0 ? elapsed / phaseAStats.processed : 0;
      console.log('[indexing]', {
        phase: 'A',
        files: phaseAStats.processed,
        ipc_calls: phaseAStats.ipcCalls,
        writes: phaseAStats.diskWrites,
        bytes_written: phaseAStats.bytesWritten,
        avg_ms_per_file: Number(avg.toFixed(2)),
      });
      nextPhaseALog += 5000;
    }
  };

  const registerCatalogImage = async (
    image: IndexedImage,
    source: CatalogFileEntry | undefined,
    needsEnrichment: boolean,
    countTowardsProgress: boolean,
    emitToUi: boolean = true
  ) => {
    if (abortSignal?.aborted) {
      return;
    }

    const entry: CatalogEntryState = {
      image,
      chunkIndex: -1,
      chunkOffset: -1,
      needsEnrichment,
      source,
    };
    catalogState.set(image.id, entry);

    if (needsEnrichment && source) {
      enrichmentQueue.push(entry);
    }

    if (emitToUi) {
      uiBatch.push(image);
    }
    chunkBuffer.push(image);

    phaseAStats.processed += 1;
    maybeLogPhaseA();

    if (countTowardsProgress) {
      processedNew += 1;
      setProgress({ current: processedNew, total: totalNewFiles });
    }

    if (emitToUi) {
      await pushUiBatch();
    }
    await flushChunk();
  };

  const buildCatalogStub = (
    entry: CatalogFileEntry,
    needsEnrichment: boolean
  ): IndexedImage => {
    const stat = statsLookup.get(entry.path);
    const fileSize = entry.size ?? stat?.size;
    const inferredType = entry.type ?? stat?.type ?? (entry.handle.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
    const sortDate = entry.birthtimeMs ?? stat?.birthtimeMs ?? entry.lastModified;
    const catalogMetadata = {
      phase: 'catalog',
      fileSize,
      fileType: inferredType,
      lastModified: sortDate,
    } as any;

    const metadataString = JSON.stringify({
      phase: 'catalog',
      fileSize,
      fileType: inferredType,
      lastModified: sortDate,
    });

    return {
      id: `${directoryId}::${entry.path}`,
      name: entry.handle.name,
      handle: entry.handle,
      thumbnailStatus: 'pending',
      thumbnailError: null,
      directoryId,
      directoryName,
      metadata: catalogMetadata,
      metadataString,
      lastModified: sortDate,
      models: [],
      loras: [],
      scheduler: '',
      board: undefined,
      prompt: undefined,
      negativePrompt: undefined,
      cfgScale: undefined,
      steps: undefined,
      seed: undefined,
      dimensions: undefined,
      enrichmentState: needsEnrichment ? 'catalog' : 'enriched',
      fileSize,
      fileType: inferredType,
    };
  };

  // Phase A: load any cached images first so they are part of the catalog output
  const preloadedImages = options.preloadedImages ?? [];
  const hydratePreloadedImages = options.hydratePreloadedImages ?? true;
  for (const image of preloadedImages) {
    const stub = {
      ...image,
      directoryId,
      directoryName,
      enrichmentState: image.enrichmentState ?? 'enriched',
      fileSize: image.fileSize ?? statsLookup.get(image.name)?.size,
      fileType: image.fileType ?? statsLookup.get(image.name)?.type,
    } as IndexedImage;
    await registerCatalogImage(stub, undefined, false, false, hydratePreloadedImages);
  }

  if (preloadedImages.length > 0) {
    await flushChunk(true);
    await pushUiBatch(true);
  }

  const imageFiles = fileEntries.filter(entry => /\.(png|jpg|jpeg)$/i.test(entry.handle.name));

  const asyncPool = async <T, R>(
    concurrency: number,
    iterable: T[],
    iteratorFn: (item: T) => Promise<R>
  ): Promise<R[]> => {
    const ret: Promise<R>[] = [];
    const executing = new Set<Promise<R>>();

    for (const item of iterable) {
      if (abortSignal?.aborted) {
        break;
      }

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
  };

  const useOptimizedPath = isElectron && (window as any).electronAPI?.readFilesBatch;
  const FILE_READ_BATCH_SIZE = 32;

  const processEnrichmentResult = (entry: CatalogEntryState, enriched: IndexedImage | null) => {
    if (!enriched) {
      return null;
    }

    const merged: IndexedImage = {
      ...entry.image,
      metadata: enriched.metadata,
      metadataString: enriched.metadataString,
      lastModified: enriched.lastModified,
      models: enriched.models,
      loras: enriched.loras,
      scheduler: enriched.scheduler,
      board: enriched.board,
      prompt: enriched.prompt,
      negativePrompt: enriched.negativePrompt,
      cfgScale: enriched.cfgScale,
      steps: enriched.steps,
      seed: enriched.seed,
      dimensions: enriched.dimensions,
      enrichmentState: 'enriched',
    };

    entry.image = merged;
    const loc = chunkMap.get(merged.id);
    if (loc) {
      const cacheRecord = chunkRecords[loc.chunkIndex][loc.offset];
      Object.assign(cacheRecord, mapIndexedImageToCache(merged));
    }

    return merged;
  };

  for (const entry of imageFiles) {
    if (abortSignal?.aborted) {
      break;
    }

    if (waitWhilePaused) {
      await waitWhilePaused();
      if (abortSignal?.aborted) {
        break;
      }
    }

    const stub = buildCatalogStub(entry, true);
    await registerCatalogImage(stub, entry, true, true);
  }

  await flushChunk(true);
  await pushUiBatch(true);

  if (cacheWriter) {
    const finalizeStart = performance.now();
    await cacheWriter.finalize();
    const finalizeDuration = performance.now() - finalizeStart;
    const bytesWritten = JSON.stringify({
      id: `${directoryId}-${scanSubfolders ? 'recursive' : 'flat'}`,
      imageCount: totalPhaseAFiles,
    }).length;
    phaseAStats.bytesWritten += bytesWritten;
    phaseAStats.diskWrites += 1;
    phaseAStats.ipcCalls += 1;
    performance.mark('indexing:phaseA:finalize', { detail: { durationMs: finalizeDuration, bytesWritten } });
  }

  performance.mark('indexing:phaseA:complete', {
    detail: { elapsedMs: performance.now() - phaseAStats.startTime, files: phaseAStats.processed }
  });

  if (totalNewFiles > 0) {
    setProgress({ current: totalNewFiles, total: totalNewFiles });
  }

  const ipcPerThousand = totalPhaseAFiles > 0 ? (phaseAStats.ipcCalls / totalPhaseAFiles) * 1000 : 0;
  performance.mark('indexing:phaseA:ipc-per-1k', { detail: { value: ipcPerThousand } });
  const writesPerThousand = totalPhaseAFiles > 0 ? (phaseAStats.diskWrites / totalPhaseAFiles) * 1000 : 0;

  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production' && totalPhaseAFiles > 0) {
    if (ipcPerThousand > 10) {
      throw new Error(`Phase A IPC calls per 1k files exceeded limit: ${ipcPerThousand.toFixed(2)}`);
    }
    if (writesPerThousand > 5) {
      throw new Error(`Phase A disk writes per 1k files exceeded limit: ${writesPerThousand.toFixed(2)}`);
    }
  }

  const needsEnrichment = enrichmentQueue.filter(entry => entry.needsEnrichment && entry.source);
  const totalEnrichment = needsEnrichment.length;

  if (totalEnrichment === 0) {
    performance.mark('indexing:phaseB:start');
    performance.mark('indexing:phaseB:complete', { detail: { elapsedMs: 0, files: 0 } });
    options.onEnrichmentProgress?.(null);
    return { phaseB: Promise.resolve() };
  }

  const nextPhaseBLogInitial = 5000;
  let nextPhaseBLog = nextPhaseBLogInitial;

  // Throttle progress updates to every 300ms to avoid excessive re-renders
  const throttledEnrichmentProgress = throttle(
    (progress: { processed: number; total: number } | null) => {
      options.onEnrichmentProgress?.(progress);
    },
    300
  );

  const runEnrichmentPhase = async () => {
    console.log(`[indexing] Starting Phase B with ${totalEnrichment} images to enrich`);
    phaseBStats.startTime = performance.now();
    performance.mark('indexing:phaseB:start');

    const queue = [...needsEnrichment];
    throttledEnrichmentProgress({ processed: 0, total: totalEnrichment });
    console.log(`[indexing] Phase B progress initialized: 0/${totalEnrichment}`);
    const resultsBatch: IndexedImage[] = [];
    const touchedChunks = new Set<number>();
    const DIRTY_CHUNK_FLUSH_THRESHOLD = 4;

    const commitBatch = async (force = false) => {
      if (resultsBatch.length > 0) {
        options.onEnrichmentBatch?.([...resultsBatch]);
        resultsBatch.length = 0;
      }

      if (cacheWriter && touchedChunks.size > 0 && (force || touchedChunks.size >= DIRTY_CHUNK_FLUSH_THRESHOLD)) {
        for (const chunkIndex of Array.from(touchedChunks)) {
          const metadata = chunkRecords[chunkIndex];
          const rewriteStart = performance.now();
          await cacheWriter.overwrite(chunkIndex, metadata);
          const duration = performance.now() - rewriteStart;
          const bytesWritten = JSON.stringify(metadata).length;
          phaseBStats.bytesWritten += bytesWritten;
          phaseBStats.diskWrites += 1;
          phaseBStats.ipcCalls += 1;
          performance.mark('indexing:phaseB:chunk-flush', {
            detail: { chunkIndex, durationMs: duration, bytesWritten }
          });
        }
        touchedChunks.clear();
      }
    };

    const iterator = async (entry: CatalogEntryState) => {
      if (!entry.source) {
        return null;
      }
      if (abortSignal?.aborted) {
        return null;
      }

      const enriched = await processSingleFileOptimized(entry.source, directoryId, undefined);
      const merged = processEnrichmentResult(entry, enriched);
      if (merged) {
        entry.needsEnrichment = false;
        resultsBatch.push(merged);
        const loc = chunkMap.get(merged.id);
        if (loc) {
          touchedChunks.add(loc.chunkIndex);
        }
        phaseBStats.processed += 1;
        throttledEnrichmentProgress({ processed: phaseBStats.processed, total: totalEnrichment });
        const elapsed = performance.now() - phaseBStats.startTime;
        if (phaseBStats.processed >= nextPhaseBLog || phaseBStats.processed === queue.length) {
          const avg = phaseBStats.processed > 0 ? elapsed / phaseBStats.processed : 0;
          console.log('[indexing]', {
            phase: 'B',
            files: phaseBStats.processed,
            ipc_calls: phaseBStats.ipcCalls,
            writes: phaseBStats.diskWrites,
            bytes_written: phaseBStats.bytesWritten,
            avg_ms_per_file: Number(avg.toFixed(2)),
          });
          nextPhaseBLog += 5000;
        }
        performance.mark('indexing:phaseB:queue-depth', {
          detail: { depth: queue.length - phaseBStats.processed }
        });

        if (resultsBatch.length >= enrichmentBatchSize) {
          await commitBatch();
        }
      }
      return merged;
    };

    if (useOptimizedPath) {
      const batches = chunkArray(queue, FILE_READ_BATCH_SIZE);
      for (const batch of batches) {
        const filePaths = batch
          .map(entry => (entry.source?.handle as ElectronFileHandle)?._filePath)
          .filter((path): path is string => typeof path === 'string' && path.length > 0);
        if (filePaths.length === 0) {
          await asyncPool(concurrencyLimit, batch, iterator);
          continue;
        }

        const readResult = await (window as any).electronAPI.readFilesBatch(filePaths);
        phaseBStats.ipcCalls += 1;

        const dataMap = new Map<string, ArrayBuffer>();
        if (readResult.success && Array.isArray(readResult.files)) {
          for (const file of readResult.files) {
            if (!file.success || !file.data) {
              continue;
            }
            const raw = file.data as ArrayBuffer | ArrayBufferView;
            if (raw instanceof ArrayBuffer) {
              dataMap.set(file.path, raw);
            } else if (ArrayBuffer.isView(raw)) {
              const view = raw as ArrayBufferView;
              const copy = new Uint8Array(view.byteLength);
              copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
              dataMap.set(file.path, copy.buffer);
            }
          }
        }

        const batchIterator = async (entry: CatalogEntryState) => {
          if (!entry.source) {
            return null;
          }
          const filePath = (entry.source.handle as ElectronFileHandle)?._filePath;
          if (!filePath) {
            return null;
          }
          const buffer = dataMap.get(filePath);
          const enriched = await processSingleFileOptimized(entry.source, directoryId, buffer);
          const merged = processEnrichmentResult(entry, enriched);
          if (merged) {
            entry.needsEnrichment = false;
            resultsBatch.push(merged);
            const loc = chunkMap.get(merged.id);
            if (loc) {
              touchedChunks.add(loc.chunkIndex);
            }
            phaseBStats.processed += 1;
            throttledEnrichmentProgress({ processed: phaseBStats.processed, total: totalEnrichment });
            const elapsed = performance.now() - phaseBStats.startTime;
            if (phaseBStats.processed >= nextPhaseBLog || phaseBStats.processed === queue.length) {
              const avg = phaseBStats.processed > 0 ? elapsed / phaseBStats.processed : 0;
              console.log('[indexing]', {
                phase: 'B',
                files: phaseBStats.processed,
                ipc_calls: phaseBStats.ipcCalls,
                writes: phaseBStats.diskWrites,
                bytes_written: phaseBStats.bytesWritten,
                avg_ms_per_file: Number(avg.toFixed(2)),
              });
              nextPhaseBLog += 5000;
            }
            performance.mark('indexing:phaseB:queue-depth', {
              detail: { depth: queue.length - phaseBStats.processed }
            });
            if (resultsBatch.length >= enrichmentBatchSize) {
              await commitBatch();
            }
          }
          return merged;
        };

        await asyncPool(concurrencyLimit, batch, batchIterator);
      }
    } else {
      await asyncPool(concurrencyLimit, queue, iterator);
    }

    await commitBatch(true);

    const elapsedMs = performance.now() - phaseBStats.startTime;
    performance.mark('indexing:phaseB:complete', {
      detail: { elapsedMs, files: phaseBStats.processed }
    });

    console.log(`[indexing] Phase B complete: ${phaseBStats.processed}/${totalEnrichment} images enriched in ${(elapsedMs / 1000).toFixed(2)}s`);
    throttledEnrichmentProgress({ processed: phaseBStats.processed, total: totalEnrichment });
  };

  return { phaseB: runEnrichmentPhase() };
}

/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { cacheManager } from './cacheManager';

import { type IndexedImage, type ImageMetadata, type BaseMetadata, isInvokeAIMetadata, isAutomatic1111Metadata, isComfyUIMetadata, isSwarmUIMetadata, isEasyDiffusionMetadata, isEasyDiffusionJson, isMidjourneyMetadata, isNijiMetadata, isForgeMetadata, isDalleMetadata, isFireflyMetadata, isDreamStudioMetadata, isDrawThingsMetadata, ComfyUIMetadata, InvokeAIMetadata, SwarmUIMetadata, EasyDiffusionMetadata, EasyDiffusionJson, MidjourneyMetadata, NijiMetadata, ForgeMetadata, DalleMetadata, FireflyMetadata, DrawThingsMetadata, FooocusMetadata } from '../types';
import { parse } from 'exifr';
import { resolvePromptFromGraph } from './parsers/comfyUIParser';
import { parseInvokeAIMetadata } from './parsers/invokeAIParser';
import { parseA1111Metadata } from './parsers/automatic1111Parser';
import { parseSwarmUIMetadata } from './parsers/swarmUIParser';

// Extended FileSystemFileHandle interface for Electron compatibility
interface ElectronFileHandle extends FileSystemFileHandle {
  _filePath?: string;
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

  // Prioritize workflow for ComfyUI, then parameters for A1111, then InvokeAI
  if (chunks.workflow) {
    const comfyMetadata: ComfyUIMetadata = {};
    if (chunks.workflow) comfyMetadata.workflow = chunks.workflow;
    if (chunks.prompt) comfyMetadata.prompt = chunks.prompt;
    return comfyMetadata;
  } else if (chunks.parameters || chunks.description) {
    return { parameters: chunks.parameters || chunks.description };
  } else if (chunks.invokeai_metadata) {
    return JSON.parse(chunks.invokeai_metadata);
  } else if (chunks.prompt) {
    return { prompt: chunks.prompt };
  }

  // If no PNG chunks found, try to extract EXIF data from PNG (some tools like Fooocus save metadata in EXIF)
  try {
    const exifResult = await parseJPEGMetadata(buffer);
    if (exifResult) {
      return exifResult;
    }
  } catch {
    // Silent error - EXIF extraction may fail
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
    let metadataText: string | Uint8Array | undefined = 
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
      console.log('[JPEG Parser] No metadata text found in EXIF');
      return null;
    }

    console.log('[JPEG Parser] Raw EXIF metadata text:', metadataText.substring(0, 500) + (metadataText.length > 500 ? '...' : ''));

    // ========== CRITICAL FIX: Check for ComfyUI FIRST (before other patterns) ==========
    // ComfyUI images stored as JPEG with A1111-style parameters in EXIF
    if (metadataText.includes('Version: ComfyUI')) {
      console.log('[JPEG Parser] ✅ DETECTED ComfyUI metadata in EXIF - returning parameters');
      return { parameters: metadataText };
    }

    console.log('[JPEG Parser] No ComfyUI detected, checking other patterns...');

    // A1111-style data is often not valid JSON, so we check for its characteristic pattern first.
    if (metadataText.includes('Steps:') && metadataText.includes('Sampler:') && metadataText.includes('Model hash:')) {
      console.log('[JPEG Parser] Detected A1111-style metadata with Model hash');
      return { parameters: metadataText };
    }

    // Easy Diffusion uses similar format but without Model hash
    if (metadataText.includes('Prompt:') && metadataText.includes('Steps:') && metadataText.includes('Sampler:') && !metadataText.includes('Model hash:')) {
      console.log('[JPEG Parser] Detected Easy Diffusion-style metadata');
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

    // Draw Things (iOS/Mac AI app) uses SD-like format with mobile device indicators
    if ((metadataText.includes('iPhone') || metadataText.includes('iPad') || metadataText.includes('iPod') || metadataText.includes('Draw Things')) &&
        metadataText.includes('Prompt:') && metadataText.includes('Steps:') && metadataText.includes('CFG scale:') &&
        !metadataText.includes('Model hash:') && !metadataText.includes('Forge') && !metadataText.includes('Gradio') &&
        !metadataText.includes('DreamStudio') && !metadataText.includes('Stability AI') && !metadataText.includes('--niji')) {
      return { parameters: metadataText };
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
      }
    }

// ==============================================================================
// SUBSTITUA o bloco inteiro de parsing (linhas ~304-360) por este código:
// Comece a substituir em: let normalizedMetadata: BaseMetadata | undefined;
// Termine antes de: // Read actual image dimensions
// ==============================================================================

let normalizedMetadata: BaseMetadata | undefined;
if (rawMetadata) {
  console.log('[Metadata Processing] Raw metadata keys:', Object.keys(rawMetadata));
  
  // Priority 1: Check for ComfyUI (has unique 'workflow' structure)
  if (isComfyUIMetadata(rawMetadata)) {
    console.log('[Metadata Processing] ✅ Using ComfyUI parser');
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
    console.log('[Metadata Processing] Parameters string detected, analyzing...');
    console.log('[Metadata Processing] First 200 chars:', params.substring(0, 200));
    
    // Sub-priority 2.1: SD.Next (has "App: SD.Next" indicator)
    if (params.includes('App: SD.Next')) {
      console.log('[Metadata Processing] ✅ Using SD.Next parser');
      normalizedMetadata = parseSDNextMetadata(params);
    }
    
    // Sub-priority 2.2: Forge (most specific - has Model hash + Forge/Gradio)
    else if ((params.includes('Forge') || params.includes('Gradio')) && 
        params.includes('Steps:') && params.includes('Sampler:') && params.includes('Model hash:')) {
      console.log('[Metadata Processing] ✅ Using Forge parser');
      normalizedMetadata = parseForgeMetadata(rawMetadata);
    }
    
    // Sub-priority 2.2: Fooocus (specific indicators but NO Model hash)
    // CRITICAL: Must check for absence of Model hash to avoid capturing Forge/A1111
    else if (params.includes('Fooocus') || 
             (params.includes('Sharpness:') && !params.includes('Model hash:'))) {
      console.log('[Metadata Processing] ✅ Using Fooocus parser');
      normalizedMetadata = parseFooocusMetadata(rawMetadata as FooocusMetadata);
    }
    
    // Sub-priority 2.3: A1111/ComfyUI hybrid (has Model hash or Version indicators)
    // This catches: standard A1111, ComfyUI with A1111 format, Forge variants
    else if (params.includes('Model hash:') || 
             params.includes('Version: ComfyUI') ||
             /Version:\s*f\d+\./i.test(params) ||  // Forge versions like f2.0.1
             params.includes('Distilled CFG Scale') ||
             /Module\s*\d+:/i.test(params)) {
      console.log('[Metadata Processing] ✅ Using A1111 parser (includes Forge/ComfyUI variants)');
      normalizedMetadata = parseA1111Metadata(params);
    }
    
    // Sub-priority 2.4: Other parameter-based formats
    else if (params.includes('DreamStudio') || params.includes('Stability AI')) {
      console.log('[Metadata Processing] ✅ Using DreamStudio parser');
      normalizedMetadata = parseDreamStudioMetadata(params);
    }
    else if ((params.includes('iPhone') || params.includes('iPad') || params.includes('Draw Things')) &&
             !params.includes('Model hash:')) {
      console.log('[Metadata Processing] ✅ Using Draw Things parser');
      normalizedMetadata = parseDrawThingsMetadata(params);
    }
    else if (params.includes('--niji')) {
      console.log('[Metadata Processing] ✅ Using Niji parser');
      normalizedMetadata = parseNijiMetadata(params);
    }
    else if (params.includes('--v') || params.includes('--ar') || params.includes('Midjourney')) {
      console.log('[Metadata Processing] ✅ Using Midjourney parser');
      normalizedMetadata = parseMidjourneyMetadata(params);
    }
    else if (params.includes('Prompt:') && params.includes('Steps:')) {
      // Generic SD-like format - try Easy Diffusion
      console.log('[Metadata Processing] ✅ Using Easy Diffusion parser');
      normalizedMetadata = parseEasyDiffusionMetadata(params);
    }
    else {
      // Fallback: Try A1111 parser for any other parameter string
      console.log('[Metadata Processing] ⚠️ Fallback to A1111 parser');
      normalizedMetadata = parseA1111Metadata(params);
    }
  }
  
  // Priority 3: SwarmUI (has unique 'sui_image_params' structure)
  else if (isSwarmUIMetadata(rawMetadata)) {
    console.log('[Metadata Processing] ✅ Using SwarmUI parser');
    normalizedMetadata = parseSwarmUIMetadata(rawMetadata as SwarmUIMetadata);
  }
  
  // Priority 4: Easy Diffusion JSON (simple JSON with 'prompt' field)
  else if (isEasyDiffusionJson(rawMetadata)) {
    console.log('[Metadata Processing] ✅ Using Easy Diffusion JSON parser');
    normalizedMetadata = parseEasyDiffusionJson(rawMetadata as EasyDiffusionJson);
  }
  
  // Priority 5: DALL-E (has C2PA manifest)
  else if (isDalleMetadata(rawMetadata)) {
    console.log('[Metadata Processing] ✅ Using DALL-E parser');
    normalizedMetadata = parseDalleMetadata(rawMetadata);
  }
  
  // Priority 6: Firefly (has C2PA with Adobe signatures)
  else if (isFireflyMetadata(rawMetadata)) {
    console.log('[Metadata Processing] ✅ Using Firefly parser');
    normalizedMetadata = parseFireflyMetadata(rawMetadata, fileData!);
  }
  
  // Priority 7: InvokeAI (fallback for remaining metadata)
  else if (isInvokeAIMetadata(rawMetadata)) {
    console.log('[Metadata Processing] ✅ Using InvokeAI parser');
    normalizedMetadata = parseInvokeAIMetadata(rawMetadata as InvokeAIMetadata);
  }
  
  // Priority 8: Unknown format
  else {
    console.log('[Metadata Processing] ⚠️ Unknown metadata format, no parser applied');
  }
}

console.log('[Metadata Processing] Final normalized metadata:', {
  hasMetadata: !!normalizedMetadata,
  generator: normalizedMetadata?.generator,
  model: normalizedMetadata?.model,
  prompt: normalizedMetadata?.prompt?.substring(0, 100) + (normalizedMetadata?.prompt && normalizedMetadata.prompt.length > 100 ? '...' : ''),
  steps: normalizedMetadata?.steps,
  cfg_scale: normalizedMetadata?.cfg_scale
});

// ==============================================================================
// FIM DA SUBSTITUIÇÃO - O código seguinte (Read actual image dimensions) 
// deve permanecer como está
// ==============================================================================
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
        // console.warn('Failed to read image dimensions:', e);
        // Keep width/height as 0 if failed
      }
    }

    // Determine the best date for sorting (generation date vs file date)
    let sortDate = file.lastModified;

    // For Electron files, try to get creation date
    if (isElectron && (fileEntry.handle as ElectronFileHandle)._filePath) {
      try {
        const filePath = (fileEntry.handle as ElectronFileHandle)._filePath!;
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
  fileEntries: { handle: FileSystemFileHandle, path: string, lastModified: number }[],
  setProgress: (progress: { current: number; total: number }) => void,
  onBatchProcessed: (batch: IndexedImage[]) => void,
  directoryId: string,
  directoryName: string,
  scanSubfolders: boolean,
  onDeletion: (deletedFileIds: string[]) => void,
  abortSignal?: AbortSignal,
  waitWhilePaused?: () => Promise<void>
): Promise<void> {
  // Check for cancellation at the start
  if (abortSignal?.aborted) {
    return;
  }

  const currentFiles = fileEntries.map((entry) => ({
    name: entry.handle.name,
    lastModified: entry.lastModified,
  }));

  const diff = await cacheManager.validateCacheAndGetDiff(
    directoryId,
    directoryName,
    currentFiles,
    scanSubfolders
  );

  if (diff.cachedImages.length > 0) {
    onBatchProcessed(diff.cachedImages);
  }

  if (diff.deletedFileIds.length > 0) {
    onDeletion(diff.deletedFileIds);
  }

  const filesToProcess = fileEntries.filter((entry) =>
    diff.newAndModifiedFiles.some((file) => file.name === entry.handle.name)
  );
  const imageFiles = filesToProcess.filter(entry => /\.(png|jpg|jpeg)$/i.test(entry.handle.name));
  const total = filesToProcess.length;
  let processedCount = 0;
  const BATCH_SIZE = 50; // For sending data to the store
  const CONCURRENCY_LIMIT = isElectron ? 50 : 20; // Higher concurrency in Electron (less IPC overhead)
  const FILE_READ_BATCH_SIZE = 100; // Number of files to read at once (Electron only)
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

  // Check if we're in Electron and can use optimized batch reading
  const useOptimizedPath = isElectron && (window as any).electronAPI?.readFilesBatch;

  const newlyProcessedImages: IndexedImage[] = [];

  // ===== OPTIMIZED PATH: Batch file reading (Electron only) =====
  if (useOptimizedPath) {
    // Split files into read batches to reduce IPC overhead
    const fileReadBatches = chunkArray(imageFiles, FILE_READ_BATCH_SIZE);
    
    for (const readBatch of fileReadBatches) {
      // Check for cancellation before processing each batch
      if (abortSignal?.aborted) {
        break;
      }

      // Wait while paused
      if (waitWhilePaused) {
        await waitWhilePaused();
        if (abortSignal?.aborted) {
          break;
        }
      }

      // Extract ABSOLUTE file paths for batch reading (required for security check)
      const filePaths = readBatch.map(entry => {
        const filePath = (entry.handle as ElectronFileHandle)._filePath!;
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
              newlyProcessedImages.push(...batch);
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
      
      // Process this read batch with controlled concurrency
      const iteratorFn = async (fileEntry: { handle: FileSystemFileHandle, path: string, lastModified: number }): Promise<IndexedImage | null> => {
        const filePath = (fileEntry.handle as ElectronFileHandle)._filePath!;
        const fileData = fileDataMap.get(filePath);
        
        const indexedImage = await processSingleFileOptimized(fileEntry, directoryId, fileData);
        processedCount++;
        
        return indexedImage;
      };

      const results = await asyncPool(CONCURRENCY_LIMIT, readBatch, iteratorFn);
      
      // Update progress once per batch (more efficient)
      setProgress({ current: processedCount, total });
      
      // Collect results into batches
      for (const indexedImage of results) {
        if (indexedImage) {
          batch.push(indexedImage);
          if (batch.length >= BATCH_SIZE) {
            onBatchProcessed(batch);
            newlyProcessedImages.push(...batch);
            batch = [];
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
      }
    }
    
    // Process any remaining images
    if (batch.length > 0) {
      onBatchProcessed(batch);
      newlyProcessedImages.push(...batch);
    }

  } else {
    // ===== STANDARD PATH: Individual file reading (Browser or fallback) =====
    
    const iteratorFn = async (fileEntry: { handle: FileSystemFileHandle, path: string, lastModified: number }): Promise<IndexedImage | null> => {
      // Check for cancellation before processing each file
      if (abortSignal?.aborted) {
        return null;
      }

      // Wait while paused
      if (waitWhilePaused) {
        await waitWhilePaused();
        if (abortSignal?.aborted) {
          return null;
        }
      }

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
          newlyProcessedImages.push(...batch);
          batch = [];
          // Yield to the main thread to allow UI updates after a batch is sent
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }

    // Process any remaining images in the last batch
    if (batch.length > 0) {
      onBatchProcessed(batch);
      newlyProcessedImages.push(...batch);
    }
  }

  // Check for cancellation before caching
  if (abortSignal?.aborted) {
    return;
  }

  const allImages = [...diff.cachedImages, ...newlyProcessedImages];
  await cacheManager.cacheData(directoryId, directoryName, allImages, scanSubfolders);
}
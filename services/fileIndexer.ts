/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { type IndexedImage, type InvokeAIMetadata } from '../types';

// Function to extract models from metadata
function extractModels(metadata: InvokeAIMetadata): string[] {
  const models: string[] = [];
  
  // Add main model
  if (metadata.model) {
    const modelName = extractModelName(metadata.model);
    if (modelName) models.push(modelName);
  }
  
  // Check for additional models in other fields
  if (metadata.base_model) {
    const modelName = extractModelName(metadata.base_model);
    if (modelName) models.push(modelName);
  }
  
  // Look for model names in metadata
  if (metadata.model_name) {
    const modelName = extractModelName(metadata.model_name);
    if (modelName) models.push(modelName);
  }
  
  // Check for checkpoint/safetensors files in metadata
  const metadataStr = JSON.stringify(metadata).toLowerCase();
  const modelMatches = metadataStr.match(/['"]\s*([^'"]*\.safetensors|[^'"]*\.ckpt|[^'"]*\.pt)\s*['"]/g);
  if (modelMatches) {
    modelMatches.forEach(match => {
      let modelName = match.replace(/['"]/g, '').trim();
      // Extract just the filename without path
      modelName = modelName.split('/').pop() || modelName;
      modelName = modelName.split('\\').pop() || modelName;
      if (modelName && !models.includes(modelName)) {
        models.push(modelName);
      }
    });
  }
  
  // const result = models.filter(Boolean); // Remove empty strings
  // // console.log removed
  return models.filter(Boolean);
}

// Helper function to extract readable model name
function extractModelName(modelData: any): string | null {
  if (typeof modelData === 'string') {
    return modelData.trim();
  }
  
  if (modelData && typeof modelData === 'object') {
    // Try to extract a readable name from the model object
    const possibleNames = [
      modelData.name,
      modelData.model,
      modelData.model_name,
      modelData.base_model,
      modelData.mechanism,
      modelData.type
    ];
    
    for (const name of possibleNames) {
      if (name && typeof name === 'string' && name.trim()) {
        return name.trim();
      }
    }
    
    // If all else fails, use key but make it more readable
    if (modelData.key && typeof modelData.key === 'string') {
      const key = modelData.key.trim();
      // If it's a long hash, truncate it
      if (key.length > 20 && /^[a-f0-9\-]+$/i.test(key)) {
        const mechanism = modelData.mechanism || modelData.type || 'Model';
        return `${mechanism} (${key.substring(0, 8)}...)`;
      }
      return key;
    }
  }
  
  return null;
}

// Function to extract LoRAs from metadata
function extractLoras(metadata: InvokeAIMetadata): string[] {
  const loras: string[] = [];
  
  // Get prompt text
  const promptText = typeof metadata.prompt === 'string' 
    ? metadata.prompt 
    : Array.isArray(metadata.prompt) 
      ? metadata.prompt.map(p => typeof p === 'string' ? p : p.prompt).join(' ')
      : '';
  
  // Common LoRA patterns in prompts
  const loraPatterns = [
    /<lora:([^:>]+):[^>]*>/gi,  // <lora:name:weight>
    /<lyco:([^:>]+):[^>]*>/gi,  // <lyco:name:weight>
    /\blora:([^\s,>]+)/gi,      // lora:name
    /\blyco:([^\s,>]+)/gi       // lyco:name
  ];
  
  loraPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(promptText)) !== null) {
      const loraName = match[1].trim();
      if (loraName && !loras.includes(loraName)) {
        loras.push(loraName);
      }
    }
  });
  
  // Also check metadata for LoRA fields
  if (metadata.loras && Array.isArray(metadata.loras)) {
    metadata.loras.forEach((lora: any) => {
      let loraName = '';
      
      if (typeof lora === 'string') {
        loraName = lora.trim();
      } else if (lora && typeof lora === 'object') {
        // First check direct string properties
        const directNames = [lora.name, lora.model_name, lora.key];
        
        // Then check if model is an object with name properties
        if (lora.model && typeof lora.model === 'object') {
          directNames.push(lora.model.name, lora.model.model, lora.model.model_name, lora.model.key);
        } else if (lora.model && typeof lora.model === 'string') {
          directNames.push(lora.model);
        }
        
        for (const name of directNames) {
          if (name && typeof name === 'string' && name.trim().length > 0) {
            loraName = name.trim();
            break;
          }
        }
        
        // If still no valid name found, skip this lora
        if (!loraName) {
          return;
        }
      }
      
      // Basic validation - avoid empty strings and [object Object]
      if (loraName && 
          loraName.length > 0 && 
          loraName !== '[object Object]' &&
          !loras.includes(loraName)) {
        loras.push(loraName);
      }
    });
  }
  
  // Check for LoRA in other common metadata fields
  if (metadata.lora) {
    let loraName = '';
    
    if (typeof metadata.lora === 'string') {
      loraName = metadata.lora.trim();
    } else if (metadata.lora && typeof metadata.lora === 'object') {
      loraName = metadata.lora.name || metadata.lora.model || metadata.lora.key;
      if (typeof loraName !== 'string') {
        loraName = metadata.lora.key || JSON.stringify(metadata.lora);
      }
    }
    
    if (loraName && loraName.length > 0 && !loras.includes(loraName)) {
      loras.push(loraName);
    }
  }
  
  // const result = loras.filter(Boolean); // Remove empty strings
  // // console.log removed
  return loras.filter(Boolean);
}

async function parseInvokeAIMetadata(file: File): Promise<InvokeAIMetadata | null> {
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);

    // Check PNG signature
    if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
      return null; // Not a PNG file
    }

    let offset = 8;
    const decoder = new TextDecoder();

    while (offset < buffer.byteLength) {
      const length = view.getUint32(offset);
      const type = decoder.decode(buffer.slice(offset + 4, offset + 8));
      
      if (type === 'tEXt') {
        const chunkData = buffer.slice(offset + 8, offset + 8 + length);
        const chunkString = decoder.decode(chunkData);
        const [keyword, text] = chunkString.split('\0');
        
        if (keyword === 'invokeai_metadata' && text) {
          return JSON.parse(text);
        }
      }
      
      if (type === 'IEND') {
        break; // End of file
      }

      offset += 12 + length; // 4 for length, 4 for type, length for data, 4 for CRC
    }

    return null;
  } catch (error) {
    console.error(`Failed to parse metadata for ${file.name}:`, error);
    return null;
  }
}

export async function getFileHandlesRecursive(
  directoryHandle: FileSystemDirectoryHandle,
  path: string = ''
): Promise<{handle: FileSystemFileHandle, path: string}[]> {
  const entries = [];
  // Use type assertion to work around incomplete TypeScript definitions
  const dirHandle = directoryHandle as any;
  for await (const entry of dirHandle.values()) {
    const newPath = path ? `${path}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      entries.push({handle: entry, path: newPath});
    } else if (entry.kind === 'directory') {
      // Fix: Explicitly cast entry to FileSystemDirectoryHandle as TypeScript fails to narrow the type.
      entries.push(...(await getFileHandlesRecursive(entry as FileSystemDirectoryHandle, newPath)));
    }
  }
  return entries;
}

// Function to filter out InvokeAI intermediate images
export function isIntermediateImage(filename: string): boolean {
  // DISABLED - showing all images for now
  return false;
  
  const name = filename.toLowerCase();
  
  // ONLY specific intermediate patterns - not normal InvokeAI images
  const intermediatePatterns = [
    // Classic intermediate patterns
    /^intermediate_/, 
    /_intermediate_/, 
    /^canvas_/, 
    /_canvas_/, 
    /^controlnet_/, 
    /_controlnet_/, 
    /^inpaint_/, 
    /_inpaint_/, 
    /^tmp_/, 
    /_tmp_/, 
    /^temp_/, 
    /_temp_/, 
    /\.tmp\.png$/, 
    /\.temp\.png$/,
    
    // Only very specific intermediate patterns
    /^step_\d+_/, // step_001_something.png (not just step_)
    /^preview_step/, // preview_step images
    /^progress_/, // progress images
    /^mask_temp/, // temporary masks only
    /^noise_sample/, // noise samples
    /^guidance_preview/, // guidance previews
  ];
  
  return intermediatePatterns.some(pattern => pattern.test(name));
}

export async function processDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  setProgress: (progress: { current: number; total: number }) => void,
  specificFiles?: { handle: FileSystemFileHandle; path: string }[]
): Promise<IndexedImage[]> {
  const allFileEntries = specificFiles || await getFileHandlesRecursive(directoryHandle);
  const pngFiles = allFileEntries.filter(entry => 
    entry.handle.name.toLowerCase().endsWith('.png') && 
    !isIntermediateImage(entry.handle.name)
  );

  // Try to find thumbnails directory
  let thumbnailsDir: FileSystemDirectoryHandle | null = null;
  try {
    thumbnailsDir = await directoryHandle.getDirectoryHandle('thumbnails');
    // console.log removed
  } catch (error) {
    // console.log removed
  }

  // Get thumbnail files if directory exists
  const thumbnailMap = new Map<string, FileSystemFileHandle>();
  if (thumbnailsDir) {
    const thumbnailEntries = await getFileHandlesRecursive(thumbnailsDir);
    const webpFiles = thumbnailEntries.filter(entry => entry.handle.name.toLowerCase().endsWith('.webp'));
    
    for (const thumbEntry of webpFiles) {
      // Map thumbnail name to PNG name (remove .webp, add .png)
      const pngName = thumbEntry.handle.name.replace(/\.webp$/i, '.png');
      thumbnailMap.set(pngName, thumbEntry.handle);
    }
    // console.log removed
  }

  const total = pngFiles.length;
  setProgress({ current: 0, total });

  const indexedImages: IndexedImage[] = [];
  let processedCount = 0;

  for (const fileEntry of pngFiles) {
    try {
      const file = await fileEntry.handle.getFile();
      const metadata = await parseInvokeAIMetadata(file);
      if (metadata) {
        const metadataString = JSON.stringify(metadata);
        const models = extractModels(metadata);
        const loras = extractLoras(metadata);
        const scheduler = metadata.scheduler || 'Unknown';
        
        // Find corresponding thumbnail
        const thumbnailHandle = thumbnailMap.get(fileEntry.handle.name);
        
        indexedImages.push({
          id: fileEntry.path,
          name: fileEntry.handle.name,
          handle: fileEntry.handle,
          thumbnailHandle,
          metadata,
          metadataString,
          lastModified: file.lastModified,
          models,
          loras,
          scheduler,
        });
      }
    } catch (error) {
        console.error(`Skipping file ${fileEntry.handle.name} due to an error:`, error);
    }

    processedCount++;
    if (processedCount % 20 === 0 || processedCount === total) { // Update progress in batches
      setProgress({ current: processedCount, total });
    }
  }
  
  return indexedImages;
}

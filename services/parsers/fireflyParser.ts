import { FireflyMetadata, isFireflyMetadata, BaseMetadata } from '../../types';
import * as cbor from 'cbor-js'; // Browser-compatible CBOR decoder

/**
 * Adobe Firefly Parser - Handles Adobe Firefly metadata from C2PA/EXIF embedded data
 * Supports PNG and JPEG formats with C2PA manifest and EXIF metadata
 * Reuses DALL-E parsing logic with Firefly-specific enhancements
 */

// UUIDs for C2PA boxes (from C2PA specs)
const C2PA_UUID = new Uint8Array([0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71]); // Common UUID prefix for c2pa
const CBOR_BOX_TYPE = 'cbor';
const JUMBF_SUPERBOX_TYPE = 'jumbf';

export function parseFireflyMetadata(metadata: any, fileBuffer: ArrayBuffer): BaseMetadata | null { // Add fileBuffer param pra binary parsing
  if (!isFireflyMetadata(metadata)) {
    return null;
  }

  console.log('🔥 Parsing Adobe Firefly metadata...');

  try {
    // Extract data from C2PA manifest (primary source)
    const c2paData = extractFromC2PA(fileBuffer); // Now parses binary
    console.log('📋 C2PA data extracted:', c2paData);

    // Extract data from EXIF (secondary source)
    const exifData = extractFromEXIF(metadata.exif_data);
    console.log('📷 EXIF data extracted:', exifData);

    // Merge data with priority: C2PA > EXIF > fallback
    const mergedData = {
      ...exifData,
      ...c2paData, // C2PA takes precedence
    };

    // Extract prompts
    const { prompt } = extractPrompts(mergedData);

    // Extract model and generation info
    const model = extractModel(mergedData);
    const generationDate = extractGenerationDate(mergedData);

    // Extract dimensions
    const { width, height } = extractDimensions(mergedData);

    // Extract AI tags for filtering
    const aiTags = extractAiTags(mergedData);

    // Extract edit history for BI Pro
    const editHistory = extractEditHistory(mergedData);

    console.log('✅ Adobe Firefly parsing successful:', {
      prompt: prompt?.substring(0, 50) + '...',
      model,
      width,
      height,
      generationDate,
      aiTags,
      editHistory: editHistory?.length || 0
    });

    // Build normalized metadata
    const result: BaseMetadata = {
      prompt: prompt || '',
      negativePrompt: '', // Firefly doesn't use negative prompts
      model: model || 'Adobe Firefly',
      models: model ? [model] : ['Adobe Firefly'],
      width: width || 0,
      height: height || 0,
      seed: mergedData.seed || undefined, // New: from params if present
      steps: mergedData.steps || 0, // New: from params if present
      cfg_scale: mergedData.cfg_scale || undefined, // New: if in params
      scheduler: 'Adobe Firefly',
      sampler: 'Adobe Firefly',
      loras: [], // Firefly doesn't use LoRAs
      tags: aiTags,
      edit_history: editHistory,
      generation_date: generationDate,
      firefly_version: mergedData.firefly_version,
      ai_generated: true,
    };

    return result;

  } catch (error) {
    console.error('❌ Error parsing Adobe Firefly metadata:', error);
    return null;
  }
}

// Enhanced C2PA extraction with JUMBF/CBOR parsing from file buffer
function extractFromC2PA(fileBuffer: ArrayBuffer): Partial<FireflyMetadata> {
  const result: Partial<FireflyMetadata> = {};

  try {
    const view = new DataView(fileBuffer);
    const bytes = new Uint8Array(fileBuffer);

    // Find JUMBF superbox in JPEG (after SOI 0xFFD8, scan segments)
    let offset = 0;
    while (offset < bytes.length - 8) {
      if (bytes[offset] === 0xFF && bytes[offset + 1] === 0xE1) { // APP1 segment for metadata
        const segmentLength = view.getUint16(offset + 2);
        const segmentData = bytes.subarray(offset + 4, offset + 2 + segmentLength);
        if (isJUMBF(segmentData)) {
          const jumbfBoxes = parseJUMBF(segmentData);
          for (const box of jumbfBoxes) {
            if (box.type === CBOR_BOX_TYPE && box.label.includes('c2pa.actions')) {
              const actions = cbor.decode(box.data);
              result.edit_history = actions.actions || [];
              if (actions.actions && actions.actions[0]?.parameters) {
                const params = actions.actions[0].parameters;
                result.prompt = params.prompt || params.description || result.prompt;
                result.firefly_version = params['com.adobe.firefly.version'] || result.firefly_version;
                result.steps = params.steps || result.steps; // If embed
                result.seed = params.seed || result.seed; // If embed
                result.cfg_scale = params.cfg_scale || result.cfg_scale; // If embed
                result.generation_params = params;
              }
            } else if (box.label.includes('c2pa.claim')) {
              const claim = cbor.decode(box.data);
              result.content_credentials = claim.credentials || result.content_credentials;
              result.prompt = claim.prompt || result.prompt; // Fallback
            } else if (box.label.includes('c2pa.ingredient')) {
              const ingredient = cbor.decode(box.data);
              result.prompt = ingredient.description || result.prompt; // From ref if main
            }
          }
        }
        offset += 2 + segmentLength;
      } else {
        offset++;
      }
    }

    // Regex fallback on stringified if no CBOR found
    if (Object.keys(result).length === 0) {
      const fileStr = new TextDecoder().decode(bytes);
      const promptMatch = fileStr.match(/"(?:prompt|description)":\s*"([^"]+)"/i);
      if (promptMatch) result.prompt = promptMatch[1];
    }

  } catch (error) {
    console.warn('⚠️ Error extracting C2PA/JUMBF data:', error);
  }

  return result;
}

// Helper to check if segment is JUMBF
function isJUMBF(data: Uint8Array): boolean {
  return data.slice(0, 4).every((b, i) => b === JUMBF_SUPERBOX_TYPE.charCodeAt(i)) && data.slice(8, 20).every((b, i) => b === C2PA_UUID[i]);
}

// Helper to parse JUMBF boxes (recursive for sub-boxes)
function parseJUMBF(data: Uint8Array): { type: string; label: string; data: Uint8Array }[] {
  const boxes: { type: string; label: string; data: Uint8Array }[] = [];
  let offset = 0;
  while (offset < data.length) {
    const boxLength = new DataView(data.buffer).getUint32(offset);
    const boxType = new TextDecoder().decode(data.slice(offset + 4, offset + 8));
    const boxUUID = data.slice(offset + 8, offset + 20);
    const boxLabelLength = new DataView(data.buffer).getUint16(offset + 20);
    const boxLabel = new TextDecoder().decode(data.slice(offset + 22, offset + 22 + boxLabelLength));
    const boxData = data.slice(offset + 22 + boxLabelLength, offset + boxLength);
    boxes.push({ type: boxType, label: boxLabel, data: boxData });
    offset += boxLength;
  }
  return boxes;
}

// Extract data from EXIF metadata
function extractFromEXIF(exifData: any): Partial<FireflyMetadata> {
  if (!exifData) return {};

  const result: Partial<FireflyMetadata> = {};

  try {
    // Check for Adobe Firefly specific EXIF tags
    if (exifData['adobe:firefly']) {
      const fireflyData = exifData['adobe:firefly'];
      result.prompt = fireflyData.prompt || fireflyData.description;
      result.firefly_version = fireflyData.version || fireflyData.model_version;
      result.generation_params = fireflyData.params || fireflyData.generation_params;
      result.ai_generated = true;
    }

    // Check Software tag for Firefly version
    if (exifData.Software && exifData.Software.includes('Firefly')) {
      if (!result.firefly_version) {
        result.firefly_version = exifData.Software;
      }
      result.ai_generated = true;
    }

    // Check for generation date in various EXIF fields
    if (!result.generation_date) {
      result.generation_date = exifData.DateTimeOriginal || exifData.DateTime || exifData.DateTimeDigitized;
    }

    // Check ImageDescription for prompt data
    if (exifData.ImageDescription && !result.prompt) {
      // Try to extract prompt from description
      const descMatch = exifData.ImageDescription.match(/Prompt:\s*(.+)/i);
      if (descMatch) {
        result.prompt = descMatch[1].trim();
      } else {
        // Use full description as prompt
        result.prompt = exifData.ImageDescription;
      }
    }

    // Check UserComment for additional data
    if (exifData.UserComment && !result.prompt) {
      result.prompt = exifData.UserComment;
    }

  } catch (error) {
    console.warn('⚠️ Error extracting EXIF data:', error);
  }

  return result;
}

// Extract prompts from merged data
function extractPrompts(data: Partial<FireflyMetadata>): { prompt: string } {
  let prompt = data.prompt || '';

  // Clean up prompt
  if (prompt) {
    prompt = prompt.trim();
    // Remove any markdown or formatting
    prompt = prompt.replace(/[*_~`]/g, '');
  }

  return { prompt };
}

// Extract model information
function extractModel(data: Partial<FireflyMetadata>): string {
  if (data.firefly_version) {
    return `Adobe Firefly ${data.firefly_version}`;
  }

  return 'Adobe Firefly';
}

// Extract generation date
function extractGenerationDate(data: Partial<FireflyMetadata>): string | undefined {
  return data.generation_date;
}

// Extract dimensions
function extractDimensions(data: Partial<FireflyMetadata>): { width: number; height: number } {
  let width = 0;
  let height = 0;

  // Check generation params for size
  if (data.generation_params) {
    width = data.generation_params.width || 0;
    height = data.generation_params.height || 0;
  }

  return { width, height };
}

// Extract AI tags for filtering
function extractAiTags(data: Partial<FireflyMetadata>): string[] {
  const tags: string[] = ['AI Generated', 'Firefly'];

  // Add version tag if available
  if (data.firefly_version) {
    tags.push(`Firefly ${data.firefly_version}`);
  }

  // Add content-based tags
  if (data.prompt) {
    const prompt = data.prompt.toLowerCase();
    // Add creative asset tags
    if (prompt.includes('photo') || prompt.includes('photograph')) {
      tags.push('Photography');
    }
    if (prompt.includes('paint') || prompt.includes('art')) {
      tags.push('Artwork');
    }
    if (prompt.includes('illustration') || prompt.includes('drawing')) {
      tags.push('Illustration');
    }
    if (prompt.includes('3d') || prompt.includes('render')) {
      tags.push('3D Render');
    }
  }

  // Add edit tags if edit history exists
  if (data.edit_history && data.edit_history.length > 0) {
    tags.push('Edited');
    tags.push(`${data.edit_history.length} Edits`);
  }

  return tags;
}

// Extract edit history for BI Pro creative assets analysis
function extractEditHistory(data: Partial<FireflyMetadata>): any[] | undefined {
  if (data.edit_history && Array.isArray(data.edit_history)) {
    return data.edit_history.map((action: any) => ({
      action: action.action || action.type,
      timestamp: action.when || action.timestamp,
      software: action.softwareAgent || action.software,
      parameters: action.parameters || action.params,
    }));
  }

  return undefined;
}
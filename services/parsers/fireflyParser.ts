import { FireflyMetadata, isFireflyMetadata, BaseMetadata } from '../../types';

/**
 * Adobe Firefly Parser - Handles Adobe Firefly metadata from C2PA/EXIF embedded data
 * Supports PNG and JPEG formats with C2PA manifest and EXIF metadata
 * Reuses DALL-E parsing logic with Firefly-specific enhancements
 */

export function parseFireflyMetadata(metadata: any): BaseMetadata | null {
  if (!isFireflyMetadata(metadata)) {
    return null;
  }

  console.log('🔥 Parsing Adobe Firefly metadata...');

  try {
    // Extract data from C2PA manifest (primary source)
    const c2paData = extractFromC2PA(metadata.c2pa_manifest);
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
      seed: undefined, // Firefly doesn't expose seed
      steps: 0, // Firefly doesn't expose steps
      cfg_scale: undefined, // Firefly doesn't expose CFG
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

// Extract data from C2PA manifest
function extractFromC2PA(c2paManifest: any): Partial<FireflyMetadata> {
  if (!c2paManifest) return {};

  const result: Partial<FireflyMetadata> = {};

  try {
    // Check for adobe:firefly specific data
    if (c2paManifest['adobe:firefly']) {
      const fireflyData = c2paManifest['adobe:firefly'];
      result.prompt = fireflyData.prompt || fireflyData.description;
      result.firefly_version = fireflyData.version || fireflyData.model_version;
      result.generation_params = fireflyData.params || fireflyData.generation_params;
      result.ai_generated = true;
    }

    // Check for c2pa.actions (edit history)
    if (c2paManifest['c2pa.actions']) {
      result.edit_history = c2paManifest['c2pa.actions'];
    }

    // Check for content credentials
    if (c2paManifest.content_credentials || c2paManifest.credentials) {
      result.content_credentials = c2paManifest.content_credentials || c2paManifest.credentials;
    }

    // Try to extract prompt from various C2PA fields
    if (!result.prompt) {
      // Check assertions
      if (c2paManifest.assertions) {
        for (const assertion of c2paManifest.assertions) {
          if (assertion.label?.includes('prompt') || assertion.label?.includes('description')) {
            result.prompt = assertion.data?.prompt || assertion.data?.description || assertion.data;
            break;
          }
          // Check for creative work assertion
          if (assertion.label?.includes('stds.schema-org.CreativeWork')) {
            result.prompt = assertion.data?.description || assertion.data?.name;
            if (assertion.data?.author) {
              result.firefly_version = assertion.data.author;
            }
          }
        }
      }

      // Check ingredients for generation info
      if (c2paManifest.ingredients && Array.isArray(c2paManifest.ingredients)) {
        for (const ingredient of c2paManifest.ingredients) {
          if (ingredient.title?.includes('Firefly') || ingredient.description?.includes('Firefly')) {
            result.firefly_version = ingredient.title || ingredient.description;
          }
        }
      }
    }

    // Regex fallback for description fields
    if (!result.prompt && typeof c2paManifest === 'object') {
      const manifestStr = JSON.stringify(c2paManifest);
      const promptMatch = manifestStr.match(/"(?:prompt|description|text)":\s*"([^"]+)"/i);
      if (promptMatch) {
        result.prompt = promptMatch[1];
      }
    }

  } catch (error) {
    console.warn('⚠️ Error extracting C2PA data:', error);
  }

  return result;
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
      result.generation_params = fireflyData.params;
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
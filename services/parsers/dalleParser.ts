import { DalleMetadata, isDalleMetadata, BaseMetadata } from '../../types';

/**
 * DALL-E Parser - Handles DALL-E 3 metadata from C2PA/EXIF embedded data
 * Supports PNG and WebP formats with C2PA manifest and EXIF metadata
 * Uses exifr library for offline parsing with regex fallback
 */

export function parseDalleMetadata(metadata: any): BaseMetadata | null {
  if (!isDalleMetadata(metadata)) {
    return null;
  }

  console.log('🔍 Parsing DALL-E metadata...');

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
    const { prompt, revisedPrompt } = extractPrompts(mergedData);

    // Extract model and generation info
    const model = extractModel(mergedData);
    const generationDate = extractGenerationDate(mergedData);

    // Extract dimensions (DALL-E typically generates square images)
    const { width, height } = extractDimensions(mergedData);

    // Extract AI tags for filtering
    const aiTags = extractAiTags(mergedData);

    console.log('✅ DALL-E parsing successful:', {
      prompt: prompt?.substring(0, 50) + '...',
      model,
      width,
      height,
      generationDate,
      aiTags
    });

    return {
      prompt: prompt || '',
      negativePrompt: '', // DALL-E doesn't have negative prompts
      model: model || 'DALL-E',
      models: model ? [model] : ['DALL-E'],
      width: width || 1024, // Default DALL-E resolution
      height: height || 1024,
      seed: undefined, // DALL-E doesn't expose seeds
      steps: 1, // DALL-E uses single-step generation
      cfg_scale: undefined, // Not applicable for DALL-E
      scheduler: 'DALL-E',
      sampler: undefined,
      loras: [],
      // DALL-E specific fields
      revisedPrompt,
      generationDate,
      aiTags,
      modelVersion: mergedData.model_version,
    };

  } catch (error) {
    console.error('❌ Error parsing DALL-E metadata:', error);
    return null;
  }
}

// Extract data from C2PA manifest
function extractFromC2PA(c2paManifest: any): Partial<DalleMetadata> {
  if (!c2paManifest) return {};

  const result: Partial<DalleMetadata> = {};

  try {
    // C2PA manifests contain claims with metadata
    if (c2paManifest.claims) {
      for (const claim of c2paManifest.claims) {
        if (claim.claims) {
          // Look for OpenAI/DALL-E specific claims
          const openaiData = claim.claims['openai:dalle'];
          if (openaiData) {
            result.prompt = openaiData.prompt;
            result.revised_prompt = openaiData.revised_prompt;
            result.model_version = openaiData.model_version;
            result.generation_date = openaiData.generation_date;
            break;
          }
        }
      }
    }

    // Also check for direct manifest data
    if (c2paManifest['openai:dalle']) {
      const dalleData = c2paManifest['openai:dalle'];
      result.prompt = dalleData.prompt || result.prompt;
      result.revised_prompt = dalleData.revised_prompt || result.revised_prompt;
      result.model_version = dalleData.model_version || result.model_version;
      result.generation_date = dalleData.generation_date || result.generation_date;
    }

  } catch (error) {
    console.warn('⚠️ Error extracting C2PA data:', error);
  }

  return result;
}

// Extract data from EXIF metadata
function extractFromEXIF(exifData: any): Partial<DalleMetadata> {
  if (!exifData) return {};

  const result: Partial<DalleMetadata> = {};

  try {
    // Check for OpenAI DALL-E specific EXIF tags
    if (exifData['openai:dalle']) {
      const dalleData = exifData['openai:dalle'];
      result.prompt = dalleData.prompt;
      result.revised_prompt = dalleData.revised_prompt;
      result.model_version = dalleData.model_version;
      result.generation_date = dalleData.generation_date;
    }

    // Check Software tag for DALL-E version
    if (exifData.Software && exifData.Software.includes('DALL-E')) {
      if (!result.model_version) {
        result.model_version = exifData.Software;
      }
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
      }
    }

  } catch (error) {
    console.warn('⚠️ Error extracting EXIF data:', error);
  }

  return result;
}

// Extract prompts from merged data
function extractPrompts(data: Partial<DalleMetadata>): { prompt: string; revisedPrompt?: string } {
  let prompt = data.prompt || '';
  let revisedPrompt = data.revised_prompt;

  // Fallback: try regex extraction from any string fields
  if (!prompt) {
    const fieldsToCheck = ['description', 'comment', 'userComment'];
    for (const field of fieldsToCheck) {
      if (data[field] && typeof data[field] === 'string') {
        const match = data[field].match(/Prompt:\s*(.+)/i);
        if (match) {
          prompt = match[1].trim();
          break;
        }
      }
    }
  }

  return { prompt, revisedPrompt };
}

// Extract model information
function extractModel(data: Partial<DalleMetadata>): string {
  if (data.model_version) {
    return data.model_version;
  }

  // Fallback detection
  if (data.prompt?.toLowerCase().includes('dall-e-3') ||
      data.revised_prompt?.toLowerCase().includes('dall-e-3')) {
    return 'DALL-E 3';
  }

  return 'DALL-E';
}

// Extract generation date
function extractGenerationDate(data: Partial<DalleMetadata>): string | undefined {
  if (data.generation_date) {
    // Ensure it's an ISO string
    try {
      const date = new Date(data.generation_date);
      return date.toISOString();
    } catch {
      return data.generation_date;
    }
  }

  return undefined;
}

// Extract dimensions
function extractDimensions(data: Partial<DalleMetadata>): { width: number; height: number } {
  // DALL-E typically generates square images, default to 1024x1024
  // Could be enhanced to parse from metadata if available
  return { width: 1024, height: 1024 };
}

// Extract AI tags for filtering
function extractAiTags(data: Partial<DalleMetadata>): string[] {
  const tags: string[] = ['AI Generated', 'DALL-E'];

  if (data.model_version) {
    tags.push(data.model_version);
  }

  // Add additional tags based on content analysis
  if (data.prompt) {
    // Simple content-based tagging
    const prompt = data.prompt.toLowerCase();
    if (prompt.includes('portrait') || prompt.includes('person')) tags.push('Portrait');
    if (prompt.includes('landscape') || prompt.includes('nature')) tags.push('Landscape');
    if (prompt.includes('animal')) tags.push('Animal');
    if (prompt.includes('building') || prompt.includes('architecture')) tags.push('Architecture');
  }

  return tags;
}
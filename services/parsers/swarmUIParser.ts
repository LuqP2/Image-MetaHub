import { SwarmUIMetadata, BaseMetadata } from '../../types';

/**
 * Parser for SwarmUI metadata format
 * SwarmUI stores metadata in the sui_image_params object
 */

type SuiImageParams = SwarmUIMetadata['sui_image_params'];

/**
 * @function extractSuiImageParams
 * @description Extracts sui_image_params from metadata, handling both direct and wrapped formats.
 * @param {SwarmUIMetadata} metadata - The metadata to parse.
 * @returns {SuiImageParams} - The extracted parameters.
 */
function extractSuiImageParams(metadata: SwarmUIMetadata): SuiImageParams {
  // Direct access
  if (metadata.sui_image_params) {
    return metadata.sui_image_params;
  }

  // Wrapped in parameters string
  if ('parameters' in metadata && typeof metadata.parameters === 'string') {
    try {
      const parsedParams = JSON.parse(metadata.parameters);
      return parsedParams.sui_image_params;
    } catch {
      // Not valid JSON or doesn't contain sui_image_params
    }
  }

  return undefined;
}

/**
 * @function parseSwarmUIMetadata
 * @description Parses SwarmUI metadata into a BaseMetadata object.
 * @param {SwarmUIMetadata} metadata - The metadata to parse.
 * @returns {BaseMetadata} - The parsed metadata.
 */
export function parseSwarmUIMetadata(metadata: SwarmUIMetadata): BaseMetadata {
  const params = extractSuiImageParams(metadata);

  if (!params) {
    return {
      prompt: '',
      model: '',
      models: [],
      width: 0,
      height: 0,
      steps: 0,
      scheduler: '',
      loras: [],
    };
  }  const result: BaseMetadata = {
    prompt: params.prompt || '',
    negativePrompt: params.negativeprompt || '',
    model: params.model || '',
    models: params.model ? [params.model] : [],
    width: params.width || 0,
    height: params.height || 0,
    seed: params.seed,
    steps: params.steps || 0,
    cfg_scale: params.cfgscale,
    scheduler: params.scheduler || '',
    sampler: params.sampler || '',
    loras: params.loras || [],
    generator: 'SwarmUI',
  };

  return result;
}

/**
 * @function extractModelsFromSwarmUI
 * @description Extracts model names from SwarmUI metadata.
 * @param {SwarmUIMetadata} metadata - The metadata to parse.
 * @returns {string[]} - An array of model names.
 */
export function extractModelsFromSwarmUI(metadata: SwarmUIMetadata): string[] {
  const params = extractSuiImageParams(metadata);
  const model = params?.model;
  return model ? [model] : [];
}

/**
 * @function extractLorasFromSwarmUI
 * @description Extracts LoRA names from SwarmUI metadata.
 * @param {SwarmUIMetadata} metadata - The metadata to parse.
 * @returns {string[]} - An array of LoRA names.
 */
export function extractLorasFromSwarmUI(metadata: SwarmUIMetadata): string[] {
  const params = extractSuiImageParams(metadata);
  return params?.loras || [];
}

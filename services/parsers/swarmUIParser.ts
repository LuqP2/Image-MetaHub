import { SwarmUIMetadata, BaseMetadata } from '../../types';

/**
 * Parser for SwarmUI metadata format
 * SwarmUI stores metadata in the sui_image_params object
 */

export function parseSwarmUIMetadata(metadata: SwarmUIMetadata): BaseMetadata {
  const params = metadata.sui_image_params;
  
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
  }

  const result: BaseMetadata = {
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
  };

  return result;
}

export function extractModelsFromSwarmUI(metadata: SwarmUIMetadata): string[] {
  const model = metadata.sui_image_params?.model;
  return model ? [model] : [];
}

export function extractLorasFromSwarmUI(metadata: SwarmUIMetadata): string[] {
  return metadata.sui_image_params?.loras || [];
}

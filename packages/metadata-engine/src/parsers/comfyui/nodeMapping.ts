/**
 * Canonical node name mapping for ComfyUI
 * Maps various node types to normalized metadata fields
 */

export interface NodeMapping {
  fields: string | string[];
  extractFrom?: 'widgets' | 'inputs' | 'args' | 'kwargs';
  fallbackKeys?: string[];
}

/**
 * NODE_MAP: Canonical names → normalized schema fields
 */
export const NODE_MAP: Record<string, NodeMapping> = {
  // Prompt nodes
  'Prompt': { fields: 'prompt' },
  'CLIPTextEncode': { fields: 'prompt' },
  'Text': { fields: 'prompt' },
  'String': { fields: 'prompt' },
  'TextInput': { fields: 'prompt' },
  'PromptText': { fields: 'prompt' },
  
  // Negative prompt nodes
  'NegativePrompt': { fields: 'negativePrompt' },
  'CLIPTextEncodeNegative': { fields: 'negativePrompt' },
  
  // Sampling nodes
  'KSampler': { fields: ['steps', 'cfg', 'sampler_name', 'scheduler', 'seed'] },
  'KSamplerAdvanced': { fields: ['steps', 'cfg', 'sampler_name', 'scheduler', 'seed'] },
  'SamplerCustom': { fields: ['steps', 'cfg', 'sampler_name', 'scheduler'] },
  'StableDiffusionProcessing': { fields: ['steps', 'cfg', 'sampler'] },
  
  // Model nodes
  'CheckpointLoaderSimple': { fields: 'model' },
  'CheckpointLoader': { fields: 'model' },
  'LoadCheckpoint': { fields: 'model' },
  'ModelLoader': { fields: 'model' },
  'SDCheckpoint': { fields: 'model' },
  
  // LoRA nodes
  'LoraLoader': { fields: 'lora' },
  'LoadLoRA': { fields: 'lora' },
  'LoRALoader': { fields: 'lora' },
  
  // VAE nodes
  'VAELoader': { fields: 'vae' },
  'LoadVAE': { fields: 'vae' },
  
  // ControlNet nodes
  'ControlNetLoader': { fields: 'controlnet' },
  'ControlNetApply': { fields: 'controlnet' },
  'LoadControlNet': { fields: 'controlnet' },
  
  // Upscaler nodes
  'UpscaleModel': { fields: 'upscaler' },
  'RealESRGAN': { fields: 'upscaler' },
  'ESRGAN': { fields: 'upscaler' },
  'UpscaleModelLoader': { fields: 'upscaler' },
  
  // Face restoration
  'GFPGAN': { fields: 'face_restore' },
  'CodeFormer': { fields: 'face_restore' },
  'FaceRestore': { fields: 'face_restore' },
  
  // Dimensions
  'EmptyLatentImage': { fields: ['width', 'height'] },
  'LatentUpscale': { fields: ['width', 'height'] },
};

/**
 * Common parameter names across different node types
 */
export const PARAMETER_ALIASES: Record<string, string[]> = {
  prompt: ['text', 'positive', 'prompt', 'conditioning', 'clip_text'],
  negativePrompt: ['negative', 'negative_prompt', 'negative_text', 'uncond'],
  seed: ['seed', 'noise_seed', 'rng_seed', 'random_seed'],
  steps: ['steps', 'sampling_steps', 'num_steps', 'iterations'],
  cfg: ['cfg', 'cfg_scale', 'guidance_scale', 'guidance'],
  sampler_name: ['sampler', 'sampler_name', 'sampling_method'],
  scheduler: ['scheduler', 'schedule', 'noise_schedule'],
  model: ['model', 'model_name', 'ckpt', 'checkpoint', 'ckpt_name'],
  model_hash: ['model_hash', 'hash', 'ckpt_hash'],
  lora: ['lora', 'lora_name', 'lora_model'],
  vae: ['vae', 'vae_name'],
  width: ['width', 'w', 'image_width', 'target_width'],
  height: ['height', 'h', 'image_height', 'target_height'],
  denoise: ['denoise', 'denoising_strength', 'denoise_strength'],
};

/**
 * Seed extraction patterns
 */
export const SEED_PATTERNS = [
  /(?:seed[:=]\s*)(\d{1,20})/i,
  /(?:seed[:=]\s*)(0x[a-fA-F0-9]+)/i,
  /(?:noise_seed[:=]\s*)(\d{1,20})/i,
  /(?:random_seed[:=]\s*)(\d{1,20})/i,
];

/**
 * Model detection patterns
 */
export const MODEL_PATTERNS = [
  /(?:model_name[:=]\s*)([^\n,]+)/i,
  /(?:model[:=]\s*)([^\n,]+)/i,
  /(?:ckpt[:=]\s*)([^\n,]+)/i,
  /(?:checkpoint[:=]\s*)([^\n,]+)/i,
  /(?:model_hash[:=]\s*)([a-fA-F0-9]+)/i,
];

/**
 * ComfyUI version detection patterns
 */
export const VERSION_PATTERNS = [
  /comfyui[_\s]version[:=]\s*([0-9.]+)/i,
  /version[:=]\s*([0-9.]+)/i,
  /comfy[:=]\s*v?([0-9.]+)/i,
];

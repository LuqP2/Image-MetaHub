import type { ModelKind, ModelSource, ModelSourceKind } from './types';

export const MODEL_KIND_LABELS: Record<ModelKind, string> = {
  lora: 'LoRA', checkpoint: 'Checkpoint', diffusion: 'Diffusion model / UNet',
  vae: 'VAE', textEncoder: 'Text encoder / CLIP', clipVision: 'CLIP Vision',
  controlnet: 'ControlNet', upscaler: 'Upscale model', embedding: 'Embedding', other: 'Other / unknown',
};

const folderKinds: Record<string, ModelKind> = {
  lora: 'lora', loras: 'lora', checkpoints: 'checkpoint', checkpoint: 'checkpoint',
  unet: 'diffusion', diffusion_models: 'diffusion',
  vae: 'vae', vae_approx: 'vae', text_encoders: 'textEncoder', clip: 'textEncoder',
  clip_vision: 'clipVision', controlnet: 'controlnet', upscale_models: 'upscaler', embeddings: 'embedding',
};

export function modelKindLabel(kind: ModelSourceKind): string {
  return kind === 'auto' ? 'Automatic (mixed folder)' : MODEL_KIND_LABELS[kind];
}

export function classifyModelKind(source: ModelSource, relativePath: string): ModelKind {
  if (source.kind !== 'auto') return source.kind;
  // Only directory names are evidence of type; filenames do not establish it.
  const parents = [...source.path.split(/[\\/]/), ...relativePath.split(/[\\/]/).slice(0, -1)];
  for (const directory of parents.reverse()) {
    const kind = folderKinds[directory.toLowerCase()];
    if (kind) return kind;
  }
  return 'other';
}

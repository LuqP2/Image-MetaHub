import { describe, expect, it } from 'vitest';
import { sanitizeStoredModelForWorkflowMode } from '../components/ComfyUIGenerateModal';

describe('ComfyUIGenerateModal model sanitization', () => {
  it('drops non-checkpoint stored models in simple mode', () => {
    expect(sanitizeStoredModelForWorkflowMode({
      name: 'flux-dev.safetensors',
      family: 'unet',
      sourceNode: 'UNETLoader',
      inputKey: 'unet_name',
    }, 'simple')).toBeNull();
  });

  it('preserves checkpoint models in simple mode', () => {
    expect(sanitizeStoredModelForWorkflowMode({
      name: 'sdxl.safetensors',
      family: 'checkpoint',
      sourceNode: 'CheckpointLoaderSimple',
      inputKey: 'ckpt_name',
    }, 'simple')).toEqual({
      name: 'sdxl.safetensors',
      family: 'checkpoint',
      sourceNode: 'CheckpointLoaderSimple',
      inputKey: 'ckpt_name',
    });
  });
});

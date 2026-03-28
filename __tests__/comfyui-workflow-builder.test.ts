import { describe, expect, it } from 'vitest';
import {
  analyzeComfyWorkflow,
  buildComfyUIResourceCatalog,
  prepareOriginalWorkflowForExecution,
  type ComfyUIModelResource,
} from '../services/comfyUIWorkflowBuilder';
import { type BaseMetadata, type IndexedImage } from '../types';

const createImage = (metadata: any): IndexedImage => ({
  id: 'dir-1::derived.png',
  name: 'derived.png',
  handle: {
    getFile: async () => new File([new Uint8Array([1, 2, 3])], 'derived.png', { type: 'image/png' }),
    name: 'derived.png',
    kind: 'file',
    _filePath: 'D:/images/derived.png',
  } as any,
  thumbnailStatus: 'pending',
  metadata,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
  directoryId: 'dir-1',
});

const rawPrompt = {
  '1': {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: 'base.safetensors',
    },
  },
  '2': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'old positive',
      clip: ['1', 1],
    },
  },
  '3': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'old negative',
      clip: ['1', 1],
    },
  },
  '4': {
    class_type: 'EmptyLatentImage',
    inputs: {
      width: 512,
      height: 512,
      batch_size: 1,
    },
  },
  '5': {
    class_type: 'KSampler',
    inputs: {
      seed: 123,
      steps: 20,
      cfg: 7,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 0.45,
      model: ['1', 0],
      positive: ['2', 0],
      negative: ['3', 0],
      latent_image: ['4', 0],
    },
  },
  '6': {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['5', 0],
      vae: ['1', 2],
    },
  },
  '7': {
    class_type: 'SaveImage',
    inputs: {
      images: ['6', 0],
    },
  },
};

describe('ComfyUI workflow builder', () => {
  it('builds a resource catalog with checkpoint and unet families', () => {
    const catalog = buildComfyUIResourceCatalog({
      CheckpointLoaderSimple: {
        input: {
          required: {
            ckpt_name: [['base.safetensors', 'alt.safetensors']],
          },
        },
      },
      UNETLoader: {
        input: {
          required: {
            unet_name: [['flux-dev.safetensors']],
          },
        },
      },
      LoraLoader: {
        input: {
          required: {
            lora_name: [['detail.safetensors']],
          },
        },
      },
      KSampler: {
        input: {
          required: {
            sampler_name: [['euler']],
            scheduler: [['normal']],
          },
        },
      },
    });

    expect(catalog.models).toContainEqual({
      name: 'base.safetensors',
      family: 'checkpoint',
      sourceNode: 'CheckpointLoaderSimple',
      inputKey: 'ckpt_name',
    });
    expect(catalog.models).toContainEqual({
      name: 'flux-dev.safetensors',
      family: 'unet',
      sourceNode: 'UNETLoader',
      inputKey: 'unet_name',
    });
    expect(catalog.loras).toContain('detail.safetensors');
  });

  it('analyzes embedded prompt graphs and detects original mode availability', () => {
    const image = createImage({
      workflow: { nodes: [] },
      prompt: rawPrompt,
      normalizedMetadata: {
        prompt: 'old positive',
        model: 'base.safetensors',
        width: 512,
        height: 512,
        steps: 20,
        scheduler: 'normal',
      } as BaseMetadata,
    });

    const analysis = analyzeComfyWorkflow(image, image.metadata.normalizedMetadata as BaseMetadata);
    expect(analysis.originalAvailable).toBe(true);
    expect(analysis.samplerTargets).toContain('5');
    expect(analysis.saveNodeIds).toContain('7');
  });

  it('patches an original workflow and injects parent_image into extra_pnginfo', async () => {
    const image = createImage({
      workflow: { nodes: [{ id: 7, type: 'SaveImage', title: 'Save Image' }] },
      prompt: rawPrompt,
      normalizedMetadata: {
        prompt: 'old positive',
        negativePrompt: 'old negative',
        model: 'base.safetensors',
        width: 512,
        height: 512,
        steps: 20,
        seed: 123,
        cfg_scale: 7,
        scheduler: 'normal',
        sampler: 'euler',
      } as BaseMetadata,
    });
    const metadata: BaseMetadata = {
      ...(image.metadata.normalizedMetadata as BaseMetadata),
      prompt: 'new positive',
      negativePrompt: 'new negative',
      steps: 30,
      seed: 999,
      cfg_scale: 8,
      width: 768,
      height: 640,
      scheduler: 'karras',
      sampler: 'dpmpp_2m',
      batch_size: 2,
      model: 'base.safetensors',
    } as BaseMetadata;

    const overrideModel: ComfyUIModelResource = {
      name: 'override.safetensors',
      family: 'checkpoint',
      sourceNode: 'CheckpointLoaderSimple',
      inputKey: 'ckpt_name',
    };

    const prepared = await prepareOriginalWorkflowForExecution({
      image,
      metadata,
      clientId: 'client-1',
      sourceImagePolicy: 'reuse_original',
      overrides: {
        model: overrideModel,
      },
    });

    expect(prepared.modeUsed).toBe('original');
    expect(prepared.payload.prompt['2'].inputs.text).toBe('new positive');
    expect(prepared.payload.prompt['3'].inputs.text).toBe('new negative');
    expect(prepared.payload.prompt['5'].inputs.steps).toBe(30);
    expect(prepared.payload.prompt['5'].inputs.sampler_name).toBe('dpmpp_2m');
    expect(prepared.payload.prompt['1'].inputs.ckpt_name).toBe('override.safetensors');
    expect(prepared.payload.prompt['7'].class_type).toBe('MetaHubSaveNode');
    expect(prepared.payload.extra_data?.extra_pnginfo?.parent_image?.fileName).toBe('derived.png');
  });

  it('rewrites LoadImage nodes when selected_image policy uploads a replacement asset', async () => {
    const image = createImage({
      workflow: { nodes: [] },
      prompt: {
        ...rawPrompt,
        '8': {
          class_type: 'LoadImage',
          inputs: {
            image: 'base.png',
          },
        },
        '9': {
          class_type: 'VAEEncode',
          inputs: {
            image: ['8', 0],
            vae: ['1', 2],
          },
        },
        '5': {
          ...rawPrompt['5'],
          inputs: {
            ...rawPrompt['5'].inputs,
            latent_image: ['9', 0],
          },
        },
      },
      normalizedMetadata: {
        prompt: 'img2img test',
        negativePrompt: '',
        model: 'base.safetensors',
        width: 512,
        height: 512,
        steps: 20,
        seed: 10,
        cfg_scale: 7,
        scheduler: 'normal',
        sampler: 'euler',
        generationType: 'img2img',
      } as BaseMetadata,
    });

    const prepared = await prepareOriginalWorkflowForExecution({
      image,
      metadata: image.metadata.normalizedMetadata as BaseMetadata,
      clientId: 'client-2',
      sourceImagePolicy: 'selected_image',
      uploadAsset: async () => 'uploaded.png',
    });

    expect(prepared.modeUsed).toBe('original');
    expect(prepared.payload.prompt['8'].inputs.image).toBe('uploaded.png');
  });
});

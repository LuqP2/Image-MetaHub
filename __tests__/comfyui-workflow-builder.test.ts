import { describe, expect, it, vi } from 'vitest';
import {
  analyzeComfyWorkflow,
  applyWorkflowOverridesToPromptGraph,
  buildComfyUIResourceCatalog,
  prepareOriginalWorkflowForExecution,
  updatePromptNodeLiteralValue,
  type ComfyUIModelResource,
} from '../services/comfyUIWorkflowBuilder';
import { buildVisualWorkflowGraph } from '../services/comfyUIVisualWorkflow';
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
        '10': {
          class_type: 'LoadImage',
          inputs: {
            image: 'control.png',
          },
        },
        '11': {
          class_type: 'ControlNetApplyAdvanced',
          inputs: {
            image: ['10', 0],
            conditioning: ['2', 0],
          },
        },
        '5': {
          ...rawPrompt['5'],
          inputs: {
            ...rawPrompt['5'].inputs,
            positive: ['11', 0],
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
    expect(prepared.payload.prompt['10'].inputs.image).toBe('control.png');
  });

  it('reanalyzes advanced prompt JSON using the remapped prompt targets', async () => {
    const image = createImage({
      workflow: { nodes: [] },
      prompt: rawPrompt,
      normalizedMetadata: {
        prompt: 'edited positive',
        negativePrompt: 'edited negative',
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

    const advancedPrompt = {
      '1': rawPrompt['1'],
      '20': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: 'advanced positive',
          clip: ['1', 1],
        },
      },
      '30': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: 'advanced negative',
          clip: ['1', 1],
        },
      },
      '4': rawPrompt['4'],
      '5': {
        ...rawPrompt['5'],
        inputs: {
          ...rawPrompt['5'].inputs,
          positive: ['20', 0],
          negative: ['30', 0],
        },
      },
      '6': rawPrompt['6'],
      '7': rawPrompt['7'],
    };

    const prepared = await prepareOriginalWorkflowForExecution({
      image,
      metadata: image.metadata.normalizedMetadata as BaseMetadata,
      clientId: 'client-3',
      sourceImagePolicy: 'reuse_original',
      advancedPromptJson: JSON.stringify(advancedPrompt),
    });

    expect(prepared.modeUsed).toBe('original');
    expect(prepared.payload.prompt['20'].inputs.text).toBe('advanced positive');
    expect(prepared.payload.prompt['30'].inputs.text).toBe('advanced negative');
    expect(prepared.analysis?.positiveTargets.some((target) => target.nodeId === '20')).toBe(true);
    expect(prepared.analysis?.negativeTargets.some((target) => target.nodeId === '30')).toBe(true);
  });

  it('injects MetaHub save node after the terminal decode when no save node exists', async () => {
    const image = createImage({
      workflow: { nodes: [] },
      prompt: {
        '1': rawPrompt['1'],
        '2': rawPrompt['2'],
        '3': rawPrompt['3'],
        '4': rawPrompt['4'],
        '5': rawPrompt['5'],
        '6': rawPrompt['6'],
        '7': {
          class_type: 'ImageScale',
          inputs: {
            image: ['6', 0],
          },
        },
        '8': {
          class_type: 'VAEEncode',
          inputs: {
            image: ['7', 0],
            vae: ['1', 2],
          },
        },
        '9': {
          class_type: 'KSampler',
          inputs: {
            seed: 456,
            steps: 12,
            cfg: 6,
            sampler_name: 'euler',
            scheduler: 'normal',
            model: ['1', 0],
            positive: ['2', 0],
            negative: ['3', 0],
            latent_image: ['8', 0],
          },
        },
        '10': {
          class_type: 'VAEDecode',
          inputs: {
            samples: ['9', 0],
            vae: ['1', 2],
          },
        },
      },
      normalizedMetadata: {
        prompt: 'terminal decode test',
        negativePrompt: '',
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

    const prepared = await prepareOriginalWorkflowForExecution({
      image,
      metadata: image.metadata.normalizedMetadata as BaseMetadata,
      clientId: 'client-4',
      sourceImagePolicy: 'reuse_original',
    });

    expect(prepared.modeUsed).toBe('original');
    expect(prepared.payload.prompt['12'].class_type).toBe('MetaHubSaveNode');
    expect(prepared.payload.prompt['12'].inputs.images).toEqual(['10', 0]);
  });

  it('builds a visual graph with auto-layout and editable literal fields', () => {
    const analysis = analyzeComfyWorkflow(
      createImage({
        workflow: { nodes: [] },
        prompt: rawPrompt,
        normalizedMetadata: {
          prompt: 'old positive',
          width: 512,
          height: 512,
          steps: 20,
        } as BaseMetadata,
      }),
      {
        prompt: 'old positive',
        width: 512,
        height: 512,
        steps: 20,
      } as BaseMetadata
    );

    const graph = buildVisualWorkflowGraph(rawPrompt, null, analysis);
    expect(graph).not.toBeNull();
    expect(graph?.hasStoredLayout).toBe(false);
    expect(graph?.nodes.find((node) => node.id === '5')?.category).toBe('sampler');
    expect(graph?.nodes.find((node) => node.id === '5')?.fields.some((field) => field.key === 'steps')).toBe(true);
    expect(graph?.edges.some((edge) => edge.from === '1' && edge.to === '5' && edge.label === 'model')).toBe(true);
  });

  it('anchors nodes without stored positions near the existing workflow layout', () => {
    const promptWithMissingLayout = {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: 'base.safetensors',
        },
      },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: 'positive',
          clip: ['1', 1],
        },
      },
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: 123,
          steps: 20,
          cfg: 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          model: ['1', 0],
          positive: ['2', 0],
          negative: ['2', 0],
        },
      },
    };

    const analysis = analyzeComfyWorkflow(
      {
        workflow: {
          last_node_id: 3,
          last_link_id: 0,
          nodes: [
            { id: 1, type: 'CheckpointLoaderSimple', pos: [0, 100], size: { 0: 280, 1: 140 } },
            { id: 3, type: 'KSampler', pos: [900, 120], size: { 0: 320, 1: 180 } },
          ],
        },
        prompt: promptWithMissingLayout,
      },
      {
        prompt: 'positive',
        width: 512,
        height: 512,
        steps: 20,
      } as BaseMetadata
    );

    const graph = buildVisualWorkflowGraph(
      promptWithMissingLayout,
      {
        last_node_id: 3,
        last_link_id: 0,
        nodes: [
          { id: 1, type: 'CheckpointLoaderSimple', pos: [0, 100], size: { 0: 280, 1: 140 } },
          { id: 3, type: 'KSampler', pos: [900, 120], size: { 0: 320, 1: 180 } },
        ],
      },
      analysis
    );

    const node2 = graph?.nodes.find((node) => node.id === '2');
    expect(graph?.hasStoredLayout).toBe(true);
    expect(node2).toBeDefined();
    expect(node2?.x).toBeGreaterThan(0);
    expect(node2?.x).toBeLessThan(900);
    expect(node2?.y).toBeGreaterThanOrEqual(90);
    expect(node2?.y).toBeLessThanOrEqual(130);
  });

  it('applies workflow override helpers without mutating the source prompt', () => {
    const image = createImage({
      workflow: { nodes: [] },
      prompt: rawPrompt,
      normalizedMetadata: {
        prompt: 'seed prompt',
        negativePrompt: 'seed negative',
        width: 512,
        height: 512,
        steps: 20,
        seed: 123,
      } as BaseMetadata,
    });
    const analysis = analyzeComfyWorkflow(image, image.metadata.normalizedMetadata as BaseMetadata);

    const patched = applyWorkflowOverridesToPromptGraph(
      rawPrompt,
      analysis,
      {
        ...(image.metadata.normalizedMetadata as BaseMetadata),
        prompt: 'patched prompt',
        negativePrompt: 'patched negative',
        steps: 44,
        seed: 987,
        width: 640,
        height: 768,
        cfg_scale: 9,
      } as BaseMetadata
    );
    const editedLiteral = updatePromptNodeLiteralValue(patched.prompt, '5', 'steps', 55);

    expect(rawPrompt['2'].inputs.text).toBe('old positive');
    expect(patched.prompt['2'].inputs.text).toBe('patched prompt');
    expect(patched.prompt['5'].inputs.steps).toBe(44);
    expect(editedLiteral['5'].inputs.steps).toBe(55);
    expect(patched.prompt['5'].inputs.steps).toBe(44);
  });

  it('treats advanced prompt json as authoritative during original workflow preparation', async () => {
    const image = createImage({
      workflow: { nodes: [] },
      prompt: rawPrompt,
      normalizedMetadata: {
        prompt: 'form prompt',
        negativePrompt: 'form negative',
        width: 512,
        height: 512,
        steps: 20,
        seed: 123,
        cfg_scale: 7,
        scheduler: 'normal',
        sampler: 'euler',
      } as BaseMetadata,
    });

    const advancedPrompt = {
      ...rawPrompt,
      '2': {
        ...rawPrompt['2'],
        inputs: {
          ...rawPrompt['2'].inputs,
          text: 'visual prompt',
        },
      },
      '5': {
        ...rawPrompt['5'],
        inputs: {
          ...rawPrompt['5'].inputs,
          steps: 77,
          sampler_name: 'heun',
        },
      },
    };

    const prepared = await prepareOriginalWorkflowForExecution({
      image,
      metadata: {
        ...(image.metadata.normalizedMetadata as BaseMetadata),
        prompt: 'form prompt should not win',
        steps: 22,
        sampler: 'euler_ancestral',
      } as BaseMetadata,
      clientId: 'client-3',
      sourceImagePolicy: 'reuse_original',
      advancedPromptJson: JSON.stringify(advancedPrompt),
    });

    expect(prepared.modeUsed).toBe('original');
    expect(prepared.payload.prompt['2'].inputs.text).toBe('visual prompt');
    expect(prepared.payload.prompt['5'].inputs.steps).toBe(77);
    expect(prepared.payload.prompt['5'].inputs.sampler_name).toBe('heun');
  });

  it('injects a save node when advanced prompt json replaces the original save chain', async () => {
    const image = createImage({
      workflow: { nodes: [{ id: 7, type: 'SaveImage', title: 'Save Image' }] },
      prompt: rawPrompt,
      normalizedMetadata: {
        prompt: 'old positive',
        negativePrompt: 'old negative',
        width: 512,
        height: 512,
        steps: 20,
        seed: 123,
      } as BaseMetadata,
    });

    const advancedPrompt = {
      '101': {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: 'base.safetensors',
        },
      },
      '102': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: 'advanced positive',
          clip: ['101', 1],
        },
      },
      '103': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: 'advanced negative',
          clip: ['101', 1],
        },
      },
      '104': {
        class_type: 'EmptyLatentImage',
        inputs: {
          width: 512,
          height: 512,
          batch_size: 1,
        },
      },
      '105': {
        class_type: 'KSampler',
        inputs: {
          seed: 123,
          steps: 20,
          cfg: 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          model: ['101', 0],
          positive: ['102', 0],
          negative: ['103', 0],
          latent_image: ['104', 0],
        },
      },
      '106': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['105', 0],
          vae: ['101', 2],
        },
      },
    };

    const prepared = await prepareOriginalWorkflowForExecution({
      image,
      metadata: image.metadata.normalizedMetadata as BaseMetadata,
      clientId: 'client-4',
      sourceImagePolicy: 'reuse_original',
      advancedPromptJson: JSON.stringify(advancedPrompt),
    });

    expect(prepared.modeUsed).toBe('original');
    expect(Object.values(prepared.payload.prompt).some((node) => node.class_type === 'MetaHubSaveNode')).toBe(true);
  });

  it('replaces random seed placeholders in advanced prompt json before queueing', async () => {
    const image = createImage({
      workflow: { nodes: [] },
      prompt: rawPrompt,
      normalizedMetadata: {
        prompt: 'form prompt',
        negativePrompt: 'form negative',
        width: 512,
        height: 512,
        steps: 20,
        seed: 123,
        cfg_scale: 7,
        scheduler: 'normal',
        sampler: 'euler',
      } as BaseMetadata,
    });

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    try {
      const prepared = await prepareOriginalWorkflowForExecution({
        image,
        metadata: {
          ...(image.metadata.normalizedMetadata as BaseMetadata),
          seed: -1,
        } as BaseMetadata,
        clientId: 'client-5',
        sourceImagePolicy: 'reuse_original',
        advancedPromptJson: JSON.stringify(rawPrompt),
      });

      expect(prepared.modeUsed).toBe('original');
      expect(prepared.payload.prompt['5'].inputs.seed).toBe(123456789);
    } finally {
      randomSpy.mockRestore();
    }
  });
});

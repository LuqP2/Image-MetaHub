import { describe, it, expect } from 'vitest';
import { parseComfyUIMetadataEnhanced, resolvePromptFromGraph, resolveWorkflowFactsFromGraph } from '../services/parsers/comfyUIParser';
import { parseImageMetadata } from '../services/parsers/metadataParserFactory';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ComfyUI Parser Test Suite
 * 
 * Tests cover:
 * - Basic KSampler workflows
 * - LoRA workflows with multiple loaders
 * - ControlNet workflows with strength parameters
 * - Hex seed format (0xABCDEF)
 * - Model hash fallback when name unavailable
 * - Edit history from LoadImage/SaveImage nodes
 * - ComfyUI version detection
 */

function loadFixture(name: string): any {
  const fixturePath = path.join(__dirname, 'fixtures', 'comfyui', name);
  const content = fs.readFileSync(fixturePath, 'utf-8');
  return JSON.parse(content);
}

describe('ComfyUI Parser - Basic Workflows', () => {
  it('should parse basic KSampler workflow', () => {
    const fixture = loadFixture('basic-ksampler.json');
    const result = resolvePromptFromGraph(fixture.workflow, fixture.prompt);
    
    expect(result.prompt).toBe('beautiful landscape, mountains, sunset');
    expect(result.negativePrompt).toBe('blurry, low quality');
    expect(result.seed).toBe(12345);
    expect(result.steps).toBe(20);
    expect(result.cfg).toBe(8);
    expect(result.sampler_name).toBe('euler');
    expect(result.scheduler).toBe('normal');
    expect(result.model).toBe('sd_xl_base_1.0.safetensors');
  });
});

describe('ComfyUI Parser - Prompt Sources', () => {
  it('should follow PrimitiveStringMultiline into CLIPTextEncode prompts', () => {
    const fixture = loadFixture('primitive-string-multiline.json');
    const result = resolvePromptFromGraph(fixture.workflow, fixture.prompt);

    expect(result.prompt).toBe('Visualize a long, eel-like mutant lizard with overlapping plates of translucent skin. Place it in a fossilized ocean desert where waves are frozen into glassy dunes.');
    expect(result._telemetry.unknown_nodes_count).toBe(0);
  });

  it('should handle ImpactWildcardProcessor populated_text links without treating them as text', () => {
    const prompt = {
      '1': {
        class_type: 'KSampler',
        inputs: {
          seed: 12345,
          steps: 20,
          cfg: 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          positive: ['2', 0],
          negative: ['5', 0],
        },
      },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: ['3', 0],
        },
      },
      '3': {
        class_type: 'ImpactWildcardProcessor',
        inputs: {
          populated_text: ['4', 0],
        },
        widgets_values: ['', 'fallback populated prompt', 'populate'],
      },
      '4': {
        class_type: 'ImpactWildcardProcessor',
        inputs: {},
        widgets_values: ['upstream template prompt', 'upstream populated prompt', 'populate'],
      },
      '5': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: '',
        },
      },
    };

    expect(() => resolvePromptFromGraph(undefined, prompt)).not.toThrow();
    expect(resolvePromptFromGraph(undefined, prompt).prompt).toBe('upstream populated prompt');

    const facts = resolveWorkflowFactsFromGraph(undefined, prompt);
    expect(facts?.prompts.positive).toBe('upstream populated prompt');
  });

  it('should parse Ideogram v4 KJ prompt-builder workflows wrapped in ComfyUI subgraphs', async () => {
    const subgraphType = '5b810a92-4e47-4e55-9059-ideogram-v4-subgraph';
    const noteText = 'UNRELATED NOTE NODE: do not use this as a prompt';
    const importJson = {
      high_level_description: 'a luminous explorer inspecting a floating archive',
      style_description: 'editorial sci-fi realism with crisp graphic composition',
      compositional_deconstruction: {
        background: 'a dark observatory wall filled with brass star charts',
        elements: [
          { desc: 'transparent holographic index cards orbiting the subject' },
          { desc: 'a small glowing navigation compass in the foreground' },
        ],
      },
    };

    const workflow = {
      nodes: [
        { id: 98, type: subgraphType, widgets_values: [], mode: 0 },
        { id: 200, type: 'SaveImage', widgets_values: ['Ideogram'], mode: 0 },
      ],
      definitions: {
        subgraphs: {
          [subgraphType]: {
            nodes: [
              { id: 11, type: 'UNETLoader', widgets_values: ['Ideogram\\ideogram4_fp8_scaled.safetensors', 'fp8_e4m3fn'], mode: 0 },
              { id: 12, type: 'VAELoader', widgets_values: ['flux2-vae.safetensors'], mode: 0 },
              { id: 17, type: 'Ideogram4PromptBuilderKJ', widgets_values: [
                1024,
                1024,
                'a luminous explorer inspecting a floating archive',
                'a dark observatory wall filled with brass star charts',
                'editorial sci-fi realism',
                'crisp graphic composition',
                'polished, detailed, cinematic',
                'soft rim light and cool key light',
                'digital painting',
                JSON.stringify([{ text: 'deep indigo and burnished gold palette' }]),
                JSON.stringify([
                  { desc: 'transparent holographic index cards orbiting the subject' },
                  { text: 'a small glowing navigation compass in the foreground' },
                ]),
                JSON.stringify(importJson),
              ], mode: 0 },
              { id: 19, type: 'Note', widgets_values: [noteText], mode: 0 },
              { id: 23, type: 'Ideogram4Scheduler', widgets_values: [12, 1024, 1024, 1, 1], mode: 0 },
              { id: 44, type: 'KSamplerSelect', widgets_values: ['euler'], mode: 0 },
              { id: 45, type: 'RandomNoise', widgets_values: [22958748446911, 'fixed'], mode: 0 },
              { id: 80, type: 'EmptyFlux2LatentImage', widgets_values: [1024, 1024, 1], mode: 0 },
              { id: 155, type: 'DualModelGuider', widgets_values: [7], mode: 0 },
              { id: 160, type: 'CFGOverride', widgets_values: [1.5, 0, 1], mode: 0 },
              { id: 170, type: 'SamplerCustomAdvanced', widgets_values: [], mode: 0 },
              { id: 180, type: 'VAEDecode', widgets_values: [], mode: 0 },
            ],
          },
        },
      },
    };

    const prompt = {
      '98:11': {
        inputs: {
          unet_name: 'Ideogram\\ideogram4_fp8_scaled.safetensors',
          weight_dtype: 'fp8_e4m3fn',
        },
      },
      '98:12': {
        inputs: {
          vae_name: 'flux2-vae.safetensors',
        },
      },
      '98:17': {
        inputs: {},
      },
      '98:19': {
        class_type: 'Note',
        inputs: {
          text: noteText,
        },
      },
      '98:23': {
        inputs: {},
      },
      '98:44': {
        inputs: {},
      },
      '98:45': {
        inputs: {},
      },
      '98:80': {
        inputs: {
          width: 1024,
          height: 1024,
          batch_size: 1,
        },
      },
      '98:155': {
        inputs: {
          model: ['98:160', 0],
          positive: ['98:17', 0],
          model_negative: ['98:160', 0],
          negative: '',
        },
      },
      '98:160': {
        inputs: {
          model: ['98:11', 0],
        },
      },
      '98:170': {
        inputs: {
          noise: ['98:45', 0],
          guider: ['98:155', 0],
          sampler: ['98:44', 0],
          sigmas: ['98:23', 0],
          latent_image: ['98:80', 0],
        },
      },
      '98:180': {
        inputs: {
          samples: ['98:170', 0],
          vae: ['98:12', 0],
        },
      },
      '200': {
        class_type: 'SaveImage',
        inputs: {
          images: ['98:180', 0],
        },
      },
    };

    const parsed = await parseImageMetadata({
      Prompt: JSON.stringify(prompt),
      Workflow: JSON.stringify(workflow),
    } as any);

    expect(parsed?.generator).toBe('ComfyUI');
    expect(parsed?.prompt).toContain('a luminous explorer inspecting a floating archive');
    expect(parsed?.prompt).toContain('a dark observatory wall filled with brass star charts');
    expect(parsed?.prompt).toContain('editorial sci-fi realism');
    expect(parsed?.prompt).toContain('transparent holographic index cards orbiting the subject');
    expect(parsed?.prompt).toContain('a small glowing navigation compass in the foreground');
    expect(parsed?.prompt).not.toContain(noteText);
    expect(parsed?.model).toBe('Ideogram\\ideogram4_fp8_scaled.safetensors');
    expect(parsed?.vae).toBe('flux2-vae.safetensors');
    expect(parsed?.seed).toBe(22958748446911);
    expect(parsed?.steps).toBe(12);
    expect(parsed?.cfg_scale).toBe(7);
    expect(parsed?.sampler).toBe('euler');
    expect(parsed?.scheduler).toBe('ideogram4');
    expect(parsed?.negativePrompt).toBe('');
  });

  it('should inherit muted parent mode for subgraph children', () => {
    const subgraphType = 'muted-subgraph-fixture';
    const workflow = {
      nodes: [
        { id: 98, type: subgraphType, widgets_values: [], mode: 0 },
        { id: 99, type: subgraphType, widgets_values: [], mode: 2 },
      ],
      definitions: {
        subgraphs: {
          [subgraphType]: {
            nodes: [
              { id: 1, type: 'CLIPTextEncode', widgets_values: [''], mode: 0 },
              { id: 2, type: 'KSampler', widgets_values: [111, 'fixed', 20, 7, 'euler', 'normal', 1], mode: 0 },
              { id: 3, type: 'KSampler', widgets_values: [999, 'fixed', 40, 11, 'uni_pc', 'simple', 1], mode: 0 },
            ],
          },
        },
      },
    };
    const prompt = {
      '98:1': {
        inputs: {
          text: 'active subgraph prompt',
        },
      },
      '98:2': {
        inputs: {
          seed: 111,
          steps: 20,
          cfg: 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          positive: ['98:1', 0],
        },
      },
      '99:1': {
        inputs: {
          text: 'muted subgraph prompt',
        },
      },
      '99:2': {
        inputs: {
          seed: 222,
          steps: 30,
          cfg: 9,
          sampler_name: 'dpmpp_2m',
          scheduler: 'karras',
          positive: ['99:1', 0],
        },
      },
    };

    const result = resolvePromptFromGraph(workflow, prompt);

    expect(result.prompt).toBe('active subgraph prompt');
    expect(result.prompt).not.toBe('muted subgraph prompt');
    expect(result.seed).toBe(111);
    expect(result.sampler_name).toBe('euler');
  });
});

describe('ComfyUI Parser - Detection from capitalized string keys', () => {
  it('should detect ComfyUI when Prompt/Workflow are capitalized and stringified', async () => {
    const fixture = loadFixture('primitive-string-multiline.json');
    const metadata: any = {
      Prompt: JSON.stringify(fixture.prompt),
      Workflow: JSON.stringify(fixture.workflow),
      parameters: '' // present but should not force A1111 path
    };

    const result = await parseImageMetadata(metadata);

    expect(result?.generator).toBe('ComfyUI');
    expect(result?.prompt).toContain('Visualize a long, eel-like mutant lizard');
    expect(result?.prompt).toContain('fossilized ocean desert');
  });

  it('should prefer ComfyUI graph chunks over non-empty parameters text', async () => {
    const fixture = loadFixture('primitive-string-multiline.json');
    const metadata: any = {
      Prompt: JSON.stringify(fixture.prompt),
      Workflow: JSON.stringify(fixture.workflow),
      parameters: 'wrong prompt\nSteps: 1, Sampler: wrong, CFG scale: 1, Seed: 1, Size: 64x64, Model: wrong.safetensors'
    };

    const result = await parseImageMetadata(metadata);

    expect(result?.generator).toBe('ComfyUI');
    expect(result?.prompt).toContain('Visualize a long, eel-like mutant lizard');
    expect(result?.model).not.toBe('wrong.safetensors');
  });

  it('should parse standard SaveImage exports with SDXL rgthree nodes', async () => {
    const prompt = {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: 152203930877602,
          steps: 30,
          cfg: 5,
          sampler_name: 'dpmpp_2m_sde',
          scheduler: 'exponential',
          denoise: 1,
          model: ['42', 0],
          positive: ['30', 0],
          negative: ['33', 0],
          latent_image: ['43', 0],
        },
      },
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: 'realismByStableYogi_v60FP16.safetensors',
        },
      },
      '8': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['3', 0],
          vae: ['4', 2],
        },
      },
      '28': {
        class_type: 'SaveImage',
        inputs: {
          filename_prefix: 'pony-',
          images: ['8', 0],
        },
      },
      '30': {
        class_type: 'CLIPTextEncodeSDXL',
        inputs: {
          width: 4096,
          height: 4096,
          crop_w: 0,
          crop_h: 0,
          target_width: 4096,
          target_height: 4096,
          text_g: '1girl, portrait, a girl with green hair standing in front of the ocean',
          text_l: '1girl, portrait, a girl with green hair standing in front of the ocean',
          clip: ['42', 1],
        },
      },
      '33': {
        class_type: 'CLIPTextEncodeSDXL',
        inputs: {
          width: 4096,
          height: 4096,
          crop_w: 0,
          crop_h: 0,
          target_width: 4096,
          target_height: 4096,
          text_g: ' poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, (mutated hands and fingers:1.4), disconnected limbs, mutation, mutated, ugly, disgusting, amputation\n',
          text_l: ' poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, (mutated hands and fingers:1.4), disconnected limbs, mutation, mutated, ugly, disgusting, amputation\n',
          clip: ['42', 1],
        },
      },
      '42': {
        class_type: 'Power Lora Loader (rgthree)',
        inputs: {
          PowerLoraLoaderHeaderWidget: { type: 'PowerLoraLoaderHeaderWidget' },
          lora_5: {
            on: true,
            lora: 'sdxl/Realism Lora By Stable Yogi_V3_Lite.safetensors',
            strength: 1,
          },
          model: ['4', 0],
          clip: ['4', 1],
        },
      },
      '43': {
        class_type: 'SDXL Empty Latent Image (rgthree)',
        inputs: {
          dimensions: ' 832 x 1216 (portrait)',
          clip_scale: 2,
          batch_size: 1,
        },
      },
    };

    const workflow = {
      nodes: [
        { id: 3, type: 'KSampler', widgets_values: [152203930877602, 'randomize', 30, 5, 'dpmpp_2m_sde', 'exponential', 1], mode: 0 },
        { id: 4, type: 'CheckpointLoaderSimple', widgets_values: ['realismByStableYogi_v60FP16.safetensors'], mode: 0 },
        { id: 28, type: 'SaveImage', widgets_values: ['pony-'], mode: 0 },
        { id: 30, type: 'CLIPTextEncodeSDXL', widgets_values: [4096, 4096, 0, 0, 4096, 4096, '1girl, portrait, a girl with green hair standing in front of the ocean', '1girl, portrait, a girl with green hair standing in front of the ocean'], mode: 0 },
        { id: 33, type: 'CLIPTextEncodeSDXL', widgets_values: [4096, 4096, 0, 0, 4096, 4096, ' poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, (mutated hands and fingers:1.4), disconnected limbs, mutation, mutated, ugly, disgusting, amputation\n', ' poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, (mutated hands and fingers:1.4), disconnected limbs, mutation, mutated, ugly, disgusting, amputation\n'], mode: 0 },
        { id: 42, type: 'Power Lora Loader (rgthree)', widgets_values: [{}, { type: 'PowerLoraLoaderHeaderWidget' }, { on: true, lora: 'sdxl/Realism Lora By Stable Yogi_V3_Lite.safetensors', strength: 1 }, {}, ''], mode: 0 },
        { id: 43, type: 'SDXL Empty Latent Image (rgthree)', widgets_values: [' 832 x 1216 (portrait)', 2, 1], mode: 0 },
      ],
    };

    const result = await parseImageMetadata({
      Prompt: JSON.stringify(prompt),
      Workflow: JSON.stringify(workflow),
    } as any);

    expect(result?.generator).toBe('ComfyUI');
    expect(result?.prompt).toBe('1girl, portrait, a girl with green hair standing in front of the ocean');
    expect(result?.negativePrompt).toBe('poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, (mutated hands and fingers:1.4), disconnected limbs, mutation, mutated, ugly, disgusting, amputation');
    expect(result?.model).toBe('realismByStableYogi_v60FP16.safetensors');
    expect(result?.seed).toBe(152203930877602);
    expect(result?.steps).toBe(30);
    expect(result?.cfg_scale).toBe(5);
    expect(result?.sampler).toBe('dpmpp_2m_sde');
    expect(result?.scheduler).toBe('exponential');
    expect(result?.denoise).toBe(1);
    expect(result?.loras).toContainEqual({
      name: 'sdxl/Realism Lora By Stable Yogi_V3_Lite.safetensors',
      weight: 1,
    });
  });
});

describe('ComfyUI Parser - Output terminal traversal', () => {
  it('should walk back from SaveImage through image links to prompt-bearing nodes', () => {
    const prompt = {
      '1': {
        class_type: 'SaveImage',
        inputs: {
          images: ['2', 0],
        },
      },
      '2': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['3', 0],
          vae: ['6', 2],
        },
      },
      '3': {
        class_type: 'WanImageToVideo',
        inputs: {
          positive: ['4', 0],
          negative: ['5', 0],
          vae: ['6', 2],
          width: 832,
          height: 480,
          length: 49,
          batch_size: 1,
        },
      },
      '4': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: 'cinematic motion portrait',
        },
      },
      '5': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: 'blur, artifacts',
        },
      },
      '6': {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: 'wan-video-model.safetensors',
        },
      },
    };

    const result = resolvePromptFromGraph(undefined, prompt);

    expect(result.prompt).toBe('cinematic motion portrait');
    expect(result.negativePrompt).toBe('blur, artifacts');
  });
});

describe('ComfyUI Parser - MetaHub chunk graph recovery', () => {
  it('recovers ZiT style prompts and rgthree Power LoRAs from malformed MetaHub fields', async () => {
    const result = await parseImageMetadata({
      imagemetahub_data: {
        generator: 'ComfyUI',
        prompt: '',
        negativePrompt: '',
        loras: [
          {
            name: {
              on: true,
              lora: 'Z-Detail-Slider.safetensors',
              strength: 0.5325,
            },
            weight: 1,
          },
        ],
        workflow: { nodes: [] },
        prompt_api: {
          '61': {
            class_type: 'SamplerCustomAdvanced',
            inputs: {
              guider: ['101', 0],
            },
          },
          '67': {
            class_type: 'Power Lora Loader (rgthree)',
            inputs: {
              lora_1: {
                on: true,
                lora: 'Z-Detail-Slider.safetensors',
                strength: 0.5325,
              },
              lora_2: {
                on: true,
                lora: 'zy_CinematicShot_zit.safetensors',
                strength: 0.6875,
              },
            },
          },
          '100': {
            class_type: 'ModelSamplingAuraFlow',
            inputs: {
              shift: 5,
              model: ['67', 0],
            },
          },
          '101': {
            class_type: 'BasicGuider',
            inputs: {
              model: ['100', 0],
              conditioning: ['114', 0],
            },
          },
          '114': {
            class_type: 'StylePromptEncoder2 //ZImagePowerNodes',
            inputs: {
              style: '"Production Photo"',
              text: 'A white cat on the roof of a brick house',
              clip: ['67', 1],
            },
          },
        },
      },
    } as any);

    expect(result?.prompt).toBe('A white cat on the roof of a brick house');
    expect(result?.loras).toEqual([
      { name: 'Z-Detail-Slider.safetensors' },
      { name: 'zy_CinematicShot_zit.safetensors' },
    ]);
  });

  it('recovers prompt and seed from embedded prompt_api when old MetaHub chunks are empty', async () => {
    const metadata: any = {
      imagemetahub_data: {
        generator: 'ComfyUI',
        prompt: '',
        negativePrompt: '',
        seed: 0,
        steps: 9,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        model: 'Z image Turbo\\z_image_turbo_bf16.safetensors',
        vae: 'ae.safetensors',
        denoise: 1,
        width: 1056,
        height: 1584,
        loras: [],
        workflow: { nodes: [] },
        prompt_api: {
          '1': {
            class_type: 'UNETLoader',
            inputs: { unet_name: 'Z image Turbo\\z_image_turbo_bf16.safetensors' },
          },
          '2': {
            class_type: 'Lora Loader (LoraManager)',
            inputs: {
              text: 'luneva <lora:detail:0.80>',
              model: ['1', 0],
            },
          },
          '3': {
            class_type: 'PathchSageAttentionKJ',
            inputs: { model: ['2', 0] },
          },
          '4': {
            class_type: 'easy positive',
            inputs: { positive: 'gothic castle in teal fog' },
          },
          '5': {
            class_type: 'JoinStrings',
            inputs: { delimiter: ' ', string1: ['4', 0] },
          },
          '6': {
            class_type: 'easy stylesSelector',
            inputs: { positive: ['5', 0] },
          },
          '7': {
            class_type: 'CLIPTextEncode',
            inputs: { text: ['6', 0], clip: ['2', 1] },
          },
          '8': {
            class_type: 'ConditioningZeroOut',
            inputs: { conditioning: ['7', 0] },
          },
          '9': {
            class_type: 'SeedGenerator',
            inputs: { seed: 1100100895348371 },
          },
          '10': {
            class_type: 'KSampler',
            inputs: {
              seed: ['9', 0],
              steps: 9,
              cfg: 1,
              sampler_name: 'euler',
              scheduler: 'simple',
              denoise: 1,
              model: ['3', 0],
              positive: ['7', 0],
              negative: ['8', 0],
            },
          },
          '11': {
            class_type: 'VAELoader',
            inputs: { vae_name: 'ae.safetensors' },
          },
          '12': {
            class_type: 'VAEDecode',
            inputs: { samples: ['10', 0], vae: ['11', 0] },
          },
          '13': {
            class_type: 'MetaHubSaveNode',
            inputs: { images: ['12', 0] },
          },
        },
      },
    };

    const result = await parseImageMetadata(metadata);

    expect(result?.generator).toBe('ComfyUI');
    expect(result?.prompt).toBe('gothic castle in teal fog');
    expect(result?.negativePrompt).toBe('');
    expect(result?.seed).toBe(1100100895348371);
    expect(result?.model).toBe('Z image Turbo\\z_image_turbo_bf16.safetensors');
  });
});

describe('ComfyUI Parser - Prompt-only graph payloads', () => {
  it('should detect and parse Civitai-style prompt-only graph metadata with smZ CLIPTextEncode', async () => {
    const metadata: any = {
      'resource-stack': {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: 'urn:air:sdxl:checkpoint:civitai:140272@2010753'
        }
      },
      'resource-stack-1': {
        class_type: 'LoraLoader',
        inputs: {
          lora_name: 'urn:air:sdxl:lora:civitai:1280702@1444863',
          strength_model: -0.65,
          strength_clip: 1,
          model: ['resource-stack', 0],
          clip: ['resource-stack', 1]
        }
      },
      '6': {
        class_type: 'smZ CLIPTextEncode',
        inputs: {
          text: 'mechanical girl in ruins',
          clip: ['resource-stack-1', 1]
        }
      },
      '7': {
        class_type: 'smZ CLIPTextEncode',
        inputs: {
          text: 'photo, realistic',
          clip: ['resource-stack-1', 1]
        }
      },
      '11': {
        class_type: 'KSampler',
        inputs: {
          sampler_name: 'euler_ancestral',
          scheduler: 'normal',
          seed: 1043951494,
          steps: 19,
          cfg: 7,
          denoise: 0.2,
          model: ['resource-stack-1', 0],
          positive: ['6', 0],
          negative: ['7', 0]
        }
      },
      extra: {
        airs: [
          'urn:air:sdxl:checkpoint:civitai:140272@2010753',
          'urn:air:sdxl:lora:civitai:1280702@1444863'
        ]
      },
      extraMetadata: '{"workflowId":"img2img-hires"}'
    };

    const result = await parseImageMetadata(metadata);

    expect(result).not.toBeNull();
    expect(result?.generator).toBe('ComfyUI');
    expect(result?.prompt).toBe('mechanical girl in ruins');
    expect(result?.negativePrompt).toBe('photo, realistic');
    expect(result?.model).toBe('urn:air:sdxl:checkpoint:civitai:140272@2010753');
    expect(result?.seed).toBe(1043951494);
    expect(result?.steps).toBe(19);
    expect(result?.cfg_scale).toBe(7);
    expect(result?.sampler).toBe('euler_ancestral');
    expect(result?.loras).toContainEqual({
      name: 'urn:air:sdxl:lora:civitai:1280702@1444863',
      weight: -0.65,
    });
  });
});

describe('ComfyUI Parser - LoRA Workflows', () => {
  it('should detect multiple LoRAs with weights', () => {
    const fixture = loadFixture('lora-workflow.json');
    const result = resolvePromptFromGraph(fixture.workflow, fixture.prompt);
    
    expect(result.loras).toBeDefined();
    expect(result.loras).toHaveLength(2);
    
    // Check first LoRA
    expect(result.loras[0].name).toBe('style_lora_v1.safetensors');
    expect(result.loras[0].weight).toBe(0.8);
    
    // Check second LoRA
    expect(result.loras[1].name).toBe('detail_tweaker.safetensors');
    expect(result.loras[1].weight).toBe(0.5);
    
    // Backward compatibility: lora array should exist
    expect(result.lora).toContain('style_lora_v1.safetensors');
    expect(result.lora).toContain('detail_tweaker.safetensors');
  });
  
  it('should extract workflow parameters with LoRAs', () => {
    const fixture = loadFixture('lora-workflow.json');
    const result = resolvePromptFromGraph(fixture.workflow, fixture.prompt);
    
    expect(result.seed).toBe(54321);
    expect(result.steps).toBe(30);
    expect(result.cfg).toBe(7.5);
    expect(result.sampler_name).toBe('dpmpp_2m');
    expect(result.scheduler).toBe('karras');
  });

  it('should read LoraManager LoRAs from workflow widget values', () => {
    const result = resolvePromptFromGraph({
      nodes: [
        {
          id: 2,
          type: 'Lora Loader (LoraManager)',
          widgets_values: [
            '',
            'cinematic portrait',
            [
              { name: 'ui_lora.safetensors', active: true },
              { name: 'disabled_lora.safetensors', active: false },
            ],
          ],
          mode: 0,
        },
        {
          id: 3,
          type: 'KSampler',
          widgets_values: [123, 'fixed', 20, 7, 'euler', 'normal', 1],
          mode: 0,
        },
      ],
    }, {
      '2': {
        class_type: 'Lora Loader (LoraManager)',
        inputs: {
          text: 'cinematic portrait',
          model: ['1', 0],
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
          denoise: 1,
          model: ['2', 0],
        },
      },
    });

    expect(result.lora).toContain('ui_lora.safetensors');
    expect(result.lora).not.toContain('disabled_lora.safetensors');
  });

  it('should preserve JoinStrings delimiter from widget values', () => {
    const result = resolvePromptFromGraph({
      nodes: [
        {
          id: 1,
          type: 'String Literal',
          widgets_values: ['alpha'],
          mode: 0,
        },
        {
          id: 2,
          type: 'String Literal',
          widgets_values: ['beta'],
          mode: 0,
        },
        {
          id: 3,
          type: 'JoinStrings',
          widgets_values: [', '],
          mode: 0,
        },
        {
          id: 4,
          type: 'CLIPTextEncode',
          widgets_values: [''],
          mode: 0,
        },
        {
          id: 5,
          type: 'KSampler',
          widgets_values: [123, 'fixed', 20, 7, 'euler', 'normal', 1],
          mode: 0,
        },
      ],
    }, {
      '1': {
        class_type: 'String Literal',
        inputs: { string: 'alpha' },
      },
      '2': {
        class_type: 'String Literal',
        inputs: { string: 'beta' },
      },
      '3': {
        class_type: 'JoinStrings',
        inputs: {
          delimiter: ', ',
          string1: ['1', 0],
          string2: ['2', 0],
        },
      },
      '4': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: ['3', 0],
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
          denoise: 1,
          positive: ['4', 0],
          negative: ['4', 0],
        },
      },
    });

    expect(result.prompt).toBe('alpha, beta');
  });
});

describe('ComfyUI Parser - ControlNet Workflows', () => {
  it('should detect ControlNet with strength', () => {
    const fixture = loadFixture('controlnet-workflow.json');
    const result = resolvePromptFromGraph(fixture.workflow, fixture.prompt);
    
    expect(result.controlnets).toBeDefined();
    expect(result.controlnets).toHaveLength(1);
    
    expect(result.controlnets[0].name).toBe('control_v11p_sd15_canny.pth');
    expect(result.controlnets[0].weight).toBe(0.85);
  });
  
  it('should extract workflow parameters with ControlNet', () => {
    const fixture = loadFixture('controlnet-workflow.json');
    const result = resolvePromptFromGraph(fixture.workflow, fixture.prompt);
    
    expect(result.seed).toBe(99999);
    expect(result.steps).toBe(25);
    expect(result.cfg).toBe(7);
    expect(result.sampler_name).toBe('euler_a');
  });
});

describe('ComfyUI Parser - Advanced Seed Formats', () => {
  it('should parse hex seed format (0xABCDEF12)', () => {
    const fixture = loadFixture('hex-seed.json');
    const result = resolvePromptFromGraph(fixture.workflow, fixture.prompt);
    
    // Hex seed should be converted to decimal
    const expectedSeed = parseInt('0xABCDEF12', 16);
    expect(result.seed).toBe(expectedSeed);
    expect(result.approximateSeed).toBeUndefined();
  });
});

describe('ComfyUI Parser - Model Detection', () => {
  it('should map model hash to unknown (hash: xxxx) format', () => {
    const fixture = loadFixture('model-hash.json');
    const result = resolvePromptFromGraph(fixture.workflow, fixture.prompt);
    
    expect(result.model).toMatch(/^unknown \(hash: [0-9a-fA-F]{8}\)$/);
    expect(result.model).toContain('a1b2c3d4');
  });
});

describe('ComfyUI Parser - Edit History', () => {
  it('should extract LoadImage/SaveImage history', () => {
    const fixture = loadFixture('edit-history.json');
    const result = resolvePromptFromGraph(fixture.workflow, fixture.prompt);
    
    expect(result.editHistory).toBeDefined();
    expect(result.editHistory.length).toBeGreaterThan(0);
    
    // Check for load action
    const loadAction = result.editHistory.find((h: any) => h.action === 'load');
    expect(loadAction).toBeDefined();
    expect(loadAction?.filename).toBe('base_image.png');
    
    // Check for save action
    const saveAction = result.editHistory.find((h: any) => h.action === 'save');
    expect(saveAction).toBeDefined();
    expect(saveAction?.timestamp).toBeDefined();
  });
});

describe('ComfyUI Parser - Version Detection', () => {
  it('should extract ComfyUI version from workflow metadata', () => {
    const fixture = loadFixture('version-metadata.json');
    const result = resolvePromptFromGraph(fixture.workflow, fixture.prompt);
    
    expect(result.comfyui_version).toBe('1.2.3');
  });
});

describe('ComfyUI Parser - Detection Methods', () => {
  it('should report standard detection method for valid workflows', () => {
    const fixture = loadFixture('basic-ksampler.json');
    const result = resolvePromptFromGraph(fixture.workflow, fixture.prompt);
    
    expect(result._telemetry).toBeDefined();
    expect(result._telemetry.detection_method).toBe('standard');
  });
  
  it('should track unknown nodes in telemetry', () => {
    const customFixture = {
      workflow: { nodes: [] },
      prompt: {
        "1": {
          "class_type": "CustomUnknownNode",
          "inputs": {}
        },
        "3": {
          "class_type": "KSampler",
          "inputs": {
            "seed": 12345,
            "steps": 20,
            "cfg": 8,
            "sampler_name": "euler",
            "scheduler": "normal",
            "denoise": 1,
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0]
          }
        }
      }
    };
    
    const result = resolvePromptFromGraph(customFixture.workflow, customFixture.prompt);
    
    expect(result._telemetry.unknown_nodes_count).toBeGreaterThan(0);
    expect(result._telemetry.warnings).toContain('Unknown node type: CustomUnknownNode');
  });
});

describe('ComfyUI Parser - MetaHub lineage metadata', () => {
  it('parses Image MetaHub export payloads written with the standard metadata chunk', async () => {
    const result = await parseImageMetadata({
      imagemetahub_data: {
        generator: 'Image MetaHub',
        prompt: 'studio portrait',
        negativePrompt: 'blur',
        seed: 456,
        steps: 32,
        cfg: 7,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        model: 'portrait-xl.safetensors',
        width: 768,
        height: 1024,
        loras: [{ name: 'skin-detail', weight: 0.65 }],
        imh_attribution: {
          schema_version: 1,
          token: 'imhcrt_br_creator_workflow_v1_random',
          source: 'metahub_save_node',
          node_version: '1.0.9',
        },
        imh_pro: {
          user_tags: 'portrait, retouch',
          notes: 'Edited in Image MetaHub',
        },
      },
    } as any);

    expect(result).toMatchObject({
      prompt: 'studio portrait',
      negativePrompt: 'blur',
      model: 'portrait-xl.safetensors',
      seed: 456,
      steps: 32,
      cfg_scale: 7,
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      width: 768,
      height: 1024,
      _detection_method: 'metahub_chunk',
      _metahub_pro: {
        user_tags: 'portrait, retouch',
        notes: 'Edited in Image MetaHub',
      },
    });
    expect(result?.loras).toEqual([{ name: 'skin-detail', weight: 0.65 }]);
    expect(result?.imh_attribution?.token).toBe('imhcrt_br_creator_workflow_v1_random');
  });

  it('keeps MetaHub payload as canonical when parameters disagree', async () => {
    const result = await parseImageMetadata({
      parameters: 'wrong prompt\nSteps: 1, Sampler: wrong, CFG scale: 1, Seed: 1, Size: 64x64, Model: wrong.safetensors',
      imagemetahub_data: {
        generator: 'ComfyUI',
        prompt: 'canonical prompt',
        negativePrompt: 'canonical negative',
        seed: 456,
        steps: 32,
        cfg: 7,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        model: 'canonical.safetensors',
        width: 768,
        height: 1024,
        metadata_status: 'complete',
        metadata_sources: { prompt: 'detected', model_name: 'detected' },
      },
    } as any);

    expect(result?.prompt).toBe('canonical prompt');
    expect(result?.model).toBe('canonical.safetensors');
    expect(result?._metadata_status).toBe('complete');
    expect(result?._metadata_sources).toEqual({ prompt: 'detected', model_name: 'detected' });
  });

  it('preserves explicit MetaHub seed zero even when prompt graph has another seed', async () => {
    const result = await parseImageMetadata({
      imagemetahub_data: {
        generator: 'ComfyUI',
        prompt: 'zero seed prompt',
        negativePrompt: '',
        seed: 0,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        model: 'zero-seed.safetensors',
        width: 512,
        height: 512,
        metadata_status: 'partial',
        metadata_sources: { seed: 'manual_override' },
        prompt_api: {
          '1': {
            class_type: 'KSampler',
            inputs: {
              seed: 999,
              steps: 20,
              cfg: 7,
              sampler_name: 'euler',
              scheduler: 'normal',
              denoise: 1,
            },
          },
        },
      },
    } as any);

    expect(result?.seed).toBe(0);
  });

  it('prefers parent_image for library lineage and keeps source_image as workflowSourceImage', async () => {
    const metadata: any = {
      imagemetahub_data: {
        generator: 'ComfyUI',
        prompt: 'portrait',
        negativePrompt: '',
        seed: 123,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        model: 'base.safetensors',
        width: 512,
        height: 512,
        generation_type: 'img2img',
        parent_image: {
          fileName: 'selected.png',
          relativePath: 'library/selected.png',
        },
        source_image: {
          fileName: 'workflow-input.png',
          relativePath: 'inputs/workflow-input.png',
        },
        workflow: { nodes: [] },
        prompt_api: {
          '1': {
            class_type: 'KSampler',
            inputs: {},
          },
        },
      },
    };

    const result = await parseImageMetadata(metadata);

    expect(result?.generationType).toBe('img2img');
    expect(result?.lineage?.sourceImage?.fileName).toBe('selected.png');
    expect(result?.lineage?.workflowSourceImage?.fileName).toBe('workflow-input.png');
  });

  it('infers lineage from workflow graphs when explicit MetaHub lineage fields are absent', async () => {
    const result = await parseComfyUIMetadataEnhanced({
      imagemetahub_data: {
        generator: 'ComfyUI',
        prompt: 'variation',
        negativePrompt: '',
        seed: 77,
        steps: 18,
        cfg: 6.5,
        sampler_name: 'euler',
        scheduler: 'normal',
        model: 'base.safetensors',
        denoise: 0.35,
        workflow: { nodes: [] },
        prompt_api: {
          '1': {
            class_type: 'LoadImage',
            inputs: {
              image: 'inputs/base.png',
            },
          },
          '2': {
            class_type: 'VAEEncode',
            inputs: {
              pixels: ['1', 0],
            },
          },
          '3': {
            class_type: 'CheckpointLoaderSimple',
            inputs: {
              ckpt_name: 'base.safetensors',
            },
          },
          '4': {
            class_type: 'CLIPTextEncode',
            inputs: {
              text: 'variation',
              clip: ['3', 1],
            },
          },
          '5': {
            class_type: 'KSampler',
            inputs: {
              model: ['3', 0],
              positive: ['4', 0],
              seed: 77,
              steps: 18,
              cfg: 6.5,
              sampler_name: 'euler',
              scheduler: 'normal',
              denoise: 0.35,
              latent_image: ['2', 0],
            },
          },
        },
      },
    });

    expect(result.generationType).toBe('img2img');
    expect(result.lineage?.detection).toBe('inferred');
    expect(result.lineage?.sourceImage?.fileName).toBe('base.png');
    expect(result.lineage?.sourceImage?.relativePath).toBe('inputs/base.png');
  });
});

describe('ComfyUI Parser - Error Handling', () => {
  it('should fallback to regex parsing when no terminal node found', () => {
    const invalidFixture = {
      workflow: { nodes: [] },
      prompt: {
        "1": {
          "class_type": "UnknownNode",
          "inputs": {}
        }
      }
    };
    
    const result = resolvePromptFromGraph(invalidFixture.workflow, invalidFixture.prompt);
    
    expect(result._telemetry).toBeDefined();
    expect(result._telemetry.warnings).toContain('No terminal node found');
  });
  
  it('should handle empty workflow gracefully', () => {
    const emptyFixture = {
      workflow: { nodes: [] },
      prompt: {}
    };
    
    const result = resolvePromptFromGraph(emptyFixture.workflow, emptyFixture.prompt);

    expect(result._telemetry).toBeDefined();
    expect(result._telemetry.warnings).toContain('No terminal node found');
  });

  it('should handle missing workflow and prompt payloads without throwing', () => {
    const result = resolvePromptFromGraph(undefined, undefined);

    expect(result._telemetry).toBeDefined();
    expect(result._telemetry.warnings).toContain('No terminal node found');
    expect(result.comfyui_version).toBeUndefined();
  });
});

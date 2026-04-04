import { describe, it, expect } from 'vitest';
import { resolvePromptFromGraph } from '../services/parsers/comfyUIParser';
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
    expect(result?.loras).toContain('urn:air:sdxl:lora:civitai:1280702@1444863');
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

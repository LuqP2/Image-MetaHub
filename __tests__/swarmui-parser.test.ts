import { describe, it, expect } from 'vitest';
import { isSwarmUIMetadata } from '../types';
import { parseSwarmUIMetadata } from '../services/parsers/swarmUIParser';

describe('SwarmUI Parser', () => {
  describe('Metadata Detection', () => {
    it('should detect SwarmUI metadata at root level', () => {
      const metadata = {
        sui_image_params: {
          prompt: 'test prompt',
          model: 'test_model',
          seed: 12345
        }
      };

      expect(isSwarmUIMetadata(metadata)).toBe(true);
    });

    it('should detect SwarmUI metadata wrapped in parameters string', () => {
      const metadata = {
        parameters: JSON.stringify({
          sui_image_params: {
            prompt: 'test prompt',
            model: 'test_model',
            seed: 12345
          }
        })
      };

      expect(isSwarmUIMetadata(metadata)).toBe(true);
    });

    it('should not detect non-SwarmUI metadata', () => {
      const metadata = {
        parameters: 'Prompt: test\nSteps: 20'
      };

      expect(isSwarmUIMetadata(metadata)).toBe(false);
    });
  });

  describe('Metadata Parsing', () => {
    it('should parse SwarmUI metadata at root level', () => {
      const metadata = {
        sui_image_params: {
          prompt: 'beautiful landscape',
          negativeprompt: 'blurry, ugly',
          model: 'sdxl_base_1.0',
          seed: 12345,
          steps: 25,
          cfgscale: 7.5,
          width: 1024,
          height: 1024,
          sampler: 'euler',
          scheduler: 'normal',
          loras: ['style_lora']
        }
      };

      const result = parseSwarmUIMetadata(metadata);

      expect(result.prompt).toBe('beautiful landscape');
      expect(result.negativePrompt).toBe('blurry, ugly');
      expect(result.model).toBe('sdxl_base_1.0');
      expect(result.models).toEqual(['sdxl_base_1.0']);
      expect(result.seed).toBe(12345);
      expect(result.steps).toBe(25);
      expect(result.cfg_scale).toBe(7.5);
      expect(result.width).toBe(1024);
      expect(result.height).toBe(1024);
      expect(result.sampler).toBe('euler');
      expect(result.scheduler).toBe('normal');
      expect(result.loras).toEqual(['style_lora']);
      expect(result.generator).toBe('SwarmUI');
    });

    it('should parse SwarmUI metadata wrapped in parameters string', () => {
      const metadata = {
        parameters: JSON.stringify({
          sui_image_params: {
            prompt: 'wrapped prompt',
            model: 'wrapped_model',
            seed: 67890,
            loras: ['lora1', 'lora2']
          }
        })
      };

      const result = parseSwarmUIMetadata(metadata);

      expect(result.prompt).toBe('wrapped prompt');
      expect(result.model).toBe('wrapped_model');
      expect(result.seed).toBe(67890);
      expect(result.loras).toEqual(['lora1', 'lora2']);
      expect(result.generator).toBe('SwarmUI');
    });
  });
});
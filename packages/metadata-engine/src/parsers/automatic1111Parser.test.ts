import { describe, it, expect } from 'vitest';
import { parseA1111Metadata } from './automatic1111Parser';
import { BaseMetadata } from '../core/types';

describe('parseA1111Metadata', () => {
  it('should return a default object if the parameters string is empty or whitespace', () => {
    const expected: Partial<BaseMetadata> = { loras: [], models: [], prompt: '', generator: 'A1111' };
    expect(parseA1111Metadata('')).toEqual(expected);
    const expectedWhiteSpace: Partial<BaseMetadata> = { loras: [], models: [], prompt: '   ', generator: 'A1111' };
    expect(parseA1111Metadata('   ')).toEqual(expectedWhiteSpace);
  });

  it('should correctly parse a simple positive and negative prompt', () => {
    const params = 'A beautiful landscape\nNegative prompt: ugly, blurry\nSteps: 20, Sampler: Euler a';
    const result = parseA1111Metadata(params);
    expect(result?.prompt).toBe('A beautiful landscape');
    expect(result?.negativePrompt).toBe('ugly, blurry');
  });

  it('should parse parameters from the last line', () => {
    const params = 'A beautiful landscape\nNegative prompt: ugly, blurry\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 12345';
    const result = parseA1111Metadata(params);
    expect(result?.steps).toBe(20);
    expect(result?.scheduler).toBe('Euler a');
    expect(result?.cfg_scale).toBe(7);
    expect(result?.seed).toBe(12345);
  });

  it('should handle missing negative prompt', () => {
    const params = 'A beautiful landscape\nSteps: 20, Sampler: Euler a';
    const result = parseA1111Metadata(params);
    expect(result?.prompt).toBe('A beautiful landscape');
    expect(result?.negativePrompt).toBeUndefined();
  });

  it('should handle extra whitespace and newlines', () => {
    const params = '\n  A beautiful landscape  \n\nNegative prompt:   ugly, blurry \n  Steps: 20, Sampler: Euler a  ';
    const result = parseA1111Metadata(params);
    expect(result?.prompt).toBe('A beautiful landscape');
    expect(result?.negativePrompt).toBe('ugly, blurry');
    expect(result?.steps).toBe(20);
  });

  it('should handle complex prompts with multiple lines', () => {
    const params = `masterpiece, best quality, 1girl, solo,
    long hair, detailed eyes,
    looking at viewer
Negative prompt: ugly, blurry, low quality
Steps: 25, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 98765, Size: 512x768`;
    const result = parseA1111Metadata(params);
    expect(result?.prompt).toBe(`masterpiece, best quality, 1girl, solo,
    long hair, detailed eyes,
    looking at viewer`);
    expect(result?.negativePrompt).toBe('ugly, blurry, low quality');
    expect(result?.width).toBe(512);
    expect(result?.height).toBe(768);
  });

  it('should handle unparseable input gracefully', () => {
    const params = 'this is not valid metadata';
    const result = parseA1111Metadata(params);
    expect(result).not.toBeNull();
    expect(result?.prompt).toBe('this is not valid metadata');
    expect(result?.steps).toBeUndefined();
  });

  it('should prioritize Model name over Model hash when both are present', () => {
    const params = 'back through time to get more rum, shipwrecked having no fun, but, heavy metal pirates we must be, so give all your beer and your rum to me!,  novuschroma38, eerie, intricate, clean, <lora:- SDXL - AI-Breaker_V3.5:.5>, <lora:CBS_novuschroma38 style:0.8>\nNegative prompt: 3d\nSteps: 15, Sampler: DPM++ SDE, Schedule type: Karras, CFG scale: 3, Seed: 980493476, Size: 816x1232, Model hash: 36fab8f31a, Model: SDXL - T - haveallsdxl_v10, CFG Rescale phi: 0, Lora hashes: "- SDXL - AI-Breaker_V3.5: 62064ee0c3ba, CBS_novuschroma38 style: 29179d2a6166", VAE Decoder: TAESD, Version: v1.9.4, Hashes: {"lora:- SDXL - AI-Breaker_V3.5": "458cc11561", "lora:CBS_novuschroma38 style": "a1c6e6cad2", "model": "36fab8f31a"}';
    const result = parseA1111Metadata(params);
    expect(result?.model).toBe('SDXL - T - haveallsdxl_v10');
    expect(result?.models).toEqual(['SDXL - T - haveallsdxl_v10']);
  });
});

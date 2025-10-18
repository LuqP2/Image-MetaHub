import { describe, it, expect } from 'vitest';
import { parseDrawThingsMetadata } from '../services/parsers/drawThingsParser';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Draw Things Parser Test Suite
 *
 * Tests cover:
 * - Basic parameter extraction from Description field
 * - JSON metadata extraction from UserComment
 * - LoRA parsing from both sources
 * - Flux model support
 */

function loadFixture(name: string): any {
  const fixturePath = path.join(__dirname, 'fixtures', 'draw-things', name);
  const content = fs.readFileSync(fixturePath, 'utf-8');
  return JSON.parse(content);
}

describe('Draw Things Parser - Flux Model Support', () => {
  it('should parse Flux model metadata with LoRAs', () => {
    const fixture = loadFixture('flux-example.json');
    const result = parseDrawThingsMetadata(fixture.parameters, fixture.userComment);

    expect(result.prompt).toContain('digital artwork in the style of ckgr');
    expect(result.prompt).toContain('Inkpunk Anime');
    expect(result.model).toBe('flux_1_dev_q5p.ckpt');
    expect(result.width).toBe(512);
    expect(result.height).toBe(768);
    expect(result.seed).toBe(1105283975);
    expect(result.steps).toBe(30);
    expect(result.cfg_scale).toBe(5);
    expect(result.sampler).toBe('DPM++ 2M AYS');
    expect(result.loras).toHaveLength(2);
    expect(result.loras).toContain('flux_faetastic_details_v1.0_lora_f16.ckpt');
    expect(result.loras).toContain('aidmamj6.1_flux_v0.5_lora_f16.ckpt');
    expect(result.generator).toBe('Draw Things');
  });

  it('should fallback to parameter parsing when JSON is unavailable', () => {
    const fixture = loadFixture('flux-example.json');
    const result = parseDrawThingsMetadata(fixture.parameters); // No userComment

    expect(result.prompt).toContain('digital artwork in the style of ckgr');
    expect(result.model).toBe('flux_1_dev_q5p.ckpt');
    expect(result.width).toBe(512);
    expect(result.height).toBe(768);
    expect(result.seed).toBe(1105283975);
    expect(result.steps).toBe(30);
    expect(result.cfg_scale).toBe(5);
    expect(result.sampler).toBe('DPM++ 2M AYS');
    expect(result.loras).toHaveLength(2);
  });
});
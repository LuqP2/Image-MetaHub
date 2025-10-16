import { describe, it, expect } from 'vitest';
import { parseFooocusMetadata } from '../services/parsers/fooocusParser';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Fooocus Parser Test Suite
 *
 * Tests cover:
 * - Basic Flux model detection
 * - Version parsing
 * - Module extraction
 * - Prompt extraction
 */

function loadFixture(name: string): any {
  const fixturePath = path.join(__dirname, 'fixtures', 'fooocus', name);
  const content = fs.readFileSync(fixturePath, 'utf-8');
  return JSON.parse(content);
}

describe('Fooocus Parser - Basic Workflows', () => {
  it('should parse basic Flux workflow', () => {
    const fixture = loadFixture('basic-flux.json');
    const result = parseFooocusMetadata(fixture);

    expect(result.prompt).toBe('The battlefield is an unimaginable hellscape');
    expect(result.generator).toBe('Fooocus');
    expect(result.model).toBe('flux1-dev-Q8_0');
    expect(result.version).toBe('f2.0.1v1.10.1-previous-543-g22e2bc3b');
    expect(result.module).toBe('ae');
  });
});
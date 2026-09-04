import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARSER_VERSION } from '../services/cacheManager';

describe('cache parser version consistency', () => {
  it('uses the shared v12 parser version in both renderer and Electron', () => {
    const electronSource = fs.readFileSync(path.resolve(process.cwd(), 'electron.mjs'), 'utf8');

    expect(PARSER_VERSION).toBe(12);
    expect(electronSource).toContain("import { PARSER_VERSION } from './utils/parserVersion.js';");
    expect(electronSource).not.toMatch(/const PARSER_VERSION\s*=/);
  });
});

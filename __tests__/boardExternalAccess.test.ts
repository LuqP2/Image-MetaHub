// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBoardExternalAccess } from '../electron/boardExternalAccess.mjs';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe('Canvas external file reads', () => {
  it('grants only the dropped file and sidecars, rather than its entire folder', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imh-659-acl-')); roots.push(root);
    for (const file of ['a.png', 'a.json', 'other.png', 'model.obj', 'texture.png', 'private.txt']) fs.writeFileSync(path.join(root, file), 'synthetic');
    const access = createBoardExternalAccess();
    expect(access.allows(path.join(root, 'a.png'))).toBe(false);
    access.authorize(path.join(root, 'a.png'));
    expect(access.allows(path.join(root, 'a.json'))).toBe(true);
    expect(access.allows(path.join(root, 'other.png'))).toBe(false);
    access.authorize(path.join(root, 'model.obj'));
    expect(access.allows(path.join(root, 'texture.png'))).toBe(true);
    expect(access.allows(path.join(root, 'private.txt'))).toBe(false);
    expect(() => access.authorize(root)).toThrow();
  });
});

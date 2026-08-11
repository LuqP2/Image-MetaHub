import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { findMediaFilesForSidecar, sidecarMatchesMediaFile } from '../services/fileWatcher.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('file watcher sidecar matching', () => {
  it('maps Image MetaHub 3D sidecars back to the complete model filename', () => {
    expect(sidecarMatchesMediaFile('cube.glb.imagemetahub.json', 'cube.glb')).toBe(true);
    expect(sidecarMatchesMediaFile('cube.glb.imagemetahub.json', 'cube.gltf')).toBe(false);
    expect(sidecarMatchesMediaFile('cube.glb.imagemetahub.json', 'cube.glb.imagemetahub')).toBe(false);
  });

  it('preserves matching for legacy media sidecars', () => {
    expect(sidecarMatchesMediaFile('image.json', 'image.png')).toBe(true);
    expect(sidecarMatchesMediaFile('image.json', 'other.png')).toBe(false);
  });

  it('finds the model after its sidecar has already been deleted', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'imh-sidecar-unlink-'));
    temporaryDirectories.push(directory);
    const modelPath = path.join(directory, 'cube.glb');
    fs.writeFileSync(modelPath, 'synthetic');

    expect(findMediaFilesForSidecar(path.join(directory, 'cube.glb.imagemetahub.json')))
      .toEqual([modelPath]);
  });
});

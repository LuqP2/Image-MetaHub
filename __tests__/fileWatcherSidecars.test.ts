import { describe, expect, it } from 'vitest';
import { sidecarMatchesMediaFile } from '../services/fileWatcher.mjs';

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
});

import { describe, expect, it } from 'vitest';
import type { IndexedImage } from '../types';
import { resolveModelTextureMaps, type ModelTextureMap } from '../utils/modelTextureMaps';

function file(path: string, textureMaps?: ModelTextureMap[], directoryId = 'root'): IndexedImage {
  return {
    id: `${directoryId}::${path}`,
    directoryId,
    name: path.split('/').at(-1),
    metadata: { normalizedMetadata: { model_3d: { format: 'glb', textureMaps } } },
  } as IndexedImage;
}

describe('3D texture map associations', () => {
  it('resolves custom sidecar names and gives explicit claims priority', () => {
    const model = file('sub/Model.glb', [{ role: 'metallic', filename: 'Other Normal.png' }]);
    const otherModel = file('sub/Other.obj');
    const map = file('sub/Other Normal.png');
    const decoy = file('sub/Model Normal.png');
    const result = resolveModelTextureMaps([model, otherModel, map, decoy]);
    expect(result.byModelId.get(model.id)).toEqual([{ image: map, role: 'metallic' }]);
    expect(result.byModelId.has(otherModel.id)).toBe(false);
    expect([...result.associatedImageIds]).toEqual([map.id]);
  });

  it('matches only full stems in the same folder and indexed root', () => {
    const model = file('sub/Robot 001.glb');
    const metallic = file('sub/robot 001-metalness.png');
    const albedo = file('sub/Robot 001_Albedo.jpg');
    const result = resolveModelTextureMaps([
      model, metallic, albedo, file('sub/Robot 001 copy Normal.png'),
      file('sub2/Robot 001 Normal.png'), file('sub/Robot 001 Texture.png', undefined, 'other'),
    ]);
    expect(result.byModelId.get(model.id)).toEqual([
      { image: metallic, role: 'metallic' }, { image: albedo, role: 'texture' },
    ]);
  });

  it('keeps ambiguous, missing, invalid, and renamed maps independent', () => {
    const model = file('Robot.glb');
    const map = file('Robot Normal.png');
    expect(resolveModelTextureMaps([model, file('Robot.obj'), map]).associatedImageIds.size).toBe(0);
    expect(resolveModelTextureMaps([file('Renamed.glb'), map]).associatedImageIds.size).toBe(0);
    expect(resolveModelTextureMaps([model, map]).associatedImageIds.has(map.id)).toBe(true);
    const declared = file('Robot.glb', [
      { role: 'normal', filename: '../Robot Normal.png' },
      { role: 'metallic', filename: 'Missing.png' },
    ]);
    expect(resolveModelTextureMaps([declared, map]).associatedImageIds.size).toBe(0);
  });

  it('recognizes numbered Saver names with a trailing underscore', () => {
    const model = file('ComfyUI_00001_.glb');
    const map = file('ComfyUI_00001_ Normal.png');
    expect(resolveModelTextureMaps([model, map]).byModelId.get(model.id)).toEqual([{ image: map, role: 'normal' }]);
    expect(resolveModelTextureMaps([model, file('ComfyUI_00001.obj'), map]).associatedImageIds.size).toBe(0);
  });
});

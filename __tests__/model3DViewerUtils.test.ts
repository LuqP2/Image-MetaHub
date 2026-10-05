import { describe, expect, it, vi } from 'vitest';
import {
  combineObjMaterialLibraries,
  embedMetadataInGlb,
  extractObjMaterialLibraries,
  getModel3DExportMetadataPayload,
  retainRuntimeUnlessOwned,
  resolveModel3DResourceUrl,
  safeModel3DAssetPath,
} from '../components/Model3DViewer';

const encodeMinimalGlb = (paddingByte = 0x20): ArrayBuffer => {
  const encoded = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' } }));
  const paddedLength = Math.ceil(encoded.byteLength / 4) * 4;
  const result = new Uint8Array(20 + paddedLength);
  result.set(new TextEncoder().encode('glTF'), 0);
  const view = new DataView(result.buffer);
  view.setUint32(4, 2, true);
  view.setUint32(8, result.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  result.set(encoded, 20);
  result.fill(paddingByte, 20 + encoded.byteLength);
  return result.buffer;
};

describe('3D viewer utilities', () => {
  it('does not let stale cleanup clear the newly selected model runtime', () => {
    const previousRuntime = { id: 'previous' };
    const activeRuntime = { id: 'active' };

    expect(retainRuntimeUnlessOwned(activeRuntime, previousRuntime)).toBe(activeRuntime);
    expect(retainRuntimeUnlessOwned(activeRuntime, activeRuntime)).toBeNull();
  });

  it('resolves sibling resources within the indexed root', () => {
    expect(safeModel3DAssetPath('D:\\Library', 'models/cube.gltf', 'textures/albedo.png'))
      .toBe('D:\\Library\\models\\textures\\albedo.png');
    expect(safeModel3DAssetPath('/home/user/Library', 'models/cube.gltf', 'textures/albedo.png'))
      .toBe('/home/user/Library/models/textures/albedo.png');
    expect(safeModel3DAssetPath('D:\\Library', 'models/vehicle/cube.gltf', '../textures/albedo.png'))
      .toBe('D:\\Library\\models\\textures\\albedo.png');
    expect(safeModel3DAssetPath('/home/user/Library', 'models/vehicle/cube.gltf', '../materials/body.mtl'))
      .toBe('/home/user/Library/models/materials/body.mtl');
  });

  it('blocks traversal, absolute paths, and external URLs', () => {
    expect(safeModel3DAssetPath('D:\\Library', 'cube.gltf', '../secret.png')).toBeNull();
    expect(safeModel3DAssetPath('D:\\Library', 'models/cube.gltf', '../../secret.png')).toBeNull();
    expect(safeModel3DAssetPath('D:\\Library', '../cube.gltf', 'texture.png')).toBeNull();
    expect(safeModel3DAssetPath('D:\\Library', 'models/cube.gltf', 'C:\\secret.png')).toBeNull();
    expect(safeModel3DAssetPath('D:\\Library', 'models/cube.gltf', 'https://example.com/texture.png')).toBeNull();
  });

  it('allows embedded and rooted resources while blocking remote dependencies', () => {
    const sourceUrl = 'imh-media://local/?path=model';
    expect(resolveModel3DResourceUrl('D:\\Library', 'models/cube.gltf', sourceUrl, sourceUrl)).toBe(sourceUrl);
    expect(resolveModel3DResourceUrl('D:\\Library', 'models/cube.gltf', sourceUrl, 'data:image/png;base64,AA=='))
      .toBe('data:image/png;base64,AA==');
    expect(resolveModel3DResourceUrl('D:\\Library', 'models/cube.gltf', sourceUrl, 'textures/albedo.png'))
      .toBe('imh-media://local/?path=D%3A%5CLibrary%5Cmodels%5Ctextures%5Calbedo.png');
    expect(resolveModel3DResourceUrl('D:\\Library', 'models/cube.gltf', sourceUrl, 'https://example.com/albedo.png'))
      .toBeNull();
    expect(resolveModel3DResourceUrl('D:\\Library', 'models/cube.gltf', sourceUrl, 'imh-media://local/?path=C%3A%5Csecret.png'))
      .toBeNull();
    expect(resolveModel3DResourceUrl(undefined, 'models/cube.gltf', sourceUrl, 'textures/albedo.png'))
      .toBeNull();
  });

  it('reads material libraries declared by OBJ files', () => {
    expect(extractObjMaterialLibraries([
      '# synthetic fixture',
      'mtllib materials.mtl',
      'mtllib "nested/paint set.mtl"',
      'mtllib materials.mtl # duplicate',
    ].join('\n'))).toEqual(['materials.mtl', 'nested/paint set.mtl']);
  });

  it('uses materials from every declared OBJ library without losing their creators', () => {
    const firstCreate = vi.fn((name: string) => `first:${name}`);
    const secondCreate = vi.fn((name: string) => `second:${name}`);
    const combined = combineObjMaterialLibraries([
      { materialsInfo: { body: {}, shared: {} }, create: firstCreate },
      { materialsInfo: { paint: {}, shared: {} }, create: secondCreate },
    ]);

    expect(combined.create('body')).toBe('first:body');
    expect(combined.create('paint')).toBe('second:paint');
    expect(combined.create('shared')).toBe('second:shared');
    expect(combined.create('missing')).toBeUndefined();
    expect(firstCreate).toHaveBeenCalledOnce();
    expect(secondCreate).toHaveBeenCalledTimes(2);
  });

  it('embeds Image MetaHub metadata while keeping a valid GLB header', () => {
    const payload = { schema_version: 1, media_type: 'model3d', prompt: 'synthetic' };
    const output = embedMetadataInGlb(encodeMinimalGlb(0x00), payload);
    const view = new DataView(output);
    const jsonLength = view.getUint32(12, true);
    const document = JSON.parse(new TextDecoder().decode(output.slice(20, 20 + jsonLength)).trim());

    expect(new TextDecoder().decode(output.slice(0, 4))).toBe('glTF');
    expect(view.getUint32(8, true)).toBe(output.byteLength);
    expect(document.asset.extras.imagemetahub_data).toEqual(payload);
  });

  it('retains raw ComfyUI workflow graphs in the export payload', () => {
    const payload = getModel3DExportMetadataPayload({
      metadata: {
        normalizedMetadata: {
          generator: 'ComfyUI',
          prompt: 'curated positive prompt',
        },
        workflow: JSON.stringify({ nodes: [{ id: 1, type: 'LoadImage' }] }),
        prompt: { '1': { class_type: 'LoadImage', inputs: { image: 'source.png' } } },
      } as unknown as import('../types').IndexedImage['metadata'],
    });

    expect(payload.prompt).toBe('curated positive prompt');
    expect(payload.workflow).toEqual({ nodes: [{ id: 1, type: 'LoadImage' }] });
    expect(payload.prompt_api).toEqual({
      '1': { class_type: 'LoadImage', inputs: { image: 'source.png' } },
    });
  });

  it('maps normalized sampling fields to the exported metadata schema', () => {
    const payload = getModel3DExportMetadataPayload({
      metadata: {
        normalizedMetadata: {
          cfgScale: 6.5,
          sampler: 'euler_ancestral',
        },
      } as unknown as import('../types').IndexedImage['metadata'],
    });

    expect(payload.cfg).toBe(6.5);
    expect(payload.sampler_name).toBe('euler_ancestral');
  });
});

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import {
  combineObjMaterialLibraries,
  embedMetadataInGlb,
  extractObjMaterialLibraries,
  getModel3DExportMetadataPayload,
  getVirtualResourceDirectory,
  resolveModel3DResourceUrl,
  resolveObjMaterialLibraryUrl,
  retainRuntimeUnlessOwned,
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

  it('preserves board authorization for OBJ material libraries and nested MTL textures', async () => {
    const directoryPath = 'D:\\External\\AssetPack';
    const relativeModelPath = 'props/crate.obj';
    const boardId = 'board-alpha';
    const sourceUrl = `imh-board-media://local/?${new URLSearchParams({
      boardId,
      path: 'D:\\External\\AssetPack\\props\\crate.obj',
    }).toString()}`;

    const materialUrl = resolveObjMaterialLibraryUrl(
      directoryPath,
      relativeModelPath,
      sourceUrl,
      'materials/crate.mtl',
      boardId,
    );
    expect(materialUrl).toBe(
      `imh-board-media://local/?${new URLSearchParams({
        boardId,
        path: 'D:\\External\\AssetPack\\props\\materials\\crate.mtl',
      }).toString()}`,
    );

    // Even when the primary model fell back to a blob URL, explicitBoardId keeps MTL & textures board-scoped.
    expect(
      resolveObjMaterialLibraryUrl(directoryPath, relativeModelPath, 'blob:https://local/crate', 'materials/crate.mtl', boardId),
    ).toBe(materialUrl);
    expect(
      resolveObjMaterialLibraryUrl(directoryPath, relativeModelPath, sourceUrl, '../../outside.mtl', boardId),
    ).toBeNull();
    expect(
      resolveObjMaterialLibraryUrl(directoryPath, relativeModelPath, sourceUrl, 'data:text/plain;base64,AA==', boardId),
    ).toBeNull();

    // Verify full LoadingManager + MTLLoader + OBJLoader pipeline uses imh-board-media for both MTL and textures.
    const requestedUrls: string[] = [];
    const trustedLocalResourceUrls = new Set([sourceUrl, materialUrl!]);
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (trustedLocalResourceUrls.has(url)) {
        requestedUrls.push(url);
        return url;
      }
      const resolved = resolveModel3DResourceUrl(directoryPath, relativeModelPath, sourceUrl, url, boardId);
      if (!resolved) throw new Error(`Blocked: ${url}`);
      requestedUrls.push(resolved);
      return resolved;
    });

    const fileLoadSpy = vi.spyOn(THREE.FileLoader.prototype, 'load').mockImplementation(function (url, onLoad) {
      const resolved = manager.resolveURL(url);
      queueMicrotask(() => {
        onLoad?.([
          'newmtl CrateWood',
          'Kd 0.8 0.6 0.4',
          'map_Kd ../textures/wood_albedo.png',
        ].join('\n'));
      });
      return resolved as unknown as ReturnType<typeof THREE.FileLoader.prototype.load>;
    });
    const textureLoadSpy = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(function (url, onLoad) {
      manager.resolveURL(url);
      const texture = new THREE.Texture();
      queueMicrotask(() => onLoad?.(texture));
      return texture;
    });

    try {
      const mtlLoader = new MTLLoader(manager);
      mtlLoader.setResourcePath(getVirtualResourceDirectory('materials/crate.mtl', boardId));
      const materials = await mtlLoader.loadAsync(materialUrl!);
      materials.preload();

      const objLoader = new OBJLoader(manager);
      objLoader.setMaterials(materials);
      const model = objLoader.parse([
        'mtllib materials/crate.mtl',
        'usemtl CrateWood',
        'v 0 0 0',
        'v 1 0 0',
        'v 0 1 0',
        'f 1 2 3',
      ].join('\n'));

      const expectedTextureUrl = `imh-board-media://local/?${new URLSearchParams({
        boardId,
        path: 'D:\\External\\AssetPack\\props\\textures\\wood_albedo.png',
      }).toString()}`;
      expect(requestedUrls).toEqual([materialUrl, expectedTextureUrl]);
      expect(requestedUrls.every((url) => url.startsWith('imh-board-media://local/?'))).toBe(true);

      const mesh = model.children[0] as THREE.Mesh;
      const material = mesh.material as THREE.MeshPhongMaterial;
      expect(material.name).toBe('CrateWood');
      expect(material.map).toBeInstanceOf(THREE.Texture);
    } finally {
      fileLoadSpy.mockRestore();
      textureLoadSpy.mockRestore();
    }
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

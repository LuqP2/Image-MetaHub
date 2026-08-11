import { describe, expect, it } from 'vitest';
import { embedMetadataInGlb, safeModel3DAssetPath } from '../components/Model3DViewer';

const encodeMinimalGlb = (): ArrayBuffer => {
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
  result.fill(0x20, 20 + encoded.byteLength);
  return result.buffer;
};

describe('3D viewer utilities', () => {
  it('resolves sibling resources within the indexed root', () => {
    expect(safeModel3DAssetPath('D:\\Library', 'models/cube.gltf', 'textures/albedo.png'))
      .toBe('D:\\Library\\models\\textures\\albedo.png');
    expect(safeModel3DAssetPath('/home/user/Library', 'models/cube.gltf', 'textures/albedo.png'))
      .toBe('/home/user/Library/models/textures/albedo.png');
  });

  it('blocks traversal, absolute paths, and external URLs', () => {
    expect(safeModel3DAssetPath('D:\\Library', 'models/cube.gltf', '../secret.png')).toBeNull();
    expect(safeModel3DAssetPath('D:\\Library', '../cube.gltf', 'texture.png')).toBeNull();
    expect(safeModel3DAssetPath('D:\\Library', 'models/cube.gltf', 'C:\\secret.png')).toBeNull();
    expect(safeModel3DAssetPath('D:\\Library', 'models/cube.gltf', 'https://example.com/texture.png')).toBeNull();
  });

  it('embeds Image MetaHub metadata while keeping a valid GLB header', () => {
    const payload = { schema_version: 1, media_type: 'model3d', prompt: 'synthetic' };
    const output = embedMetadataInGlb(encodeMinimalGlb(), payload);
    const view = new DataView(output);
    const jsonLength = view.getUint32(12, true);
    const document = JSON.parse(new TextDecoder().decode(output.slice(20, 20 + jsonLength)).trim());

    expect(new TextDecoder().decode(output.slice(0, 4))).toBe('glTF');
    expect(view.getUint32(8, true)).toBe(output.byteLength);
    expect(document.asset.extras.imagemetahub_data).toEqual(payload);
  });
});

import { describe, expect, it } from 'vitest';
import { buildNormalizedMetadataFromMetaHubChunk, parseModel3DMetadataFromBuffer } from '../services/fileIndexer';

const encodeGlb = (document: Record<string, unknown>): ArrayBuffer => {
  const encoded = new TextEncoder().encode(JSON.stringify(document));
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

describe('3D metadata parsing', () => {
  it('prefers the Image MetaHub payload nested in GLB asset extras', () => {
    const parsed = parseModel3DMetadataFromBuffer(encodeGlb({
      asset: {
        version: '2.0',
        extras: {
          prompt: '{"legacy":true}',
          imagemetahub_data: {
            schema_version: 1,
            media_type: 'model3d',
            prompt: 'synthetic prompt',
            model_3d: { format: 'glb', vertexCount: 8, faceCount: 12 },
          },
        },
      },
    }), '.glb');

    expect(parsed?.imagemetahub_data?.prompt).toBe('synthetic prompt');
    expect(parsed?.imagemetahub_data?.model_3d).toEqual({ format: 'glb', vertexCount: 8, faceCount: 12 });
  });

  it('preserves 3D details when the embedded payload has no generator marker', async () => {
    const model3D = {
      format: 'glb',
      vertexCount: 24576,
      faceCount: 49152,
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    };
    const normalized = await buildNormalizedMetadataFromMetaHubChunk({
      schema_version: 1,
      media_type: 'model3d',
      model_3d: model3D,
    });

    expect(normalized.media_type).toBe('model3d');
    expect(normalized.model_3d).toEqual(model3D);
  });

  it('accepts official Save 3D Model extras when no MetaHub payload exists', () => {
    const parsed = parseModel3DMetadataFromBuffer(encodeGlb({
      asset: {
        version: '2.0',
        extras: {
          prompt: JSON.stringify({ '1': { class_type: 'SyntheticGenerator', inputs: {} } }),
          workflow: JSON.stringify({ nodes: [] }),
        },
      },
    }), '.glb');

    expect(parsed?.prompt).toBeDefined();
    expect(parsed?.workflow).toBeDefined();
  });

  it('rejects malformed or oversized metadata without scanning geometry', () => {
    expect(parseModel3DMetadataFromBuffer(new ArrayBuffer(12), '.glb')).toBeNull();
    expect(parseModel3DMetadataFromBuffer(new ArrayBuffer(16 * 1024 * 1024 + 21), '.glb')).toBeNull();
  });

  it('does not parse GLTF geometry-bearing JSON without a sidecar', () => {
    const document = {
      asset: {
        version: '2.0',
        extras: { imagemetahub_data: { schema_version: 1, media_type: 'model3d', model_3d: { format: 'gltf' } } },
      },
    };
    const parsed = parseModel3DMetadataFromBuffer(new TextEncoder().encode(JSON.stringify(document)).buffer, '.gltf');
    expect(parsed).toBeNull();
  });
});

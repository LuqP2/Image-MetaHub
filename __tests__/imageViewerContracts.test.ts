import { describe, expect, it } from 'vitest';
import {
  fromImageViewerMaskFileDTO,
  resolveEffectiveImageViewerHost,
  toImageModalImageDTO,
  toImageViewerMaskFileDTO,
} from '../services/imageViewerContracts';
import type { IndexedImage } from '../types';

const makeImage = (): IndexedImage => ({
  id: 'directory::neutral.png',
  name: 'neutral.png',
  handle: { kind: 'file', name: 'neutral.png' } as FileSystemFileHandle,
  thumbnailHandle: { kind: 'file', name: 'neutral.webp' } as FileSystemFileHandle,
  thumbnailUrl: 'blob:renderer-owned',
  metadata: { normalizedMetadata: { generator: 'Unknown' }, workflow: { large: true } },
  metadataString: 'large raw metadata',
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
  directoryId: 'directory',
});

describe('image viewer contracts', () => {
  it('forces inline without the desktop bridge', () => {
    expect(resolveEffectiveImageViewerHost('detached', false)).toBe('inline');
    expect(resolveEffectiveImageViewerHost('inline', true)).toBe('inline');
    expect(resolveEffectiveImageViewerHost('detached', true)).toBe('detached');
  });

  it('removes non-clonable handles and renderer-owned blob URLs', () => {
    const dto = toImageModalImageDTO(makeImage());
    expect(dto).not.toHaveProperty('handle');
    expect(dto).not.toHaveProperty('thumbnailHandle');
    expect(dto).not.toHaveProperty('thumbnailUrl');
    expect(dto.metadata).not.toHaveProperty('workflow');
    expect(dto.metadataString).toBe('');
    expect((dto.metadata as Record<string, unknown>)._rawMetadataCompacted).toBe(true);
    expect(dto.id).toBe('directory::neutral.png');
  });

  it('preserves compacted raw keys and the provenance source marker', () => {
    const image = makeImage();
    image.metadata = {
      normalizedMetadata: { generator: 'Easy Diffusion' },
      _rawMetadataCompacted: true,
      _rawMetadataKeys: ['imagemetahub_data', 'workflow'],
      _provenanceMetadataSource: 'sidecar',
    } as IndexedImage['metadata'];

    const metadata = toImageModalImageDTO(image).metadata as Record<string, unknown>;
    expect(metadata._rawMetadataKeys).toEqual(expect.arrayContaining([
      'imagemetahub_data',
      'workflow',
      '_provenanceMetadataSource',
    ]));
    expect(metadata._provenanceMetadataSource).toBe('sidecar');
  });

  // Generation is executed by the main renderer, so the inpainting mask has to
  // survive structured cloning: a raw File would not make it across IPC.
  it('round-trips an inpainting mask through a clonable payload', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    // jsdom's Blob has no arrayBuffer(); Chromium (the only place this runs) does.
    const mask = {
      name: 'mask.png',
      type: 'image/png',
      arrayBuffer: async () => bytes.buffer,
    } as unknown as File;

    const dto = await toImageViewerMaskFileDTO(mask);
    expect(dto).not.toBeNull();
    expect(dto?.name).toBe('mask.png');
    expect(dto?.type).toBe('image/png');
    expect(new Uint8Array(dto!.data)).toEqual(bytes);

    const restored = fromImageViewerMaskFileDTO(dto);
    expect(restored).toBeInstanceOf(File);
    expect(restored?.name).toBe('mask.png');
    expect(restored?.type).toBe('image/png');
    expect(restored?.size).toBe(bytes.byteLength);
  });

  it('treats a missing mask as no mask in both directions', async () => {
    expect(await toImageViewerMaskFileDTO(null)).toBeNull();
    expect(await toImageViewerMaskFileDTO(undefined)).toBeNull();
    expect(fromImageViewerMaskFileDTO(null)).toBeNull();
    expect(fromImageViewerMaskFileDTO(undefined)).toBeNull();
  });
});

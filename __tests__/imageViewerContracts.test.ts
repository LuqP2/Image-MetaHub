import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveImageViewerHost,
  toImageModalImageDTO,
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
});

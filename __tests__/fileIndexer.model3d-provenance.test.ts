import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IndexedImage } from '../types';

const originalElectronApi = window.electronAPI;

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: originalElectronApi,
  });
});

describe('3D metadata provenance', () => {
  it('records metadata returned from a model sidecar before normalization', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        joinPaths: vi.fn().mockResolvedValue({ success: true, path: 'D:\\library\\model.glb' }),
        readModel3DMetadata: vi.fn().mockResolvedValue({
          success: true,
          source: 'sidecar',
          metadata: {
            imagemetahub_data: {
              schema_version: 1,
              media_type: 'model3d',
              generator: 'Image MetaHub',
              prompt: 'a small sculpture',
              model: 'trellis',
              model_3d: { format: 'glb' },
            },
          },
        }),
        getFileStats: vi.fn().mockResolvedValue({
          success: true,
          stats: { mtimeMs: 1, size: 256 },
        }),
      },
    });
    vi.resetModules();
    const { reparseIndexedImage } = await import('../services/fileIndexer');
    const image: IndexedImage = {
      id: 'library::model.glb',
      name: 'model.glb',
      metadata: {},
      metadataString: '',
      lastModified: 1,
      models: [],
      loras: [],
      scheduler: '',
      directoryId: 'library',
      fileType: 'model/gltf-binary',
    };

    const reparsed = await reparseIndexedImage(image, 'D:\\library', { compactRawMetadata: false });

    expect(reparsed?.metadata).toMatchObject({
      _provenanceMetadataSource: 'sidecar',
      imagemetahub_data: { generator: 'Image MetaHub' },
    });
  });
});

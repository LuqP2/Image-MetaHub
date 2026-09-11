import { afterEach, describe, expect, it } from 'vitest';
import type { IndexedImage, ShadowMetadata } from '../types';
import { buildSavedPromptSource, composeSavedPromptInput } from '../hooks/useSavePrompt';

const image = (overrides: Partial<IndexedImage> = {}): IndexedImage => ({
  id: 'directory::nested/image.png',
  name: 'image.png',
  handle: {} as FileSystemFileHandle,
  metadata: { normalizedMetadata: { prompt: 'original positive', negativePrompt: 'original negative' } } as IndexedImage['metadata'],
  metadataString: '',
  lastModified: 10,
  contentModifiedMs: 9,
  fileSize: 8,
  models: [],
  loras: [],
  scheduler: '',
  directoryId: 'directory',
  ...overrides,
});

describe('saved prompt composition', () => {
  afterEach(() => { delete window.electronAPI; });

  it('captures effective shadow text literally and defaults a missing negative to empty', () => {
    const shadow = { imageId: 'directory::nested/image.png', prompt: '  shadow\npositive  ', negativePrompt: '', updatedAt: 1 } as ShadowMetadata;
    expect(composeSavedPromptInput(image(), shadow, null, false)).toEqual({
      positivePrompt: '  shadow\npositive  ',
      negativePrompt: '',
      textBasis: 'effective',
      source: null,
      sourceCreatedAt: 10,
    });
  });

  it('captures the displayed original instead of shadow metadata', () => {
    const shadow = { imageId: 'directory::nested/image.png', prompt: 'edited', updatedAt: 1 } as ShadowMetadata;
    expect(composeSavedPromptInput(image(), shadow, null, true)).toMatchObject({
      positivePrompt: 'original positive',
      negativePrompt: 'original negative',
      textBasis: 'original',
      sourceCreatedAt: 10,
    });
  });

  it('stores no source creation timestamp when the image date is invalid', () => {
    expect(composeSavedPromptInput(image({ lastModified: 0 }), null)).toMatchObject({ sourceCreatedAt: null });
  });

  it('uses trim only to reject an empty positive prompt', () => {
    const target = image({ metadata: { normalizedMetadata: { prompt: ' \n ', negativePrompt: 'kept' } } as IndexedImage['metadata'] });
    expect(() => composeSavedPromptInput(target, null)).toThrow('no positive prompt');
  });

  it('creates stable source only with the complete identity set and otherwise uses path', () => {
    window.electronAPI = {} as never;
    const base = image();
    expect(buildSavedPromptSource(base, 'D:\\Library')).toMatchObject({ kind: 'path' });
    expect(buildSavedPromptSource(image({
      assetId: 'asset', revisionId: 'revision', provenanceLocationId: 'location', provenanceRootId: 'root',
    }), 'D:\\Library')).toEqual({
      kind: 'stable',
      reference: { assetId: 'asset', revisionId: 'revision', locationId: 'location', rootId: 'root' },
      pathAtSave: {
        directoryPath: 'D:\\Library', relativePath: 'nested/image.png', fileSize: 8, contentModifiedMs: 9,
      },
    });
  });
});

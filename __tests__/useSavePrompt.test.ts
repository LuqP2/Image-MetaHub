import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { IndexedImage, ShadowMetadata } from '../types';
import { buildSavedPromptSource, composeSavedPromptInput, useIsPromptSaved } from '../hooks/useSavePrompt';
import { useSavedPromptStore } from '../store/useSavedPromptStore';

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
  afterEach(() => {
    delete window.electronAPI;
    useSavedPromptStore.setState({ prompts: [] });
  });

  it('captures effective shadow text literally and defaults a missing negative to empty', () => {
    const shadow = { imageId: 'directory::nested/image.png', prompt: '  shadow\npositive  ', negativePrompt: '', updatedAt: 1 } as ShadowMetadata;
    expect(composeSavedPromptInput(image(), shadow, null, false)).toMatchObject({
      positivePrompt: '  shadow\npositive  ',
      negativePrompt: '',
      textBasis: 'effective',
      source: null,
      sourceCreatedAt: 10,
    });
  });

  it('saves text supplied only by shadow metadata when embedded text is empty', () => {
    const target = image({ metadata: { normalizedMetadata: { prompt: '', negativePrompt: '' } } as IndexedImage['metadata'] });
    expect(composeSavedPromptInput(target, { imageId: target.id, prompt: 'shadow-only text', updatedAt: 1 } as ShadowMetadata)).toMatchObject({ positivePrompt: 'shadow-only text', textBasis: 'effective' });
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

  it('accepts negative-only text but rejects two empty channels', () => {
    const target = image({ metadata: { normalizedMetadata: { prompt: ' \n ', negativePrompt: 'kept' } } as IndexedImage['metadata'] });
    expect(composeSavedPromptInput(target, null)).toMatchObject({ positivePrompt: ' \n ', negativePrompt: 'kept' });
    expect(() => composeSavedPromptInput(image({ metadata: { normalizedMetadata: { prompt: ' ', negativePrompt: '\n' } } as IndexedImage['metadata'] }), null)).toThrow('no prompt');
  });

  it('preserves shadow edits and source metadata for a negative-only prompt', () => {
    window.electronAPI = {} as never;
    const target = image({ metadata: { normalizedMetadata: { prompt: '', negativePrompt: 'original', model: 'Original model', sampler: 'Euler', scheduler: 'normal', generator: 'ComfyUI', loras: [{ name: 'light' }] } } as IndexedImage['metadata'] });
    const shadow = { imageId: target.id, negativePrompt: '  edited negative  ', model: 'Edited model', updatedAt: 1 } as ShadowMetadata;
    expect(composeSavedPromptInput(target, shadow, 'D:/synthetic')).toMatchObject({ positivePrompt: '', negativePrompt: '  edited negative  ', textBasis: 'effective', sourceCreatedAt: 10, source: { kind: 'path' }, editor: { metadata: { model: 'Edited model', sampler: 'Euler', scheduler: 'normal', generator: 'ComfyUI', loras: ['light'] } } });
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

  it('reports a saved state only for the exact positive and negative prompt pair', () => {
    useSavedPromptStore.setState({
      prompts: [{
        id: 'saved-prompt',
        createdAt: 1,
        sourceCreatedAt: null,
        positivePrompt: '  exact prompt  ',
        negativePrompt: 'exact negative',
        textBasis: 'effective',
        source: null,
      }],
    });

    const { result, rerender } = renderHook(
      ({ positive, negative }) => useIsPromptSaved(positive, negative),
      { initialProps: { positive: '  exact prompt  ', negative: 'exact negative' } },
    );
    expect(result.current).toBe(true);
    rerender({ positive: 'exact prompt', negative: 'exact negative' });
    expect(result.current).toBe(false);
  });
});

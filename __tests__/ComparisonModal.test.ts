import { describe, expect, it } from 'vitest';
import { getComparisonMetadataReference } from '../components/ComparisonModal';
import type { IndexedImage } from '../types';

const createImage = (id: string, prompt: string): IndexedImage => ({
  id,
  name: `${id}.png`,
  handle: {} as FileSystemFileHandle,
  metadata: {
    normalizedMetadata: {
      prompt,
    },
  } as any,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  sampler: '',
  scheduler: '',
  directoryId: 'dir-1',
});

describe('getComparisonMetadataReference', () => {
  it('uses the other image as the diff reference in two-image mode', () => {
    const first = createImage('img-1', 'first prompt');
    const second = createImage('img-2', 'second prompt');

    expect(getComparisonMetadataReference([first, second], 0, first.metadata!.normalizedMetadata!)).toEqual(
      second.metadata!.normalizedMetadata
    );
    expect(getComparisonMetadataReference([first, second], 1, first.metadata!.normalizedMetadata!)).toEqual(
      first.metadata!.normalizedMetadata
    );
  });

  it('keeps image 1 as the reference when comparing more than two images', () => {
    const first = createImage('img-1', 'first prompt');
    const second = createImage('img-2', 'second prompt');
    const third = createImage('img-3', 'third prompt');

    expect(getComparisonMetadataReference([first, second, third], 0, first.metadata!.normalizedMetadata!)).toBeNull();
    expect(getComparisonMetadataReference([first, second, third], 2, first.metadata!.normalizedMetadata!)).toEqual(
      first.metadata!.normalizedMetadata
    );
  });
});

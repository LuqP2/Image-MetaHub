import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ImageLineageSection from '../components/ImageLineageSection';
import type { IndexedImage } from '../types';

const mocks = vi.hoisted(() => {
  const source = { id: 'source', name: 'source.png' };
  const resolved = { sourceImageId: source.id, generationType: 'img2img', lineage: {} };
  return {
    source,
    store: {
      images: [source],
      filteredImages: [],
      lineageResolvedByImageId: { derived: resolved },
      lineageDerivedIdsBySourceId: {},
      lineageBuildState: {},
      getResolvedLineage: () => resolved,
      getDerivedImages: () => [],
    },
    subscribe: vi.fn(),
    getResolvedState: vi.fn(),
    loadIndexedThumbnail: vi.fn(),
  };
});

vi.mock('../store/useImageStore', () => ({
  useImageStore: (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store),
}));

vi.mock('../services/thumbnailManager', () => ({
  thumbnailManager: {
    subscribe: mocks.subscribe,
    getResolvedState: mocks.getResolvedState,
    loadIndexedThumbnail: mocks.loadIndexedThumbnail,
  },
}));

it('loads and displays an indexed lineage thumbnail for a record without a URL or handle', async () => {
  let notify = () => {};
  mocks.subscribe.mockImplementation((_imageId, listener) => {
    notify = listener;
    return () => undefined;
  });
  mocks.getResolvedState.mockReturnValue(null);
  mocks.loadIndexedThumbnail.mockImplementation(async () => {
    mocks.getResolvedState.mockReturnValue({ thumbnailUrl: 'imh-thumb://cached/source.webp' });
    notify();
  });

  render(<ImageLineageSection image={{ id: 'derived' } as IndexedImage} onOpenImage={vi.fn()} />);

  const thumbnail = await screen.findByRole('img', { name: 'source.png' });
  expect(thumbnail.getAttribute('src')).toBe('imh-thumb://cached/source.webp');
  expect(mocks.loadIndexedThumbnail).toHaveBeenCalledWith(mocks.source);
});

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ExploreWorkspace from '../components/ExploreWorkspace';
import { useImageStore } from '../store/useImageStore';

vi.mock('../hooks/useThumbnail', () => ({ useThumbnail: () => undefined }));
vi.mock('../hooks/useResolvedThumbnail', () => ({
  useResolvedThumbnail: (image: any) => ({ thumbnailStatus: 'ready', thumbnailUrl: image?.thumbnailUrl ?? '' }),
}));

const seed = () => {
  useImageStore.getState().resetState();
  useImageStore.setState({
    images: [
      { id: 'img-1', name: 'a.png', thumbnailUrl: 'thumb://a', directoryId: 'dir-1', models: ['SDXL'] } as any,
      { id: 'img-2', name: 'b.png', thumbnailUrl: 'thumb://b', directoryId: 'dir-1', models: ['SDXL'] } as any,
      { id: 'img-3', name: 'c.png', thumbnailUrl: 'thumb://c', directoryId: 'dir-1', models: ['Flux'] } as any,
    ],
    collections: [
      {
        id: 'collection-1',
        kind: 'manual',
        name: 'My Collection',
        sortIndex: 0,
        imageIds: ['img-1'],
        snapshotImageIds: [],
        imageCount: 1,
        createdAt: 1,
        updatedAt: 1,
      } as any,
    ],
    clusters: [],
  });
};

afterEach(() => cleanup());
beforeEach(() => seed());

describe('ExploreWorkspace', () => {
  it('renders model cards in the default Models dimension', () => {
    render(<ExploreWorkspace onNavigateToLibrary={() => undefined} />);
    expect(screen.getByText('SDXL')).toBeTruthy();
    expect(screen.getByText('Flux')).toBeTruthy();
  });

  it('drilling into a model sets the scope and navigates to the Library', () => {
    const onNavigate = vi.fn();
    render(<ExploreWorkspace onNavigateToLibrary={onNavigate} />);

    fireEvent.click(screen.getByText('SDXL').closest('button')!);

    expect(useImageStore.getState().activeImageScope).toEqual({ type: 'model', id: 'SDXL', label: 'SDXL' });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('switches to the Collections dimension and drills into a collection', () => {
    const onNavigate = vi.fn();
    render(<ExploreWorkspace onNavigateToLibrary={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /Collections/i }));
    const card = screen.getByLabelText('Open collection My Collection');
    fireEvent.click(card);

    expect(useImageStore.getState().activeImageScope).toEqual({
      type: 'collection',
      id: 'collection-1',
      label: 'My Collection',
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('shows a Generate clusters CTA in the empty Clusters dimension', () => {
    render(<ExploreWorkspace onNavigateToLibrary={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /^Clusters$/i }));
    expect(screen.getByText('No clusters yet')).toBeTruthy();
    expect(screen.getAllByText('Generate clusters').length).toBeGreaterThan(0);
  });
});

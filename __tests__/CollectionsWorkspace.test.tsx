import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CollectionsWorkspace from '../components/CollectionsWorkspace';
import { useImageStore } from '../store/useImageStore';

vi.mock('../hooks/useThumbnail', () => ({
  useThumbnail: () => undefined,
}));

vi.mock('../hooks/useResolvedThumbnail', () => ({
  useResolvedThumbnail: (image: any) => ({
    thumbnailUrl: image?.thumbnailUrl ?? '',
  }),
}));

describe('CollectionsWorkspace', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
    useImageStore.setState({
      images: [
        {
          id: 'img-1',
          name: 'car-1.png',
          thumbnailUrl: 'thumb://car-1',
          directoryId: 'dir-1',
          tags: ['carros'],
        } as any,
        {
          id: 'img-2',
          name: 'car-2.png',
          thumbnailUrl: 'thumb://car-2',
          directoryId: 'dir-1',
          tags: ['carros'],
        } as any,
        {
          id: 'img-3',
          name: 'bike-1.png',
          thumbnailUrl: 'thumb://bike-1',
          directoryId: 'dir-2',
          tags: ['motos'],
        } as any,
      ],
      collections: [
        {
          id: 'collection-1',
          kind: 'manual',
          name: 'Carros',
          sortIndex: 0,
          imageIds: ['img-1', 'img-2'],
          snapshotImageIds: [],
          imageCount: 2,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'collection-2',
          kind: 'tag_rule',
          name: 'Motos',
          sortIndex: 1,
          imageIds: ['img-3'],
          sourceTag: 'motos',
          autoUpdate: true,
          snapshotImageIds: [],
          imageCount: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeCollectionId: null,
      createCollection: vi.fn().mockResolvedValue(undefined),
      updateCollection: vi.fn().mockResolvedValue(undefined),
      deleteCollectionById: vi.fn().mockResolvedValue(undefined),
      reorderCollections: vi.fn().mockResolvedValue(undefined),
      getResolvedCollectionImages: (collectionId: string) => {
        const state = useImageStore.getState();
        const collection = state.collections.find((entry) => entry.id === collectionId);
        if (!collection) {
          return [];
        }

        const ids =
          collection.id === 'collection-1'
            ? ['img-1', 'img-2']
            : ['img-3'];

        return state.images.filter((image) => ids.includes(image.id));
      },
      setActiveCollectionId: useImageStore.getState().setActiveCollectionId,
    } as any);
  });

  it('shows the collection card browser when no collection is selected', () => {
    render(
      <CollectionsWorkspace filteredImages={[]} totalImages={[]}>
        <div>Collection Detail</div>
      </CollectionsWorkspace>,
    );

    expect(screen.getByRole('button', { name: 'Open collection Carros' })).toBeTruthy();
    expect(screen.queryByText('Collection Detail')).toBeNull();
  });

  it('selects a collection when clicking anywhere on the sidebar card', () => {
    render(
      <CollectionsWorkspace filteredImages={[]} totalImages={[]}>
        <div>Collection Detail</div>
      </CollectionsWorkspace>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select collection Carros' }));

    expect(screen.getByText('Collection Detail')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All Collections' })).toBeTruthy();
  });

  it('uses global collection order for move buttons while the sidebar list is filtered', () => {
    const reorderCollections = vi.fn().mockResolvedValue(undefined);
    useImageStore.setState({ reorderCollections } as any);

    render(
      <CollectionsWorkspace filteredImages={[]} totalImages={[]}>
        <div>Collection Detail</div>
      </CollectionsWorkspace>,
    );

    fireEvent.change(screen.getByPlaceholderText('Search collections...'), {
      target: { value: 'Motos' },
    });

    const moveUpButton = screen.getByTitle('Move up') as HTMLButtonElement;
    const moveDownButton = screen.getByTitle('Move down') as HTMLButtonElement;

    expect(moveUpButton.disabled).toBe(false);
    expect(moveDownButton.disabled).toBe(true);

    fireEvent.click(moveUpButton);

    expect(reorderCollections).toHaveBeenCalledWith(['collection-2', 'collection-1']);
  });
});

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GridToolbar from '../components/GridToolbar';
import { useImageStore } from '../store/useImageStore';

vi.mock('../hooks/useFeatureAccess', () => ({
  useFeatureAccess: () => ({
    canUseComparison: true,
    canUseA1111: true,
    canUseComfyUI: true,
    canUseBulkTagging: true,
    showProModal: vi.fn(),
  }),
}));

vi.mock('../hooks/useReparseMetadata', () => ({
  useReparseMetadata: () => ({
    isReparsing: false,
    reparseImages: vi.fn(),
  }),
}));

vi.mock('../components/ActiveFilters', () => ({
  default: () => <div>Active Filters</div>,
}));

vi.mock('../components/TagManagerModal', () => ({
  default: () => null,
}));

describe('GridToolbar', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
    useImageStore.setState({
      collections: [
        {
          id: 'collection-1',
          kind: 'manual',
          name: 'Carros',
          sortIndex: 0,
          imageIds: [],
          snapshotImageIds: [],
          imageCount: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    } as any);
  });

  it('opens collection actions from the toolbar and creates a new collection from filtered images', async () => {
    const onCreateCollectionFromFiltered = vi.fn();

    render(
      <GridToolbar
        selectedImages={new Set()}
        images={[]}
        directories={[]}
        onCreateCollectionFromFiltered={onCreateCollectionFromFiltered}
        onAddCurrentFilteredToCollection={vi.fn()}
        filteredImageActionCount={18}
        onDeleteSelected={vi.fn()}
        onGenerateA1111={vi.fn()}
        onGenerateComfyUI={vi.fn()}
        onCompare={vi.fn()}
        onBatchExport={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Collection actions' }));
    fireEvent.click(await screen.findByText('Create new collection from filtered images'));

    expect(onCreateCollectionFromFiltered).toHaveBeenCalled();
  });

  it('adds filtered images to an existing collection from the toolbar menu', async () => {
    const onAddCurrentFilteredToCollection = vi.fn();

    render(
      <GridToolbar
        selectedImages={new Set()}
        images={[]}
        directories={[]}
        onCreateCollectionFromFiltered={vi.fn()}
        onAddCurrentFilteredToCollection={onAddCurrentFilteredToCollection}
        filteredImageActionCount={18}
        onDeleteSelected={vi.fn()}
        onGenerateA1111={vi.fn()}
        onGenerateComfyUI={vi.fn()}
        onCompare={vi.fn()}
        onBatchExport={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Collection actions' }));
    fireEvent.mouseEnter(await screen.findByText('Add filtered images to collection'));
    fireEvent.click(await screen.findByText('Carros'));

    await waitFor(() => {
      expect(onAddCurrentFilteredToCollection).toHaveBeenCalledWith('collection-1');
    });
  });
});

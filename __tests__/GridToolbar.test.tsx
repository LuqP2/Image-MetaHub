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
        onStartSlideshow={vi.fn()}
        slideshowImageCount={0}
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
        onStartSlideshow={vi.fn()}
        slideshowImageCount={0}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Collection actions' }));
    fireEvent.mouseEnter(await screen.findByText('Add filtered images to collection'));
    fireEvent.click(await screen.findByText('Carros'));

    await waitFor(() => {
      expect(onAddCurrentFilteredToCollection).toHaveBeenCalledWith('collection-1');
    });
  });

  it('starts a slideshow from the current view without requiring a selection', () => {
    const onStartSlideshow = vi.fn();

    render(
      <GridToolbar
        selectedImages={new Set()}
        images={[]}
        directories={[]}
        filteredImageActionCount={0}
        onDeleteSelected={vi.fn()}
        onGenerateA1111={vi.fn()}
        onGenerateComfyUI={vi.fn()}
        onCompare={vi.fn()}
        onBatchExport={vi.fn()}
        onStartSlideshow={onStartSlideshow}
        slideshowImageCount={3}
        slideshowSourceLabel="current folder"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start slideshow' }));

    expect(onStartSlideshow).toHaveBeenCalledTimes(1);
  });

  it('clears selected images from the toolbar', () => {
    const images = [
      { id: 'img-1', name: 'alpha.png' },
      { id: 'img-2', name: 'beta.png' },
    ] as any;

    useImageStore.setState({ selectedImages: new Set(['img-1', 'img-2']) } as any);

    render(
      <GridToolbar
        selectedImages={useImageStore.getState().selectedImages}
        images={images}
        directories={[]}
        filteredImageActionCount={0}
        onDeleteSelected={vi.fn()}
        onGenerateA1111={vi.fn()}
        onGenerateComfyUI={vi.fn()}
        onCompare={vi.fn()}
        onBatchExport={vi.fn()}
        onStartSlideshow={vi.fn()}
        slideshowImageCount={0}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));

    expect(useImageStore.getState().selectedImages).toEqual(new Set());
  });

  it('opens jump menu and jumps to the selected group', async () => {
    const onJumpToGroup = vi.fn();

    render(
      <GridToolbar
        selectedImages={new Set()}
        images={[]}
        directories={[]}
        filteredImageActionCount={0}
        onDeleteSelected={vi.fn()}
        onGenerateA1111={vi.fn()}
        onGenerateComfyUI={vi.fn()}
        onCompare={vi.fn()}
        onBatchExport={vi.fn()}
        onStartSlideshow={vi.fn()}
        slideshowImageCount={0}
        groups={[
          { id: 'session-1', label: 'May 21, 09:00-09:30', count: 4, startImageId: 'img-1' },
          { id: 'session-2', label: 'May 21, 14:00-14:15', count: 2, startImageId: 'img-5' },
        ]}
        onJumpToGroup={onJumpToGroup}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Jump to group' }));
    fireEvent.change(screen.getByPlaceholderText('Find group...'), { target: { value: '14:00' } });
    fireEvent.click(await screen.findByText('May 21, 14:00-14:15'));

    expect(onJumpToGroup).toHaveBeenCalledWith('session-2');
  });

  it('uses a calendar jump menu for session groups and marks session counts by day', async () => {
    const onJumpToGroup = vi.fn();

    render(
      <GridToolbar
        selectedImages={new Set()}
        images={[]}
        directories={[]}
        filteredImageActionCount={0}
        onDeleteSelected={vi.fn()}
        onGenerateA1111={vi.fn()}
        onGenerateComfyUI={vi.fn()}
        onCompare={vi.fn()}
        onBatchExport={vi.fn()}
        onStartSlideshow={vi.fn()}
        slideshowImageCount={0}
        groupBy="session"
        groups={[
          {
            id: 'session-1',
            label: 'May 21, 09:00-09:30',
            count: 4,
            startImageId: 'img-1',
            dateKey: '2026-05-21',
            startTime: new Date(2026, 4, 21, 9, 0).getTime(),
          },
          {
            id: 'session-2',
            label: 'May 21, 14:00-14:15',
            count: 2,
            startImageId: 'img-5',
            dateKey: '2026-05-21',
            startTime: new Date(2026, 4, 21, 14, 0).getTime(),
          },
        ]}
        onJumpToGroup={onJumpToGroup}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Jump to group' }));

    expect(screen.getByText(/2026/)).toBeTruthy();
    expect(screen.getByTitle('2 sessions')).toBeTruthy();

    fireEvent.click(await screen.findByText('May 21, 14:00-14:15'));

    expect(onJumpToGroup).toHaveBeenCalledWith('session-2');
  });

  it('lets the user navigate calendar months without snapping back to the active date', async () => {
    render(
      <GridToolbar
        selectedImages={new Set()}
        images={[]}
        directories={[]}
        filteredImageActionCount={0}
        onDeleteSelected={vi.fn()}
        onGenerateA1111={vi.fn()}
        onGenerateComfyUI={vi.fn()}
        onCompare={vi.fn()}
        onBatchExport={vi.fn()}
        onStartSlideshow={vi.fn()}
        slideshowImageCount={0}
        groupBy="date"
        groups={[
          {
            id: 'date-1',
            label: 'December 12, 2025',
            count: 3,
            startImageId: 'img-1',
            dateKey: '2025-12-12',
            startTime: new Date(2025, 11, 12, 9, 0).getTime(),
          },
        ]}
        onJumpToGroup={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Jump to group' }));

    // Opens snapped to the active date's month.
    expect(await screen.findByText('December 2025')).toBeTruthy();

    // Manual navigation must persist (previously an effect reverted it every render).
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => expect(screen.getByText('January 2026')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => expect(screen.getByText('February 2026')).toBeTruthy());
  });
});

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ImageTable from '../components/ImageTable';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import type { IndexedImage } from '../types';

const showContextMenuMock = vi.fn();
const hideContextMenuMock = vi.fn();
const contextMenuStateMock = {
  visible: false,
  x: 24,
  y: 24,
  image: undefined as IndexedImage | undefined,
  directoryPath: 'D:/library',
};

vi.mock('../hooks/useContextMenu', () => ({
  useContextMenu: () => ({
    contextMenu: contextMenuStateMock,
    showContextMenu: showContextMenuMock,
    hideContextMenu: hideContextMenuMock,
    copyPrompt: vi.fn(),
    copyNegativePrompt: vi.fn(),
    copySeed: vi.fn(),
    copyImage: vi.fn(),
    copyModel: vi.fn(),
    showInFolder: vi.fn(),
    exportImage: vi.fn(),
    copyRawMetadata: vi.fn(),
  }),
}));

vi.mock('../hooks/useThumbnail', () => ({
  useThumbnail: vi.fn(),
}));

vi.mock('../hooks/useResolvedThumbnail', () => ({
  useResolvedThumbnail: () => ({
    thumbnailStatus: 'ready',
    thumbnailUrl: 'thumb://image',
  }),
}));

vi.mock('../hooks/useFeatureAccess', () => ({
  useFeatureAccess: () => ({
    canUseFileManagement: true,
    showProModal: vi.fn(),
    initialized: true,
    canUseDuringTrialOrPro: true,
  }),
}));

vi.mock('../hooks/useReparseMetadata', () => ({
  useReparseMetadata: () => ({
    isReparsing: false,
    reparseImages: vi.fn(),
  }),
}));

vi.mock('../components/ProBadge', () => ({
  default: () => null,
}));

vi.mock('../components/TransferImagesModal', () => ({
  default: () => null,
}));

vi.mock('../components/CollectionFormModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>Create Collection Modal</div> : null),
}));

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: overrides.id ?? 'dir-1::image.png',
  name: overrides.name ?? 'image.png',
  handle: overrides.handle ?? ({ name: overrides.name ?? 'image.png' } as FileSystemFileHandle),
  metadata: overrides.metadata ?? ({} as any),
  metadataString: overrides.metadataString ?? '',
  lastModified: overrides.lastModified ?? 1,
  directoryId: overrides.directoryId ?? 'dir-1',
  models: overrides.models ?? [],
  loras: overrides.loras ?? [],
  scheduler: overrides.scheduler ?? '',
  workflowNodes: overrides.workflowNodes ?? [],
  ...overrides,
});

describe('ImageTable context menu', () => {
  beforeEach(() => {
    showContextMenuMock.mockReset();
    hideContextMenuMock.mockReset();
    contextMenuStateMock.visible = false;
    contextMenuStateMock.image = undefined;
    useImageStore.getState().resetState();
    useSettingsStore.getState().resetState();
    useSettingsStore.setState({
      disableThumbnails: false,
      showFullFilePath: false,
    } as any);
  });

  it('shows collection actions in the image-table context menu', () => {
    const image = createImage({ id: 'img-1', name: 'alpha.png' });
    contextMenuStateMock.visible = true;
    contextMenuStateMock.image = image;

    useImageStore.setState({
      images: [image],
      filteredImages: [image],
      directories: [{ id: 'dir-1', path: 'D:/library' }],
      collections: [],
      createCollection: vi.fn().mockResolvedValue(undefined),
      addImagesToCollection: vi.fn().mockResolvedValue(undefined),
      removeImagesFromCollection: vi.fn().mockResolvedValue(undefined),
      updateCollection: vi.fn().mockResolvedValue(undefined),
      bulkAddTag: vi.fn().mockResolvedValue(undefined),
      bulkRemoveTag: vi.fn().mockResolvedValue(undefined),
      bulkSetImageRating: vi.fn(),
      transferProgress: null,
    } as any);

    render(
      <ImageTable
        images={[image]}
        onImageClick={vi.fn()}
        selectedImages={new Set()}
        onBatchExport={vi.fn()}
      />,
    );

    expect(screen.getByText('Collection')).toBeTruthy();
    fireEvent.click(screen.getByText('Collection'));
    expect(screen.getByText('Create New Collection')).toBeTruthy();
  });

  it('adds selected images explicitly to collections with auto-add enabled', () => {
    const addImagesToCollection = vi.fn().mockResolvedValue(undefined);
    const image = createImage({ id: 'img-1', name: 'alpha.png' });
    contextMenuStateMock.visible = true;
    contextMenuStateMock.image = image;

    useImageStore.setState({
      images: [image],
      filteredImages: [image],
      directories: [{ id: 'dir-1', path: 'D:/library' }],
      selectedImages: new Set(['img-1']),
      collections: [
        {
          id: 'collection-1',
          kind: 'tag_rule',
          name: 'Carros',
          sortIndex: 0,
          imageCount: 0,
          imageIds: [],
          sourceTag: 'carros',
          autoUpdate: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      createCollection: vi.fn().mockResolvedValue(undefined),
      addImagesToCollection,
      removeImagesFromCollection: vi.fn().mockResolvedValue(undefined),
      updateCollection: vi.fn().mockResolvedValue(undefined),
      bulkSetImageRating: vi.fn(),
      transferProgress: null,
    } as any);

    render(
      <ImageTable
        images={[image]}
        onImageClick={vi.fn()}
        selectedImages={new Set(['img-1'])}
        onBatchExport={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Collection'));
    fireEvent.click(screen.getByText('Add to Collection'));
    fireEvent.click(screen.getByText('Carros'));

    expect(addImagesToCollection).toHaveBeenCalledWith('collection-1', ['img-1']);
  });
});

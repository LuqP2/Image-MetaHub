import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ImageGrid from '../components/ImageGrid';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import type { IndexedImage } from '../types';

const showContextMenuMock = vi.fn();

vi.mock('../hooks/useContextMenu', () => ({
  useContextMenu: () => ({
    contextMenu: { visible: false, x: 0, y: 0, image: undefined, directoryPath: undefined },
    showContextMenu: showContextMenuMock,
    hideContextMenu: vi.fn(),
    copyPrompt: vi.fn(),
    copyNegativePrompt: vi.fn(),
    copySeed: vi.fn(),
    copyImage: vi.fn(),
    copyModel: vi.fn(),
    showInFolder: vi.fn(),
    exportImage: vi.fn(),
    copyMetadataToA1111: vi.fn(),
    copyRawMetadata: vi.fn(),
    addTag: vi.fn(),
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

vi.mock('../hooks/useIntersectionObserver', () => ({
  useIntersectionObserver: () => [vi.fn(), true],
}));

vi.mock('../hooks/useGenerateWithA1111', () => ({
  useGenerateWithA1111: () => ({
    generateWithA1111: vi.fn(),
    isGenerating: false,
  }),
}));

vi.mock('../hooks/useGenerateWithComfyUI', () => ({
  useGenerateWithComfyUI: () => ({
    generateWithComfyUI: vi.fn(),
    isGenerating: false,
  }),
}));

vi.mock('../hooks/useReparseMetadata', () => ({
  useReparseMetadata: () => ({
    isReparsing: false,
    reparseImages: vi.fn(),
  }),
}));

vi.mock('../hooks/useFeatureAccess', () => ({
  useFeatureAccess: () => ({
    canUseComparison: true,
    showProModal: vi.fn(),
    canUseA1111: true,
    canUseComfyUI: true,
    canUseBatchExport: true,
    canUseBulkTagging: true,
    canUseFileManagement: true,
    initialized: true,
    canUseDuringTrialOrPro: true,
  }),
}));

vi.mock('../hooks/useImageStacking', () => ({
  useImageStacking: (images: IndexedImage[]) => ({
    stackedItems: images,
  }),
}));

vi.mock('../components/A1111GenerateModal', () => ({
  A1111GenerateModal: () => null,
}));

vi.mock('../components/ComfyUIGenerateModal', () => ({
  ComfyUIGenerateModal: () => null,
}));

vi.mock('../components/Toast', () => ({
  default: () => null,
}));

vi.mock('../components/ProBadge', () => ({
  default: () => null,
}));

vi.mock('../components/TagManagerModal', () => ({
  default: () => null,
}));

vi.mock('../components/TransferImagesModal', () => ({
  default: () => null,
}));

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: overrides.id ?? 'dir-1::image.png',
  name: overrides.name ?? 'image.png',
  handle: overrides.handle ?? ({} as FileSystemFileHandle),
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

const Harness = ({ images }: { images: IndexedImage[] }) => {
  const selectedImages = useImageStore((state) => state.selectedImages);

  return (
    <ImageGrid
      images={images}
      onImageClick={vi.fn()}
      selectedImages={selectedImages}
      currentPage={1}
      totalPages={1}
      onPageChange={vi.fn()}
      onBatchExport={vi.fn()}
    />
  );
};

describe('ImageGrid context menu', () => {
  beforeEach(() => {
    showContextMenuMock.mockReset();
    useImageStore.getState().resetState();
    useSettingsStore.getState().resetState();
    useSettingsStore.setState({
      itemsPerPage: 20,
      imageSize: 120,
      disableThumbnails: false,
      showFilenames: false,
      showFullFilePath: false,
      doubleClickToOpen: false,
      sensitiveTags: [],
      blurSensitiveImages: false,
      enableSafeMode: false,
    } as any);
  });

  it('keeps multi-selection when right-clicking an image and opens the context menu', () => {
    const images = [
      createImage({ id: 'img-1', name: 'alpha.png' }),
      createImage({ id: 'img-2', name: 'beta.png' }),
    ];

    useImageStore.setState({
      images,
      filteredImages: images,
      directories: [{ id: 'dir-1', path: 'D:/library' }],
      selectedImages: new Set(['img-1', 'img-2']),
      isStackingEnabled: false,
      focusedImageIndex: null,
      previewImage: null,
      transferProgress: null,
      filterAndSortImages: vi.fn(),
    } as any);

    render(<Harness images={images} />);

    const imageThumb = screen.getByAltText('alpha.png');
    fireEvent.mouseDown(imageThumb, { button: 2, clientX: 32, clientY: 40 });
    fireEvent.contextMenu(imageThumb, { clientX: 32, clientY: 40 });

    expect(useImageStore.getState().selectedImages).toEqual(new Set(['img-1', 'img-2']));
    expect(showContextMenuMock).toHaveBeenCalledTimes(1);
    expect(showContextMenuMock.mock.calls[0]?.[1]).toMatchObject({ id: 'img-1' });
    expect(showContextMenuMock.mock.calls[0]?.[2]).toBe('D:/library');
  });
});

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ImageGrid from '../components/ImageGrid';
import { useImageSelection } from '../hooks/useImageSelection';
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

const SelectionHarness = ({ images }: { images: IndexedImage[] }) => {
  const selectedImages = useImageStore((state) => state.selectedImages);
  const { handleImageSelection } = useImageSelection();

  return (
    <ImageGrid
      images={images}
      onImageClick={handleImageSelection}
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
    hideContextMenuMock.mockReset();
    contextMenuStateMock.visible = false;
    contextMenuStateMock.image = undefined;
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

  it('shows collection actions in the image context menu', () => {
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
      isStackingEnabled: false,
      focusedImageIndex: null,
      previewImage: null,
      transferProgress: null,
      filterAndSortImages: vi.fn(),
    } as any);

    render(<Harness images={[image]} />);

    expect(screen.getByText('Collection')).toBeTruthy();
    fireEvent.click(screen.getByText('Collection'));
    expect(screen.getByText('Create New Collection')).toBeTruthy();
  });

  it('adds selected images to a manual collection from the context menu', () => {
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
          kind: 'manual',
          name: 'Motos',
          sortIndex: 0,
          imageCount: 0,
          imageIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      createCollection: vi.fn().mockResolvedValue(undefined),
      addImagesToCollection,
      removeImagesFromCollection: vi.fn().mockResolvedValue(undefined),
      updateCollection: vi.fn().mockResolvedValue(undefined),
      bulkAddTag: vi.fn().mockResolvedValue(undefined),
      bulkRemoveTag: vi.fn().mockResolvedValue(undefined),
      isStackingEnabled: false,
      focusedImageIndex: null,
      previewImage: null,
      transferProgress: null,
      filterAndSortImages: vi.fn(),
    } as any);

    render(<Harness images={[image]} />);

    fireEvent.click(screen.getByText('Collection'));
    fireEvent.click(screen.getByText('Add to Collection'));
    fireEvent.click(screen.getByText('Motos'));

    expect(addImagesToCollection).toHaveBeenCalledWith('collection-1', ['img-1']);
  });

  it('adds selected images explicitly even for collections with auto-add tags', () => {
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
      isStackingEnabled: false,
      focusedImageIndex: null,
      previewImage: null,
      transferProgress: null,
      filterAndSortImages: vi.fn(),
    } as any);

    render(<Harness images={[image]} />);

    fireEvent.click(screen.getByText('Collection'));
    fireEvent.click(screen.getByText('Add to Collection'));
    fireEvent.click(screen.getByText('Carros'));

    expect(addImagesToCollection).toHaveBeenCalledWith('collection-1', ['img-1']);
  });
});

describe('ImageGrid selection opening behavior', () => {
  beforeEach(() => {
    showContextMenuMock.mockReset();
    hideContextMenuMock.mockReset();
    contextMenuStateMock.visible = false;
    contextMenuStateMock.image = undefined;
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

  it('preserves checked images when plain-clicking another image to open it', () => {
    const images = [
      createImage({ id: 'img-1', name: 'alpha.png' }),
      createImage({ id: 'img-2', name: 'beta.png' }),
      createImage({ id: 'img-3', name: 'gamma.png' }),
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

    render(<SelectionHarness images={images} />);

    fireEvent.click(screen.getByAltText('gamma.png'));

    expect(useImageStore.getState().selectedImage?.id).toBe('img-3');
    expect(useImageStore.getState().selectedImages).toEqual(new Set(['img-1', 'img-2']));
  });

  it('preserves checked images while previewing and double-click opening when double-click mode is enabled', () => {
    const onImageClick = vi.fn();
    const images = [
      createImage({ id: 'img-1', name: 'alpha.png' }),
      createImage({ id: 'img-2', name: 'beta.png' }),
      createImage({ id: 'img-3', name: 'gamma.png' }),
    ];

    useSettingsStore.setState({ doubleClickToOpen: true } as any);
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

    render(
      <ImageGrid
        images={images}
        onImageClick={onImageClick}
        selectedImages={useImageStore.getState().selectedImages}
        currentPage={1}
        totalPages={1}
        onPageChange={vi.fn()}
        onBatchExport={vi.fn()}
      />,
    );

    const imageThumb = screen.getByAltText('gamma.png');
    fireEvent.click(imageThumb);

    expect(useImageStore.getState().previewImage?.id).toBe('img-3');
    expect(useImageStore.getState().selectedImages).toEqual(new Set(['img-1', 'img-2']));
    expect(onImageClick).not.toHaveBeenCalled();

    fireEvent.doubleClick(imageThumb);

    expect(onImageClick).toHaveBeenCalledTimes(1);
    expect(useImageStore.getState().selectedImages).toEqual(new Set(['img-1', 'img-2']));
  });

  it('preserves checked images when middle-clicking an image', () => {
    const onImageClick = vi.fn();
    const images = [
      createImage({ id: 'img-1', name: 'alpha.png' }),
      createImage({ id: 'img-2', name: 'beta.png' }),
      createImage({ id: 'img-3', name: 'gamma.png' }),
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

    const imageThumb = screen.getByAltText('gamma.png');
    fireEvent.mouseDown(imageThumb, { button: 1 });
    fireEvent(imageThumb, new MouseEvent('auxclick', { bubbles: true, button: 1 }));

    expect(useImageStore.getState().selectedImages).toEqual(new Set(['img-1', 'img-2']));
  });

  it('still toggles selection from the checkbox', () => {
    const images = [
      createImage({ id: 'img-1', name: 'alpha.png' }),
      createImage({ id: 'img-2', name: 'beta.png' }),
    ];

    useImageStore.setState({
      images,
      filteredImages: images,
      directories: [{ id: 'dir-1', path: 'D:/library' }],
      selectedImages: new Set(['img-1']),
      isStackingEnabled: false,
      focusedImageIndex: null,
      previewImage: null,
      transferProgress: null,
      filterAndSortImages: vi.fn(),
    } as any);

    render(<Harness images={images} />);

    fireEvent.click(screen.getByTitle('Deselect image'));

    expect(useImageStore.getState().selectedImages).toEqual(new Set());
  });

  it('clears checked images when clicking empty grid space without modifiers', () => {
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

    const { container } = render(<Harness images={images} />);
    const gridArea = container.querySelector('[data-area="grid"]') as HTMLElement;

    fireEvent.mouseDown(gridArea, { button: 0, clientX: 4, clientY: 4 });

    expect(useImageStore.getState().selectedImages).toEqual(new Set());
  });
});

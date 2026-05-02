import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageGrid from '../components/ImageGrid';
import { useImageSelection } from '../hooks/useImageSelection';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import type { ImageStack, IndexedImage } from '../types';

const renameIndexedImageMock = vi.hoisted(() => vi.fn());
const stackedItemsMock = vi.hoisted(() => ({ value: null as (IndexedImage | ImageStack)[] | null }));
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

vi.mock('react-virtualized-auto-sizer', () => ({
  default: ({ children }: { children: (size: { height: number; width: number }) => React.ReactNode }) =>
    children({ height: 600, width: 408 }),
}));

vi.mock('../services/imageRenameService', () => ({
  getRenameBasename: (image: IndexedImage) => {
    const fileName = image.name.replace(/\\/g, '/').split('/').pop() || image.name;
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  },
  renameIndexedImage: renameIndexedImageMock,
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
    stackedItems: stackedItemsMock.value ?? images,
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

const createImages = (count: number): IndexedImage[] =>
  Array.from({ length: count }, (_, index) =>
    createImage({
      id: `img-${index}`,
      name: `image-${index}.png`,
    }),
  );

const Harness = ({ images, onFindSimilar }: { images: IndexedImage[]; onFindSimilar?: (image: IndexedImage) => void }) => {
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
      onFindSimilar={onFindSimilar}
    />
  );
};

const setupImageGridState = (images: IndexedImage[], focusedImageIndex: number | null = null) => {
  useImageStore.setState({
    images,
    filteredImages: images,
    directories: [{ id: 'dir-1', path: 'D:/library' }],
    selectedImages: new Set(),
    isStackingEnabled: false,
    focusedImageIndex,
    previewImage: focusedImageIndex != null && focusedImageIndex >= 0 ? images[focusedImageIndex] : null,
    transferProgress: null,
    filterAndSortImages: vi.fn(),
  } as any);
};

const focusGridAndPress = (container: HTMLElement, key: string) => {
  const grid = container.querySelector<HTMLElement>('[data-area="grid"]');
  expect(grid).toBeTruthy();

  fireEvent.focus(grid!);
  fireEvent.keyDown(document, { key });
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
    vi.useRealTimers();
    showContextMenuMock.mockReset();
    stackedItemsMock.value = null;
    hideContextMenuMock.mockReset();
    renameIndexedImageMock.mockReset();
    renameIndexedImageMock.mockResolvedValue({
      success: true,
      newImageId: 'dir-1::renamed.png',
      newRelativePath: 'renamed.png',
    });
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

  afterEach(() => {
    vi.useRealTimers();
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

  it('activates keyboard navigation when the thumbnail grid receives focus', () => {
    const images = [
      createImage({ id: 'img-1', name: 'alpha.png' }),
      createImage({ id: 'img-2', name: 'beta.png' }),
    ];

    useImageStore.setState({
      images,
      filteredImages: images,
      directories: [{ id: 'dir-1', path: 'D:/library' }],
      selectedImages: new Set(),
      isStackingEnabled: false,
      focusedImageIndex: null,
      previewImage: null,
      transferProgress: null,
      filterAndSortImages: vi.fn(),
    } as any);

    const { container } = render(<Harness images={images} />);
    const grid = container.querySelector<HTMLElement>('[data-area="grid"]');
    expect(grid).toBeTruthy();

    fireEvent.focus(grid!);
    fireEvent.keyDown(document, { key: 'ArrowRight' });

    expect(useImageStore.getState().focusedImageIndex).toBe(0);
    expect(useImageStore.getState().previewImage?.id).toBe('img-1');
  });

  it('establishes focus on the first rendered image when pressing ArrowDown without current focus', () => {
    const images = createImages(6);
    useSettingsStore.setState({ itemsPerPage: -1 } as any);
    setupImageGridState(images);

    const { container } = render(<Harness images={images} />);

    focusGridAndPress(container, 'ArrowDown');

    expect(useImageStore.getState().focusedImageIndex).toBe(0);
    expect(useImageStore.getState().previewImage?.id).toBe('img-0');
  });

  it('moves down and up by the rendered column count', () => {
    const images = createImages(7);
    useSettingsStore.setState({ itemsPerPage: -1 } as any);
    setupImageGridState(images, 1);

    const { container } = render(<Harness images={images} />);

    focusGridAndPress(container, 'ArrowDown');
    expect(useImageStore.getState().focusedImageIndex).toBe(4);
    expect(useImageStore.getState().previewImage?.id).toBe('img-4');

    focusGridAndPress(container, 'ArrowUp');
    expect(useImageStore.getState().focusedImageIndex).toBe(1);
    expect(useImageStore.getState().previewImage?.id).toBe('img-1');
  });

  it('moves Home to the first image and End to the last rendered image', () => {
    const images = createImages(6);
    useSettingsStore.setState({ itemsPerPage: -1 } as any);
    setupImageGridState(images, 3);

    const { container } = render(<Harness images={images} />);

    focusGridAndPress(container, 'Home');
    expect(useImageStore.getState().focusedImageIndex).toBe(0);
    expect(useImageStore.getState().previewImage?.id).toBe('img-0');

    focusGridAndPress(container, 'End');
    expect(useImageStore.getState().focusedImageIndex).toBe(5);
    expect(useImageStore.getState().previewImage?.id).toBe('img-5');
  });

  it('clamps ArrowDown to the last image when navigating from the last partial row', () => {
    const images = createImages(8);
    useSettingsStore.setState({ itemsPerPage: -1 } as any);
    setupImageGridState(images, 5);

    const { container } = render(<Harness images={images} />);

    focusGridAndPress(container, 'ArrowDown');

    expect(useImageStore.getState().focusedImageIndex).toBe(7);
    expect(useImageStore.getState().previewImage?.id).toBe('img-7');
  });

  it('defers preview updates during repeated keyboard navigation and flushes on keyup', () => {
    vi.useFakeTimers();
    const images = createImages(7);
    useSettingsStore.setState({ itemsPerPage: -1 } as any);
    setupImageGridState(images, 1);

    const { container } = render(<Harness images={images} />);
    const grid = container.querySelector<HTMLElement>('[data-area="grid"]');
    expect(grid).toBeTruthy();

    fireEvent.focus(grid!);
    fireEvent.keyDown(document, { key: 'ArrowDown', repeat: true });

    expect(useImageStore.getState().focusedImageIndex).toBe(4);
    expect(useImageStore.getState().previewImage?.id).toBe('img-1');

    fireEvent.keyUp(document, { key: 'ArrowDown' });

    expect(useImageStore.getState().previewImage?.id).toBe('img-4');
  });

  it('navigates stack cards by rendered position while storing the stack cover image index', () => {
    const images = createImages(5);
    const onImageClick = vi.fn();
    const firstStack: ImageStack = {
      id: 'stack-img-0',
      coverImage: images[0],
      images: [images[0], images[1]],
      count: 2,
    };
    const secondStack: ImageStack = {
      id: 'stack-img-3',
      coverImage: images[3],
      images: [images[3], images[4]],
      count: 2,
    };
    stackedItemsMock.value = [firstStack, images[2], secondStack];
    useSettingsStore.setState({ itemsPerPage: -1 } as any);
    setupImageGridState(images, 0);
    useImageStore.setState({ isStackingEnabled: true } as any);

    const { container } = render(
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

    focusGridAndPress(container, 'ArrowRight');
    expect(useImageStore.getState().focusedImageIndex).toBe(2);
    expect(useImageStore.getState().previewImage?.id).toBe('img-2');

    focusGridAndPress(container, 'ArrowRight');
    expect(useImageStore.getState().focusedImageIndex).toBe(3);
    expect(useImageStore.getState().previewImage?.id).toBe('img-3');
    expect(
      Array.from(container.querySelectorAll<HTMLElement>('[data-image-id="img-3"]'))
        .some((element) => element.className.includes('outline-blue-400')),
    ).toBe(true);

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onImageClick).toHaveBeenCalledWith(images[3], expect.any(Object));
  });

  it('renames a thumbnail inline after double-clicking the filename', async () => {
    const image = createImage({ id: 'img-1', name: 'alpha.png' });

    useSettingsStore.setState({ showFilenames: true } as any);
    useImageStore.setState({
      images: [image],
      filteredImages: [image],
      directories: [{ id: 'dir-1', path: 'D:/library' }],
      selectedImages: new Set(),
      isStackingEnabled: false,
      focusedImageIndex: null,
      previewImage: null,
      transferProgress: null,
      filterAndSortImages: vi.fn(),
    } as any);

    render(<Harness images={[image]} />);

    fireEvent.doubleClick(screen.getByText('alpha.png'));
    const input = screen.getByRole('textbox', { name: /rename alpha\.png/i }) as HTMLInputElement;

    expect(input.value).toBe('alpha');
    fireEvent.change(input, { target: { value: 'beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(renameIndexedImageMock).toHaveBeenCalledWith(image, 'beta');
    });
  });

  it('starts inline rename from the image context menu', () => {
    const image = createImage({ id: 'img-1', name: 'alpha.png' });
    contextMenuStateMock.visible = true;
    contextMenuStateMock.image = image;

    useImageStore.setState({
      images: [image],
      filteredImages: [image],
      directories: [{ id: 'dir-1', path: 'D:/library' }],
      selectedImages: new Set(),
      isStackingEnabled: false,
      focusedImageIndex: null,
      previewImage: null,
      transferProgress: null,
      filterAndSortImages: vi.fn(),
    } as any);

    render(<Harness images={[image]} />);

    fireEvent.click(screen.getByText('Rename...'));

    expect(screen.getByRole('textbox', { name: /rename alpha\.png/i })).toBeTruthy();
    expect(hideContextMenuMock).toHaveBeenCalled();
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

  it('shows a find similar action in the image context menu', () => {
    const onFindSimilar = vi.fn();
    const image = createImage({ id: 'img-1', name: 'alpha.png', prompt: 'Test prompt' });
    contextMenuStateMock.visible = true;
    contextMenuStateMock.image = image;

    useImageStore.setState({
      images: [image],
      filteredImages: [image],
      directories: [{ id: 'dir-1', path: 'D:/library' }],
      selectedImages: new Set(),
      isStackingEnabled: false,
      focusedImageIndex: null,
      previewImage: null,
      transferProgress: null,
      filterAndSortImages: vi.fn(),
    } as any);

    render(<Harness images={[image]} onFindSimilar={onFindSimilar} />);

    fireEvent.click(screen.getByText('Find similar...'));
    expect(onFindSimilar).toHaveBeenCalledWith(image);
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

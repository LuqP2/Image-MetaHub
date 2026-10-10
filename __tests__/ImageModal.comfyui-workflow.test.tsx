import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageModal from '../components/ImageModal';
import ImagePreviewSidebar from '../components/ImagePreviewSidebar';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
import type { IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';

vi.mock('../hooks/useCopyToA1111', () => ({
  useCopyToA1111: () => ({ copyToA1111: vi.fn(), isCopying: false, copyStatus: null }),
}));

vi.mock('../hooks/useGenerateWithA1111', () => ({
  useGenerateWithA1111: () => ({ generateWithA1111: vi.fn(), isGenerating: false, generateStatus: null }),
}));

vi.mock('../hooks/useCopyToComfyUI', () => ({
  useCopyToComfyUI: () => ({ copyToComfyUI: vi.fn(), isCopying: false, copyStatus: null }),
}));

vi.mock('../hooks/useGenerateWithComfyUI', () => ({
  useGenerateWithComfyUI: () => ({ generateWithComfyUI: vi.fn(), isGenerating: false, generateStatus: null }),
}));

vi.mock('../hooks/useImageComparison', () => ({
  comparisonWillAutoOpen: () => false,
  useImageComparison: () => ({ addImage: vi.fn(), comparisonCount: 0 }),
}));

vi.mock('../hooks/useReparseMetadata', () => ({
  useReparseMetadata: () => ({ isReparsing: false, reparseImages: vi.fn() }),
}));

vi.mock('../hooks/useFeatureAccess', () => ({
  useFeatureAccess: () => ({
    canUseA1111: true,
    canUseComfyUI: true,
    canUseComparison: true,
    canUseBatchExport: true,
    canUseAdvancedPromptLibrary: true,
    showProModal: vi.fn(),
    initialized: true,
  }),
}));

vi.mock('../hooks/useGenerationProviderAvailability', () => ({
  useGenerationProviderAvailability: () => ({
    a1111Enabled: false,
    comfyUIEnabled: true,
    visibleProviders: [{ id: 'comfyui', shortLabel: 'ComfyUI' }],
    singleVisibleProvider: { id: 'comfyui', shortLabel: 'ComfyUI' },
  }),
}));

vi.mock('../hooks/useShadowMetadata', () => ({
  useShadowMetadata: () => ({
    metadata: null,
    saveMetadata: vi.fn(),
    deleteMetadata: vi.fn(),
  }),
}));

vi.mock('../hooks/useResolvedThumbnail', () => ({
  useResolvedThumbnail: (image: IndexedImage | null) => image
    ? {
        thumbnailUrl: image.thumbnailUrl ?? 'blob:test-image',
        thumbnailHandle: null,
        thumbnailStatus: 'ready',
        thumbnailError: null,
      }
    : null,
}));

vi.mock('../services/mediaSourceCache', () => ({
  getElectronAbsoluteMediaPath: () => null,
  mediaSourceCache: {
    getOrLoad: vi.fn(async () => 'blob:test-image'),
    peek: vi.fn(() => null),
  },
}));

vi.mock('../components/ComfyUIWorkflowWorkspace', () => ({
  default: () => null,
}));

vi.mock('../components/MetadataEditorModal', () => ({
  MetadataEditorModal: () => null,
}));

vi.mock('../components/BatchExportModal', () => ({
  default: () => null,
}));

vi.mock('../components/ImageLineageSection', () => ({
  default: () => null,
}));

vi.mock('../components/CollectionFormModal', () => ({
  default: () => null,
}));

const createImage = (): IndexedImage => ({
  id: 'img-1',
  name: 'alpha.png',
  handle: {} as FileSystemFileHandle,
  thumbnailUrl: 'blob:test-image',
  metadata: {
    rawMetadata: {},
    parsedMetadata: {},
    normalizedMetadata: {
      prompt: 'a quiet forest',
      model: 'dream.ckpt',
      generator: 'ComfyUI',
    },
  },
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
  fileType: 'image/png',
});

describe('ImageModal ComfyUI workflow action', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  it('exposes one-click workflow loading for ComfyUI', async () => {
    const onOpenComfyUIWorkflow = vi.fn();
    const image = createImage();

    render(
      <ImageModal
        image={image}
        onClose={vi.fn()}
        directoryPath="C:/images"
        isActive
        onOpenComfyUIWorkflow={onOpenComfyUIWorkflow}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Open Workflow in ComfyUI/i }));

    expect(onOpenComfyUIWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      id: image.id,
      name: image.name,
    }));
  });

  it.each(['modal', 'sidebar'] as const)('saves the captured prompt selection from the %s context menu', async (surface) => {
    const image = createImage(); const onClose = vi.fn();
    const mutate = vi.spyOn(useSavedPromptStore.getState(), 'mutate').mockResolvedValue('synthetic-block');
    useImageStore.setState({ images: [image], filteredImages: [image], previewImage: image });
    const view = render(surface === 'modal'
      ? <ImageModal image={image} onClose={onClose} directoryPath="C:/synthetic" isActive />
      : <ImagePreviewSidebar width={400} isResizing={false} onResizeStart={vi.fn()} />);
    const prompt = await waitFor(() => {
      const element = view.container.querySelector('[data-prompt-text]'); expect(element).toBeTruthy(); return element!;
    });
    const range = document.createRange(); range.setStart(prompt.firstChild!, 2); range.setEnd(prompt.firstChild!, 7);
    window.getSelection()!.addRange(range); fireEvent.contextMenu(prompt);
    const action = await screen.findByRole('button', { name: 'Save Selection as Block' });
    window.getSelection()!.removeAllRanges(); fireEvent.click(action);
    expect((screen.getByLabelText('Block text') as HTMLTextAreaElement).value).toBe('quiet');
    fireEvent.click(screen.getByRole('button', { name: 'Save block' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', kind: 'block', item: expect.objectContaining({ text: 'quiet' }) })));
    expect(onClose).not.toHaveBeenCalled();
  });
});

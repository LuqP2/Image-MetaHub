import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ImageModal from '../components/ImageModal';
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
});

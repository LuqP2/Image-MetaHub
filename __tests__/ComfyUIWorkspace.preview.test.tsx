import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ComfyUIWorkspace from '../components/ComfyUIWorkspace';
import type { IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';

vi.mock('../hooks/useGenerateWithComfyUI', () => ({
  useGenerateWithComfyUI: () => ({ generateWithComfyUI: vi.fn(), isGenerating: false, generateStatus: null }),
}));

vi.mock('../hooks/useCopyToComfyUI', () => ({
  useCopyToComfyUI: () => ({ copyToComfyUI: vi.fn(), isCopying: false, copyStatus: null }),
}));

vi.mock('../hooks/useThumbnail', () => ({
  useThumbnail: () => null,
}));

vi.mock('../hooks/useResolvedThumbnail', () => ({
  useResolvedThumbnail: (image: IndexedImage | null) => image
    ? {
        thumbnailUrl: image.thumbnailUrl ?? 'blob:test-thumb',
        thumbnailHandle: null,
        thumbnailStatus: 'ready',
        thumbnailError: null,
      }
    : null,
}));

vi.mock('../components/ComfyUIWorkflowWorkspace', () => ({
  default: () => null,
}));

vi.mock('../components/TagManagerModal', () => ({
  default: () => null,
}));

const createImage = (id: string, name = `${id}.png`): IndexedImage => ({
  id,
  name,
  handle: {
    getFile: vi.fn(async () => new File(['image'], name, { type: 'image/png' })),
  } as unknown as FileSystemFileHandle,
  thumbnailUrl: 'blob:test-thumb',
  metadata: {
    rawMetadata: {},
    parsedMetadata: {},
    normalizedMetadata: {
      prompt: `prompt for ${name}`,
      negativePrompt: 'low quality',
      model: 'model.safetensors',
      seed: 42,
      steps: 28,
      cfg_scale: 5,
      width: 512,
      height: 768,
    },
  },
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
  fileType: 'image/png',
});

describe('ComfyUIWorkspace image preview', () => {
  let originalCreateObjectURL: typeof URL.createObjectURL | undefined;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL | undefined;

  beforeEach(() => {
    useImageStore.getState().resetState();
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
    });
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:preview-image'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    });
    window.electronAPI = {
      ...(window.electronAPI ?? {}),
      comfyUIViewOpen: vi.fn(async () => ({ success: true })),
      comfyUIViewHide: vi.fn(async () => ({ success: true })),
      comfyUIViewGetState: vi.fn(async () => ({ success: true, state: undefined })),
      onComfyUIViewStateChanged: vi.fn(() => () => undefined),
      onComfyUIViewLoadFailed: vi.fn(() => () => undefined),
    } as any;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectURL || vi.fn(() => 'blob:preview-image'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectURL || vi.fn(),
    });
    vi.restoreAllMocks();
    delete window.electronAPI;
  });

  it('opens an immersive Workspace preview from a thumbnail and closes on background click', async () => {
    const image = createImage('alpha');

    render(
      <ComfyUIWorkspace
        image={image}
        navigationImages={[image]}
        currentIndex={0}
        isActive={false}
        onOpenQueue={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Preview alpha\.png/i }));

    const dialog = await screen.findByRole('dialog', { name: /Workspace image preview/i });
    expect(within(dialog).getByText('model.safetensors')).toBeTruthy();
    expect(within(dialog).getByText(/prompt for alpha\.png/i)).toBeTruthy();

    fireEvent.mouseDown(dialog);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Workspace image preview/i })).toBeNull();
    });
  });

  it('navigates the immersive preview with arrow keys', async () => {
    const first = createImage('alpha');
    const second = createImage('beta');

    render(
      <ComfyUIWorkspace
        image={first}
        navigationImages={[first, second]}
        currentIndex={0}
        isActive={false}
        onOpenQueue={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Preview alpha\.png/i }));
    await screen.findByRole('dialog', { name: /Workspace image preview/i });

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    await waitFor(() => {
      expect(within(screen.getByRole('dialog', { name: /Workspace image preview/i })).getByText('beta.png')).toBeTruthy();
    });
  });

  it('keeps metadata expanded while navigating and copies parameters', async () => {
    const first = createImage('alpha');
    const second = createImage('beta');

    render(
      <ComfyUIWorkspace
        image={first}
        navigationImages={[first, second]}
        currentIndex={0}
        isActive={false}
        onOpenQueue={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Preview alpha\.png/i }));
    const dialog = await screen.findByRole('dialog', { name: /Workspace image preview/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /Toggle metadata/i }));

    fireEvent.click(within(dialog).getByRole('button', { name: /Copy preview parameters/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Prompt: prompt for alpha.png'));
    });

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    await waitFor(() => {
      const updatedDialog = screen.getByRole('dialog', { name: /Workspace image preview/i });
      expect(within(updatedDialog).getByRole('button', { name: /Copy preview parameters/i })).toBeTruthy();
      expect(within(updatedDialog).getByText('beta.png')).toBeTruthy();
    });
  });
});

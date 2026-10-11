import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ComfyUIWorkspace from '../components/ComfyUIWorkspace';
import type { IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
const promptMocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../hooks/useSavePrompt', () => ({ useSavePrompt: () => promptMocks.save, buildSavedPromptSource: () => null }));
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({ canUseAdvancedPromptLibrary: true, canUseModelManager: true, showProModal: vi.fn() }) }));

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

describe('ComfyUIWorkspace image viewer entry point', () => {
  let originalCreateObjectURL: typeof URL.createObjectURL | undefined;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL | undefined;

  beforeEach(() => {
    localStorage.clear();
    promptMocks.save.mockReset().mockResolvedValue(undefined);
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
    cleanup();
    window.getSelection()?.removeAllRanges();
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

  it('inspects on single click and opens the full image viewer on double click or Enter', () => {
    const image = createImage('alpha');
    const onInspectImage = vi.fn();
    const onViewFullMetadata = vi.fn();

    render(
      <ComfyUIWorkspace
        image={image}
        navigationImages={[image]}
        currentIndex={0}
        isActive={false}
        onOpenQueue={vi.fn()}
        onOpenSettings={vi.fn()}
        onInspectImage={onInspectImage}
        onViewFullMetadata={onViewFullMetadata}
      />,
    );

    const thumbnail = screen.getByRole('button', { name: /Inspect alpha\.png/i });
    fireEvent.click(thumbnail);

    expect(onInspectImage).toHaveBeenCalledWith(image);
    expect(onViewFullMetadata).not.toHaveBeenCalled();

    fireEvent.doubleClick(thumbnail);

    expect(onViewFullMetadata).toHaveBeenCalledWith(image);

    onViewFullMetadata.mockClear();
    fireEvent.keyDown(thumbnail, { key: 'Enter' });

    expect(onViewFullMetadata).toHaveBeenCalledWith(image);
    expect(screen.queryByRole('dialog', { name: /Workspace image preview/i })).toBeNull();
  });

  it('saves node selections directly as untitled prompts or blocks without opening a form', async () => {
    let receive: (payload: { kind: 'prompt' | 'block'; text: string }) => void = () => {};
    const unsubscribe = vi.fn();
    window.electronAPI = { ...window.electronAPI, onComfyUISaveSelection: (callback: typeof receive) => { receive = callback; return unsubscribe; } } as never;
    const mutate = vi.spyOn(useSavedPromptStore.getState(), 'mutate').mockResolvedValue('saved');
    const image = createImage('node-selection');
    const view = render(<ComfyUIWorkspace image={image} isActive={false} onOpenQueue={vi.fn()} onOpenSettings={vi.fn()} />);
    const text = '  café\n<lora:test:1>  ';
    await act(async () => { receive({ kind: 'prompt', text }); });
    expect(mutate).toHaveBeenLastCalledWith({ action: 'create', kind: 'prompt', item: { positivePrompt: text } });
    expect(screen.getByText('Prompt saved.')).toBeTruthy();
    await act(async () => { receive({ kind: 'block', text }); });
    expect(mutate).toHaveBeenLastCalledWith({ action: 'create', kind: 'block', item: { text } });
    expect(screen.getByText('Block saved.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    view.unmount(); expect(unsubscribe).toHaveBeenCalled();
  });

  it('saves the image prompt and captures literal selected text before opening the block editor', async () => {
    const image = createImage('selection');
    image.metadata!.normalizedMetadata!.prompt = '  warm\n light  ';
    const mutate = vi.spyOn(useSavedPromptStore.getState(), 'mutate').mockResolvedValue('block');
    const view = render(<ComfyUIWorkspace image={image} navigationImages={[image]} currentIndex={0} isActive={false} directoryPath="C:/synthetic" onOpenQueue={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }));
    await waitFor(() => expect(promptMocks.save).toHaveBeenCalledWith(image, expect.objectContaining({ directoryPath: 'C:/synthetic' })));
    const prompt = view.container.querySelector('[data-prompt-text]')!;
    const range = document.createRange(); range.selectNodeContents(prompt);
    window.getSelection()!.addRange(range);
    fireEvent.contextMenu(prompt);
    const action = await screen.findByRole('button', { name: 'Save Selection as Block' });
    window.getSelection()!.removeAllRanges();
    fireEvent.click(action);
    expect((screen.getByLabelText('Block text') as HTMLTextAreaElement).value).toBe('  warm\n light  ');
    fireEvent.click(screen.getByRole('button', { name: 'Save block' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', kind: 'block', item: expect.objectContaining({ text: '  warm\n light  ' }) })));
    expect(window.electronAPI?.comfyUIViewOpen).not.toHaveBeenCalled();
  });
});

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ComfyUIWorkspace from '../components/ComfyUIWorkspace';
import type { IndexedImage } from '../types';
import * as fileIndexer from '../services/fileIndexer';
import { useImageStore } from '../store/useImageStore';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
vi.mock('react-virtualized-auto-sizer', () => ({ default: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) => children({ width: 320, height: 320 }) }));
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

  it('loads the original UI workflow from the source of a compacted image', async () => {
    const image = createImage('compacted');
    image.metadata = { ...image.metadata, _rawMetadataCompacted: true };
    const originalWorkflow = { nodes: [{ id: 8, type: 'CustomNode', pos: [300, 20] }], links: [] };
    const reparse = vi.spyOn(fileIndexer, 'reparseIndexedImage').mockResolvedValue({
      ...image,
      metadata: { ...image.metadata, workflow: JSON.stringify(originalWorkflow) },
    });
    const loadWorkflow = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI.comfyUIViewLoadWorkflow = loadWorkflow;

    render(<ComfyUIWorkspace
      image={image}
      navigationImages={[image]}

      directoryPath="C:/synthetic"
      isActive={false}
      workflowLoadRequest={{ id: 1, imageId: image.id, title: image.name, preferNewTab: true }}
      onOpenQueue={vi.fn()}
      onOpenSettings={vi.fn()}
    />);

    await waitFor(() => expect(loadWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      workflow: JSON.stringify(originalWorkflow),
      title: image.name,
      preferNewTab: true,
    })));
    expect(reparse).toHaveBeenCalledWith(image, 'C:/synthetic', { compactRawMetadata: false });
  });

  it('reports a missing original workflow without sending a generated graph to ComfyUI', async () => {
    const image = createImage('metadata-only');
    const loadWorkflow = vi.fn();
    window.electronAPI.comfyUIViewLoadWorkflow = loadWorkflow;

    render(<ComfyUIWorkspace
      image={image}
      navigationImages={[image]}

      isActive={false}
      workflowLoadRequest={{ id: 1, imageId: image.id, title: image.name, preferNewTab: true }}
      onOpenQueue={vi.fn()}
      onOpenSettings={vi.fn()}
    />);

    await waitFor(() => expect(useImageStore.getState().error).toBe('This image has no original ComfyUI workflow.'));
    expect(loadWorkflow).not.toHaveBeenCalled();
  });

  it('inspects on single click and opens the full image viewer on double click or Enter', () => {
    const image = createImage('alpha');
    const onInspectImage = vi.fn();
    const onViewFullMetadata = vi.fn();

    render(
      <ComfyUIWorkspace
        image={image}
        navigationImages={[image]}

        isActive={false}
        onOpenQueue={vi.fn()}
        onOpenSettings={vi.fn()}
        onInspectImage={onInspectImage}
        onViewFullMetadata={onViewFullMetadata}
      />,
    );

    const thumbnail = screen.getByRole('button', { name: /Inspect alpha\.png/i });
    expect(thumbnail.getAttribute('title')).toBe('alpha.png\n\nprompt for alpha.png');
    fireEvent.contextMenu(thumbnail, { clientX: 40, clientY: 400 });
    const menu = screen.getByRole('button', { name: 'Inspect Asset' }).parentElement!;
    expect(menu.style.bottom).toBe(`${window.innerHeight - 400}px`);
    expect(menu.style.top).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Asset' }));
    expect(onViewFullMetadata).toHaveBeenCalledWith(image);
    onViewFullMetadata.mockClear();

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

  it('searches the complete workspace scope before virtualizing and preserves the query across tabs', () => {
    const images = Array.from({ length: 220 }, (_, index) => ({
      ...createImage(`image-${index}`),
      directoryId: index === 99 || index === 100 || index === 101 ? 'matching' : 'other',
      models: index === 99 || index === 100 || index === 101 ? ['aurora'] : [],
      tags: index === 100 ? ['synthwave'] : [],
    }));
    const onOpenCompare = vi.fn();
    const args = { image: images[0], navigationImages: images, isActive: false,
      onOpenQueue: vi.fn(), onOpenSettings: vi.fn(), onOpenCompare };
    const view = render(<ComfyUIWorkspace {...args} />);

    const search = screen.getByRole('searchbox', { name: 'Search library' });
    expect(screen.getByText('220 images')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Inspect image-100\.png/ })).toBeNull();
    fireEvent.change(search, { target: { value: 'IMAGE-100 aurora synthwave' } });
    expect(screen.getByRole('button', { name: /Inspect image-100\.png/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
    expect((screen.getByRole('searchbox', { name: 'Search library' }) as HTMLInputElement).value).toBe('IMAGE-100 aurora synthwave');

    fireEvent.change(search, { target: { value: 'aurora' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select image-99.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select image-101.png' }), { shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Compare selected' }));
    expect(onOpenCompare).toHaveBeenCalledWith(images.slice(99, 102));
    fireEvent.change(search, { target: { value: 'absent' } });
    expect(screen.getByText('No matching images.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Compare selected' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search library' }));
    expect(screen.getByText('220 images')).toBeTruthy();

    view.rerender(<ComfyUIWorkspace {...args} selectedDirectoryId="matching" />);
    expect(screen.getByText('3 images')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'synthwave' } });
    expect(screen.getByText('1 image')).toBeTruthy();
    view.rerender(<ComfyUIWorkspace {...args} selectedDirectoryId="matching" applyLibraryFilters
      navigationImages={images.filter(candidate => candidate.id !== 'image-100')} />);
    expect(screen.getByText('No matching images.')).toBeTruthy();
  });

  it('allows saving an image without embedded prompt text through authoritative shadow validation', async () => {
    const image = createImage('shadow-only');
    image.metadata!.normalizedMetadata!.prompt = '';
    image.metadata!.normalizedMetadata!.negativePrompt = '';
    promptMocks.save.mockResolvedValue({ status: 'saved' });
    render(<ComfyUIWorkspace image={image} navigationImages={[image]} isActive={false} directoryPath="C:/synthetic" onOpenQueue={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: /Inspect shadow-only/ }));
    const button = screen.getByRole('button', { name: 'Save prompt' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(promptMocks.save).toHaveBeenCalledWith(image, { directoryPath: 'C:/synthetic', readAuthoritativeShadow: true }));
  });

});

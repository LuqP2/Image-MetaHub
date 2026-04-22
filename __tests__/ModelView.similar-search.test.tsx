import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModelView } from '../components/ModelView';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import type { IndexedImage } from '../types';

vi.mock('../hooks/useResolvedThumbnail', () => ({
  useResolvedThumbnail: () => ({
    thumbnailStatus: 'ready',
    thumbnailUrl: 'thumb://image',
  }),
}));

vi.mock('../hooks/useThumbnail', () => ({
  useThumbnail: vi.fn(),
}));

vi.mock('../contexts/A1111ProgressContext', () => ({
  useA1111ProgressContext: () => ({
    progressState: null,
  }),
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
  prompt: overrides.prompt ?? '',
  negativePrompt: overrides.negativePrompt ?? '',
  ...overrides,
});

describe('ModelView similar-search entry point', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
    useSettingsStore.getState().resetState();
    useSettingsStore.setState({
      itemsPerPage: -1,
      viewMode: 'grid',
      toggleViewMode: vi.fn(),
      setItemsPerPage: vi.fn(),
    } as any);
  });

  it('keeps primary card click for filtering and exposes a separate prompt-match action', () => {
    const onModelSelect = vi.fn();
    const onFindMatchingPrompts = vi.fn();
    const images = [
      createImage({ id: 'img-1', name: 'alpha.png', models: ['model-a'], prompt: 'Prompt A' }),
      createImage({ id: 'img-2', name: 'beta.png', models: ['model-a'], prompt: 'Prompt B' }),
    ];

    useImageStore.setState({
      images,
      filteredImages: images,
      selectionTotalImages: images.length,
      selectionDirectoryCount: 1,
      enrichmentProgress: null,
    } as any);

    render(<ModelView onModelSelect={onModelSelect} onFindMatchingPrompts={onFindMatchingPrompts} />);

    fireEvent.click(screen.getByText('model-a'));
    expect(onModelSelect).toHaveBeenCalledWith('model-a');

    fireEvent.click(screen.getByRole('button', { name: /find matching prompts for model-a/i }));
    expect(onFindMatchingPrompts).toHaveBeenCalledWith('model-a');
    expect(onModelSelect).toHaveBeenCalledTimes(1);
  });
});

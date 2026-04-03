import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import NodeView from '../components/NodeView';
import { type IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGenerationQueueStore } from '../store/useGenerationQueueStore';

vi.mock('../components/ImageGrid', () => ({
  default: ({ images }: { images: IndexedImage[] }) => (
    <div data-testid="node-grid">{images.map((image) => image.name).join(',')}</div>
  ),
}));

vi.mock('../components/ImageTable', () => ({
  default: ({ images }: { images: IndexedImage[] }) => (
    <div data-testid="node-table">{images.map((image) => image.name).join(',')}</div>
  ),
}));

vi.mock('../components/Footer', () => ({
  default: ({ customText }: { customText?: string }) => <div data-testid="node-footer">{customText}</div>,
}));

vi.mock('../contexts/A1111ProgressContext', () => ({
  useA1111ProgressContext: () => ({ progressState: null }),
}));

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: overrides.id ?? 'dir-1::image.png',
  name: overrides.name ?? 'image.png',
  handle: {} as FileSystemFileHandle,
  metadata: overrides.metadata ?? ({} as any),
  metadataString: overrides.metadataString ?? '',
  lastModified: overrides.lastModified ?? 1,
  models: overrides.models ?? [],
  loras: overrides.loras ?? [],
  scheduler: overrides.scheduler ?? '',
  workflowNodes: overrides.workflowNodes ?? [],
  ...overrides,
});

describe('NodeView', () => {
  beforeEach(() => {
    useImageStore.setState({
      selectionTotalImages: 4,
      selectionDirectoryCount: 1,
      enrichmentProgress: null,
    } as any);
    useSettingsStore.setState({
      itemsPerPage: 20,
      viewMode: 'grid',
      setItemsPerPage: vi.fn(),
      toggleViewMode: vi.fn(),
    } as any);
    useGenerationQueueStore.setState({
      items: [],
    } as any);
  });

  it('shows an empty state when there are no node-bearing images', () => {
    render(
      <NodeView
        images={[createImage({ id: '1', name: 'plain.png', workflowNodes: [] })]}
        selectedImages={new Set<string>()}
        onImageClick={vi.fn()}
        onBatchExport={vi.fn()}
      />
    );

    expect(screen.getByText('No embedded ComfyUI workflow nodes found')).toBeTruthy();
  });

  it('supports node search and OR-based multi-select filtering', () => {
    render(
      <NodeView
        images={[
          createImage({ id: '1', name: 'ksampler.png', workflowNodes: ['KSampler'] }),
          createImage({ id: '2', name: 'lora.png', workflowNodes: ['LoraLoader'] }),
          createImage({ id: '3', name: 'load.png', workflowNodes: ['LoadImage'] }),
          createImage({ id: '4', name: 'plain.png', workflowNodes: [] }),
        ]}
        selectedImages={new Set<string>()}
        onImageClick={vi.fn()}
        onBatchExport={vi.fn()}
      />
    );

    expect(screen.getByTestId('node-grid').textContent).toContain('ksampler.png,lora.png,load.png');

    fireEvent.change(screen.getByPlaceholderText('Search nodes...'), {
      target: { value: 'lora' },
    });
    expect(screen.getByRole('button', { name: /LoraLoader/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /KSampler/i })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Search nodes...'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /KSampler/i }));
    fireEvent.click(screen.getByRole('button', { name: /LoadImage/i }));

    expect(screen.getByTestId('node-grid').textContent).toContain('ksampler.png,load.png');
    expect(screen.getByTestId('node-grid').textContent).not.toContain('lora.png');
    expect(screen.getByTestId('node-footer').textContent).toContain('Showing 2 images across 2 selected nodes');
  });

  it('publishes the full filtered scope separately from the current page', () => {
    const onVisibleImagesChange = vi.fn();
    const onResultImagesChange = vi.fn();

    useSettingsStore.setState({
      itemsPerPage: 1,
      viewMode: 'grid',
      setItemsPerPage: vi.fn(),
      toggleViewMode: vi.fn(),
    } as any);

    render(
      <NodeView
        images={[
          createImage({ id: '1', name: 'ksampler.png', workflowNodes: ['KSampler'] }),
          createImage({ id: '2', name: 'load.png', workflowNodes: ['LoadImage'] }),
          createImage({ id: '3', name: 'plain.png', workflowNodes: [] }),
        ]}
        selectedImages={new Set<string>()}
        onImageClick={vi.fn()}
        onBatchExport={vi.fn()}
        onVisibleImagesChange={onVisibleImagesChange}
        onResultImagesChange={onResultImagesChange}
      />
    );

    expect(onVisibleImagesChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: '1' }),
    ]);
    expect(onResultImagesChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: '1' }),
      expect.objectContaining({ id: '2' }),
    ]);
  });
});

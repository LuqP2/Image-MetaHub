import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FindSimilarModal from '../components/FindSimilarModal';
import type { IndexedImage } from '../types';

vi.mock('../hooks/useResolvedThumbnail', () => ({
  useResolvedThumbnail: () => ({
    thumbnailStatus: 'ready',
    thumbnailUrl: 'thumb://image',
  }),
}));

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: overrides.id ?? 'dir-1::image.png',
  name: overrides.name ?? 'image.png',
  handle: overrides.handle ?? ({} as FileSystemFileHandle),
  metadata: overrides.metadata ?? ({ normalizedMetadata: { prompt: overrides.prompt ?? '' } } as any),
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

describe('FindSimilarModal', () => {
  it('opens with similarity defaults, ignores checkpoint by default, and can open a result image', async () => {
    const onOpenCompare = vi.fn();
    const onOpenImage = vi.fn();
    const source = createImage({
      id: 'source',
      name: 'source.png',
      prompt: 'Space cathedral',
      models: ['model-a'],
      lastModified: 100,
    });
    const altA = createImage({
      id: 'alt-a',
      name: 'alt-a.png',
      prompt: 'space   cathedral',
      models: ['model-b'],
      lastModified: 95,
    });
    const altB = createImage({
      id: 'alt-b',
      name: 'alt-b.png',
      prompt: 'Space cathedral',
      models: ['model-c'],
      lastModified: 90,
    });
    const altCNewest = createImage({
      id: 'alt-c-new',
      name: 'alt-c-new.png',
      prompt: 'Space cathedral',
      models: ['model-d'],
      lastModified: 85,
    });
    const altCOlder = createImage({
      id: 'alt-c-old',
      name: 'alt-c-old.png',
      prompt: 'Space cathedral',
      models: ['model-d'],
      lastModified: 80,
    });

    render(
      <FindSimilarModal
        isOpen
        sourceImage={source}
        allImages={[source, altA, altB, altCNewest, altCOlder]}
        currentViewImages={[source, altA, altB, altCNewest, altCOlder]}
        onClose={vi.fn()}
        onOpenImage={onOpenImage}
        onOpenCompare={onOpenCompare}
      />,
    );

    expect((screen.getByRole('checkbox', { name: /prompt/i }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: /lora names/i }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: /seed/i }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('Current view')).toBeTruthy();
    expect(screen.getByText('Any checkpoint')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Selected 3 of 3 compare slots.')).toBeTruthy();
    });

    expect(screen.getAllByText('100% prompt match').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /open alt-a\.png in image modal/i }));
    expect(onOpenImage).toHaveBeenCalledWith(altA);

    fireEvent.click(screen.getByRole('button', { name: /open in compare/i }));

    expect(onOpenCompare).toHaveBeenCalledWith([source, altA, altB, altCNewest]);
  });
});

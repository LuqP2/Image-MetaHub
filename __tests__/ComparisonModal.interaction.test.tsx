import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ComparisonModal from '../components/ComparisonModal';
import { useImageStore } from '../store/useImageStore';
import type { IndexedImage } from '../types';

vi.mock('../components/ComparisonPane', () => ({
  default: ({ image, onHoverChange }: { image: IndexedImage; onHoverChange?: (isHovered: boolean) => void }) => (
    <div
      data-testid={`pane-${image.id}`}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      {image.name}
    </div>
  ),
}));

vi.mock('../components/ComparisonOverlayView', () => ({
  default: () => <div data-testid="overlay-view">overlay</div>,
}));

vi.mock('../components/ComparisonMetadataPanel', () => ({
  default: ({
    image,
    isExpanded,
    isHighlighted,
  }: {
    image: IndexedImage;
    isExpanded: boolean;
    isHighlighted?: boolean;
  }) => (
    <div
      data-testid={`metadata-${image.id}`}
      data-expanded={isExpanded ? 'true' : 'false'}
      data-highlighted={isHighlighted ? 'true' : 'false'}
    >
      {image.name}
    </div>
  ),
}));

const createImage = (id: string, prompt: string): IndexedImage => ({
  id,
  name: `${id}.png`,
  handle: {} as FileSystemFileHandle,
  metadata: {
    normalizedMetadata: {
      prompt,
    },
  } as any,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  sampler: '',
  scheduler: '',
  directoryId: 'dir-1',
});

describe('ComparisonModal interactions', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
  });

  it('opens with metadata collapsed and highlights the matching metadata card on pane hover', () => {
    const first = createImage('img-1', 'first prompt');
    const second = createImage('img-2', 'second prompt');

    useImageStore.setState({
      comparisonImages: [first, second],
      directories: [{ id: 'dir-1', path: 'D:/library' }],
    } as any);

    render(<ComparisonModal isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId('metadata-img-1').getAttribute('data-expanded')).toBe('false');
    expect(screen.getByTestId('metadata-img-2').getAttribute('data-expanded')).toBe('false');

    fireEvent.mouseEnter(screen.getByTestId('pane-img-2'));
    expect(screen.getByTestId('metadata-img-1').getAttribute('data-highlighted')).toBe('false');
    expect(screen.getByTestId('metadata-img-2').getAttribute('data-highlighted')).toBe('true');

    fireEvent.mouseLeave(screen.getByTestId('pane-img-2'));
    expect(screen.getByTestId('metadata-img-2').getAttribute('data-highlighted')).toBe('false');
  });
});

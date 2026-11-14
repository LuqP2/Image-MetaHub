import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ComparisonModal from '../components/ComparisonModal';
import { useImageStore } from '../store/useImageStore';
import type { ComparisonPaneProps, IndexedImage } from '../types';
import { defaultComparisonUI, useComparisonUIStore } from '../store/useComparisonUIStore';

vi.mock('../components/ComparisonPane', () => ({
  default: ({
    image,
    onHoverChange,
    onRemove,
    externalZoom,
    onZoomChange,
  }: ComparisonPaneProps) => (
    <div
      data-testid={`pane-${image.id}`}
      data-zoom={JSON.stringify(externalZoom)}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      {image.name}
      <button type="button" onClick={() => onZoomChange?.(2, -100, -80)}>
        {`Zoom ${image.id}`}
      </button>
      <button type="button" onClick={() => onZoomChange?.(2, -60, -40, true)}>
        {`Apply zoom to ${image.id}`}
      </button>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${image.name} from comparison pane`}>
          Remove pane
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('../components/ComparisonOverlayView', () => ({
  default: ({ onVisualAnalysisChange }: { onVisualAnalysisChange?: (metrics: any) => void }) => {
    React.useEffect(() => {
      onVisualAnalysisChange?.({
        width: 100,
        height: 80,
        changedPixels: 25,
        totalPixels: 8000,
        changedPercent: 0.3125,
        averageDelta: 12,
        strongestRegion: { x: 10, y: 10, width: 20, height: 20, score: 90 },
      });
    }, [onVisualAnalysisChange]);

    return <div data-testid="overlay-view">overlay</div>;
  },
}));

vi.mock('../components/ComparisonMetadataPanel', () => ({
  default: ({
    image,
    isExpanded,
    isHighlighted,
    viewMode,
    onToggleExpanded,
  }: {
    image: IndexedImage;
    isExpanded: boolean;
    isHighlighted?: boolean;
    viewMode?: 'standard' | 'diff';
    onToggleExpanded?: () => void;
  }) => (
    <div
      data-testid={`metadata-${image.id}`}
      data-expanded={isExpanded ? 'true' : 'false'}
      data-highlighted={isHighlighted ? 'true' : 'false'}
      data-view-mode={viewMode}
    >
      {image.name}
      <button type="button" aria-label={`Toggle ${image.id}`} onClick={() => onToggleExpanded?.()}>
        Toggle
      </button>
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
    useComparisonUIStore.setState({ ui: defaultComparisonUI() });
  });

  it('keeps the follower transform when disabling Sync without rebroadcasting its clamped position', () => {
    const leader = createImage('leader', 'first prompt');
    const follower = createImage('follower', 'second prompt');
    const staleZoom = { zoom: 1.5, x: -10, y: -20 };
    useImageStore.setState({ comparisonImages: [leader, follower] });
    useComparisonUIStore.setState({
      ui: { ...defaultComparisonUI(), paneZooms: { [follower.id]: staleZoom } },
    });

    render(<ComparisonModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom leader' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply zoom to follower' }));

    expect(useComparisonUIStore.getState().ui.sharedZoom).toEqual({ zoom: 2, x: -100, y: -80 });
    fireEvent.click(screen.getByRole('button', { name: 'Sync: ON' }));

    expect(screen.getByTestId('pane-leader').getAttribute('data-zoom')).toBe(JSON.stringify({ zoom: 2, x: -100, y: -80 }));
    expect(screen.getByTestId('pane-follower').getAttribute('data-zoom')).toBe(JSON.stringify({ zoom: 2, x: -60, y: -40 }));
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

  it('expands every metadata panel together from a single toggle click', () => {
    const first = createImage('img-1', 'first prompt');
    const second = createImage('img-2', 'second prompt');

    useImageStore.setState({
      comparisonImages: [first, second],
      directories: [{ id: 'dir-1', path: 'D:/library' }],
    } as any);

    render(<ComparisonModal isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId('metadata-img-1').getAttribute('data-expanded')).toBe('false');
    expect(screen.getByTestId('metadata-img-2').getAttribute('data-expanded')).toBe('false');

    // Clicking a single panel's toggle should reveal all panels at once.
    fireEvent.click(screen.getByRole('button', { name: 'Toggle img-1' }));

    expect(screen.getByTestId('metadata-img-1').getAttribute('data-expanded')).toBe('true');
    expect(screen.getByTestId('metadata-img-2').getAttribute('data-expanded')).toBe('true');
  });

  it('defaults the metadata view to diff and toggles back to standard', () => {
    const first = createImage('img-1', 'first prompt');
    const second = createImage('img-2', 'second prompt');

    useImageStore.setState({
      comparisonImages: [first, second],
      directories: [{ id: 'dir-1', path: 'D:/library' }],
    } as any);

    render(<ComparisonModal isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId('metadata-img-1').getAttribute('data-view-mode')).toBe('diff');

    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);

    expect(screen.getByTestId('metadata-img-1').getAttribute('data-view-mode')).toBe('standard');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('enables advanced two-image modes and shows visual delta controls', () => {
    const first = createImage('img-1', 'first prompt');
    const second = createImage('img-2', 'second prompt');

    useImageStore.setState({
      comparisonImages: [first, second],
      directories: [{ id: 'dir-1', path: 'D:/library' }],
    } as any);

    render(<ComparisonModal isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Diff Map' }));

    expect(screen.getByTestId('overlay-view')).toBeTruthy();
    expect(screen.getByText('Visual Delta')).toBeTruthy();
    expect(screen.getByText('Metadata Delta')).toBeTruthy();
    expect(screen.getByText('Sensitivity')).toBeTruthy();
    expect(screen.getByText('Opacity')).toBeTruthy();
  });

  it('clears the visual delta panel when returning to side-by-side mode', async () => {
    const first = createImage('img-1', 'first prompt');
    const second = createImage('img-2', 'second prompt');

    useImageStore.setState({
      comparisonImages: [first, second],
      directories: [{ id: 'dir-1', path: 'D:/library' }],
    } as any);

    render(<ComparisonModal isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Diff Map' }));
    expect(screen.getByText('Visual Delta')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Side-by-Side' }));

    await waitFor(() => {
      expect(screen.queryByText('Visual Delta')).toBeNull();
    });
  });

  it('removes one pane from a 3-image comparison without closing the modal', () => {
    const first = createImage('img-1', 'first prompt');
    const second = createImage('img-2', 'second prompt');
    const third = createImage('img-3', 'third prompt');
    const onClose = vi.fn();

    useImageStore.setState({
      comparisonImages: [first, second, third],
      directories: [{ id: 'dir-1', path: 'D:/library' }],
    } as any);

    render(<ComparisonModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove img-2.png from comparison pane' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(useImageStore.getState().comparisonImages.map((image) => image.id)).toEqual(['img-1', 'img-3']);
  });
});

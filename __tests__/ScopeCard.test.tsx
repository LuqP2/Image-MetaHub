import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Box } from 'lucide-react';
import ScopeCard from '../components/ScopeCard';
import type { IndexedImage } from '../types';

// Resolve each image to a distinct thumbnail URL so the hover-scrub is observable.
vi.mock('../hooks/useResolvedThumbnail', () => ({
  useResolvedThumbnail: (image: IndexedImage | null) => ({
    thumbnailStatus: 'ready',
    thumbnailUrl: image ? `thumb://${image.id}` : null,
  }),
}));

vi.mock('../hooks/useThumbnail', () => ({
  useThumbnail: vi.fn(),
}));

const createImage = (id: string): IndexedImage => ({
  id,
  name: id,
  handle: {} as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  sampler: '',
  scheduler: '',
  directoryId: 'dir-1',
});

const images = [createImage('img-0'), createImage('img-1'), createImage('img-2')];

// Deferred requestAnimationFrame: store callbacks and flush them explicitly, so the
// component's `rafRef.current = requestAnimationFrame(cb)` assignment keeps its correct
// ordering (id assigned first, callback nulls it out on flush).
let rafCallbacks: Map<number, FrameRequestCallback>;
let rafId: number;
const flushRaf = () =>
  act(() => {
    const callbacks = [...rafCallbacks.values()];
    rafCallbacks.clear();
    callbacks.forEach((cb) => cb(0));
  });

beforeEach(() => {
  rafCallbacks = new Map();
  rafId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafId;
    rafCallbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => rafCallbacks.delete(id));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 125,
    right: 100,
    bottom: 125,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

describe('ScopeCard', () => {
  it('renders cover, title, count pill and subtitle', () => {
    render(
      <ScopeCard
        images={images}
        icon={Box}
        coverAlt="Alpha"
        countLabel={3}
        title="Alpha model"
        subtitle={<p>3 images</p>}
        onClick={() => undefined}
      />,
    );

    expect(screen.getByText('Alpha model')).toBeTruthy();
    expect(screen.getByText('3 images')).toBeTruthy();
    const cover = screen.getByAltText('Alpha') as HTMLImageElement;
    expect(cover.getAttribute('src')).toBe('thumb://img-0');
  });

  it('scrubs the cover image as the pointer moves across the card', () => {
    render(
      <ScopeCard images={images} icon={Box} coverAlt="Alpha" countLabel={3} title="Alpha" onClick={() => undefined} />,
    );
    const button = screen.getByRole('button');
    expect((screen.getByAltText('Alpha') as HTMLImageElement).getAttribute('src')).toBe('thumb://img-0');

    // Far-right pointer → last image.
    fireEvent.pointerMove(button, { clientX: 100 });
    flushRaf();
    expect((screen.getByAltText('Alpha') as HTMLImageElement).getAttribute('src')).toBe('thumb://img-2');

    // Leaving resets to the first image.
    fireEvent.pointerLeave(button);
    flushRaf();
    expect((screen.getByAltText('Alpha') as HTMLImageElement).getAttribute('src')).toBe('thumb://img-0');
  });

  it('does not scrub when disableScrub is set', () => {
    render(
      <ScopeCard
        images={images}
        icon={Box}
        coverAlt="Alpha"
        countLabel={3}
        title="Alpha"
        disableScrub
        onClick={() => undefined}
      />,
    );
    const button = screen.getByRole('button');
    fireEvent.pointerMove(button, { clientX: 100 });
    expect((screen.getByAltText('Alpha') as HTMLImageElement).getAttribute('src')).toBe('thumb://img-0');
  });

  it('renders badge and overlay slots', () => {
    render(
      <ScopeCard
        images={images}
        icon={Box}
        coverAlt="Alpha"
        countLabel={3}
        title="Alpha"
        badge={<span>Auto</span>}
        overlay={<span>Pro Only</span>}
        onClick={() => undefined}
      />,
    );
    expect(screen.getByText('Auto')).toBeTruthy();
    expect(screen.getByText('Pro Only')).toBeTruthy();
  });

  it('fires onClick when the card is clicked, and the secondary action stops propagation', () => {
    const onClick = vi.fn();
    const onSecondary = vi.fn();
    render(
      <ScopeCard
        images={images}
        icon={Box}
        coverAlt="Alpha"
        countLabel={3}
        title="Alpha"
        ariaLabel="Alpha card"
        onClick={onClick}
        secondaryAction={
          <div
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onSecondary();
            }}
          >
            Match
          </div>
        }
      />,
    );

    fireEvent.click(screen.getByText('Match'));
    expect(onSecondary).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Alpha card' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

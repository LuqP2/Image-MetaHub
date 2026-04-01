import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AnalyticsSummaryStrip from '../components/AnalyticsSummaryStrip';
import type { IndexedImage } from '../types';

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: overrides.id || 'img',
  name: overrides.name || 'img.png',
  handle: {} as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: overrides.lastModified || Date.now(),
  models: [],
  loras: [],
  sampler: '',
  scheduler: '',
  ...overrides,
});

describe('AnalyticsSummaryStrip', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('dismisses persistently without opening analytics', () => {
    const onOpenAnalytics = vi.fn();
    const images = [
      createImage({
        id: '1',
        models: ['Flux'],
        metadata: { normalizedMetadata: { _analytics: { gpu_device: 'RTX 4090' } } } as any,
      }),
    ];

    const { unmount } = render(
      <AnalyticsSummaryStrip
        images={images}
        allImages={images}
        onOpenAnalytics={onOpenAnalytics}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss analytics summary' }));

    expect(onOpenAnalytics).not.toHaveBeenCalled();
    expect(screen.queryByText('Analytics Explorer')).toBeNull();
    expect(window.localStorage.getItem('analytics-summary-strip-dismissed')).toBe('true');

    unmount();

    render(
      <AnalyticsSummaryStrip
        images={images}
        allImages={images}
        onOpenAnalytics={onOpenAnalytics}
      />
    );

    expect(screen.queryByText('Analytics Explorer')).toBeNull();
  });
});

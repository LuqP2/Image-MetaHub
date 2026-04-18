import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Analytics from '../components/Analytics';
import { useImageStore } from '../store/useImageStore';
import { useLicenseStore } from '../store/useLicenseStore';
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

describe('Analytics Explorer', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
    useLicenseStore.setState({ initialized: true, licenseStatus: 'pro' });

    const images = [
      createImage({
        id: '1',
        name: 'one.png',
        models: ['Flux'],
        metadata: { normalizedMetadata: { generator: 'ComfyUI', _analytics: { gpu_device: 'RTX 4090', generation_time_ms: 4200 } } } as any,
      }),
      createImage({
        id: '2',
        name: 'two.png',
        models: ['SDXL'],
        metadata: { normalizedMetadata: { generator: 'InvokeAI' } } as any,
      }),
      createImage({
        id: '3',
        name: 'three.png',
        models: ['Flux'],
        metadata: { normalizedMetadata: { generator: 'ComfyUI', _analytics: { generation_time_ms: 5000 } } } as any,
      }),
    ];

    useImageStore.setState({
      images,
      filteredImages: images,
      selectedGenerators: [],
      excludedGenerators: [],
      selectedGpuDevices: [],
      excludedGpuDevices: [],
      selectedModels: [],
      excludedModels: [],
      selectedLoras: [],
      excludedLoras: [],
      selectedSamplers: [],
      excludedSamplers: [],
      selectedSchedulers: [],
      excludedSchedulers: [],
      selectedRatings: [],
      advancedFilters: {},
      favoriteFilterMode: 'neutral',
    });
  });

  it('applies include and exclude facet interactions to the global filter state', () => {
    render(<Analytics isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Full Library' }));
    fireEvent.click(screen.getByRole('button', { name: 'resources' }));
    fireEvent.click(screen.getAllByRole('button', { name: /ComfyUI/i })[0]);
    expect(useImageStore.getState().selectedGenerators).toEqual(['ComfyUI']);

    fireEvent.click(screen.getAllByRole('button', { name: /ComfyUI/i })[0], { altKey: true });
    expect(useImageStore.getState().selectedGenerators).toEqual([]);
    expect(useImageStore.getState().excludedGenerators).toEqual(['ComfyUI']);
  });

  it('promotes telemetry compare cohorts using the same telemetry predicate', () => {
    render(<Analytics isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Full Library' }));
    fireEvent.change(screen.getByDisplayValue('Generator'), { target: { value: 'telemetry' } });

    const promoteButtons = screen.getAllByRole('button', { name: /Promote to global filter/i });

    fireEvent.click(promoteButtons[0]);
    expect(useImageStore.getState().advancedFilters.telemetryState).toBe('present');
    expect(useImageStore.getState().advancedFilters.hasVerifiedTelemetry).toBeUndefined();

    fireEvent.click(promoteButtons[1]);
    expect(useImageStore.getState().advancedFilters.telemetryState).toBe('missing');
    expect(useImageStore.getState().advancedFilters.hasVerifiedTelemetry).toBeUndefined();
  });

  it('marks numeric bucket filters with an exclusive upper bound', () => {
    render(<Analytics isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'performance' }));
    fireEvent.click(screen.getByRole('button', { name: /1000-5000ms/i }));

    expect(useImageStore.getState().advancedFilters.generationTimeMs).toEqual({
      min: 1000,
      max: 5000,
      maxExclusive: true,
    });
  });

  it('counts gpu-only telemetry in coverage cards', () => {
    const images = [
      createImage({
        id: 'gpu-only',
        name: 'gpu-only.png',
        models: ['Flux'],
        metadata: { normalizedMetadata: { generator: 'ComfyUI', _analytics: { gpu_device: 'RTX 4090' } } } as any,
      }),
      createImage({
        id: 'none',
        name: 'none.png',
        models: ['SDXL'],
        metadata: { normalizedMetadata: { generator: 'InvokeAI' } } as any,
      }),
    ];

    useImageStore.getState().resetState();
    useImageStore.setState({
      images,
      filteredImages: images,
      selectedGenerators: [],
      excludedGenerators: [],
      selectedGpuDevices: [],
      excludedGpuDevices: [],
      selectedModels: [],
      excludedModels: [],
      selectedLoras: [],
      excludedLoras: [],
      selectedSamplers: [],
      excludedSamplers: [],
      selectedSchedulers: [],
      excludedSchedulers: [],
      selectedRatings: [],
      advancedFilters: {},
      favoriteFilterMode: 'neutral',
    });

    render(<Analytics isOpen onClose={vi.fn()} />);

    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('1 images with performance data')).toBeTruthy();
  });
});

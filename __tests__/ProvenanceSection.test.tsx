import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProvenanceSection from '../components/ProvenanceSection';
import { useImageStore } from '../store/useImageStore';
import type { BaseMetadata, IndexedImage } from '../types';

const createImage = (id: string, metadata: IndexedImage['metadata'] = {}): IndexedImage => ({
  id,
  name: `${id}.png`,
  handle: { _filePath: `D:\\library\\${id}.png` } as FileSystemFileHandle,
  metadata,
  metadataString: '',
  lastModified: 1,
  fileSize: 100,
  models: [],
  loras: [],
  scheduler: '',
  directoryId: 'library',
});

describe('ProvenanceSection evidence hydration', () => {
  const originalElectronApi = window.electronAPI;

  beforeEach(() => {
    useImageStore.getState().resetState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: originalElectronApi,
    });
  });

  it('cancels a pending fingerprint when navigation supersedes it', async () => {
    let resolveHash: ((result: { success: boolean; sha256: string }) => void) | undefined;
    const hashFileSha256 = vi.fn(() => new Promise<{ success: boolean; sha256: string }>((resolve) => {
      resolveHash = resolve;
    }));
    const cancelFileSha256 = vi.fn();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { hashFileSha256, cancelFileSha256 },
    });
    const first = createImage('first');
    const second = createImage('second');
    const { rerender } = render(<ProvenanceSection image={first} displayMode="details-compact" />);

    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(hashFileSha256).toHaveBeenCalledTimes(1));
    const requestId = hashFileSha256.mock.calls[0][1];

    rerender(<ProvenanceSection image={second} displayMode="details-compact" />);
    await waitFor(() => expect(cancelFileSha256).toHaveBeenCalledWith(requestId));
    await act(async () => resolveHash?.({ success: true, sha256: 'stale-digest' }));

    expect(screen.queryByText('stale-digest')).toBeNull();
    expect(screen.getByText('Not calculated')).toBeTruthy();
  });

  it('cancels a pending fingerprint when the provenance view unmounts', async () => {
    const hashFileSha256 = vi.fn(() => new Promise<{ success: boolean }>(() => {}));
    const cancelFileSha256 = vi.fn();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { hashFileSha256, cancelFileSha256 },
    });
    const { unmount } = render(<ProvenanceSection image={createImage('closing')} />);

    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(hashFileSha256).toHaveBeenCalledTimes(1));
    const requestId = hashFileSha256.mock.calls[0][1];
    unmount();

    expect(cancelFileSha256).toHaveBeenCalledWith(requestId);
  });

  it('invalidates a completed fingerprint when the file revision changes', async () => {
    const hashFileSha256 = vi.fn().mockResolvedValue({ success: true, sha256: 'first-digest' });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { hashFileSha256, cancelFileSha256: vi.fn() },
    });
    const firstRevision = createImage('same-file');
    const { rerender } = render(<ProvenanceSection image={firstRevision} displayMode="details-compact" />);

    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(await screen.findByText('first-digest')).toBeTruthy();

    rerender(<ProvenanceSection
      image={{ ...firstRevision, lastModified: 2, contentModifiedMs: 2, fileSize: 101 }}
      displayMode="details-compact"
    />);

    expect(screen.queryByText('first-digest')).toBeNull();
    expect(screen.getByText('Not calculated')).toBeTruthy();
  });

  it('forces legacy source hydration and blocks copying until it finishes', async () => {
    const normalizedMetadata = {
      generator: 'Easy Diffusion',
      prompt: 'sidecar prompt',
    } as BaseMetadata;
    const image = createImage('legacy-sidecar', { normalizedMetadata });
    let resolveHydration: ((image: IndexedImage) => void) | undefined;
    const loadFullRawMetadata = vi.fn(() => new Promise<IndexedImage>((resolve) => {
      resolveHydration = resolve;
    }));

    render(
      <ProvenanceSection
        image={image}
        metadata={normalizedMetadata}
        rawMetadata={image.metadata}
        loadFullRawMetadata={loadFullRawMetadata}
      />,
    );

    await waitFor(() => expect(loadFullRawMetadata).toHaveBeenCalledWith({ force: true }));
    expect((screen.getByRole('button', { name: 'Loading…' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => resolveHydration?.({
      ...image,
      metadata: {
        normalizedMetadata,
        _provenanceMetadataSource: 'sidecar',
      } as IndexedImage['metadata'],
    }));

    expect((await screen.findAllByText('Sidecar metadata')).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'Copy summary' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('attempts forced hydration only once for the same file revision', async () => {
    const normalizedMetadata = {
      media_type: 'model3d',
      generator: 'Image MetaHub',
      model: 'trellis',
    } as BaseMetadata;
    const image = createImage('legacy-model', { normalizedMetadata });
    const firstLoader = vi.fn().mockResolvedValue(image);
    const { rerender } = render(
      <ProvenanceSection
        image={image}
        metadata={normalizedMetadata}
        rawMetadata={image.metadata}
        loadFullRawMetadata={firstLoader}
      />,
    );
    await waitFor(() => expect(firstLoader).toHaveBeenCalledTimes(1));

    const recreatedLoader = vi.fn().mockResolvedValue(image);
    rerender(
      <ProvenanceSection
        image={image}
        metadata={normalizedMetadata}
        rawMetadata={image.metadata}
        loadFullRawMetadata={recreatedLoader}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy summary' })).toBeTruthy());
    expect(recreatedLoader).not.toHaveBeenCalled();
  });

  it('caps derived relationships at four through the store lookup', () => {
    const source = createImage('source');
    const derived = Array.from({ length: 6 }, (_, index) => createImage(`derived-${index + 1}`));
    useImageStore.setState({
      images: [source, ...derived],
      filteredImages: [source, ...derived],
      lineageDerivedIdsBySourceId: { [source.id]: derived.map((image) => image.id) },
    });

    render(<ProvenanceSection image={source} />);

    for (const image of derived.slice(0, 4)) {
      expect(screen.getByText(`Derived image: ${image.name}`)).toBeTruthy();
    }
    expect(screen.queryByText(`Derived image: ${derived[4].name}`)).toBeNull();
  });
});

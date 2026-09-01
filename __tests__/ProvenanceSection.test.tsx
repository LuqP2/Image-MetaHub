import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  beforeEach(() => {
    useImageStore.getState().resetState();
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

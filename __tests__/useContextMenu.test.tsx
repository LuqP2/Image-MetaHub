import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContextMenu } from '../hooks/useContextMenu';
import { useImageStore } from '../store/useImageStore';
import type { IndexedImage } from '../types';

vi.mock('../contexts/A1111ProgressContext', () => ({
  useA1111ProgressContext: () => ({
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
  }),
}));

vi.mock('../hooks/useFeatureAccess', () => ({
  useFeatureAccess: () => ({
    canUseA1111: true,
    showProModal: vi.fn(),
  }),
}));

const imageFixture: IndexedImage = {
  id: 'img-1',
  name: 'alpha.png',
  handle: {} as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: 1,
  directoryId: 'dir-1',
  models: [],
  loras: [],
  scheduler: '',
  workflowNodes: [],
};

const Harness = ({ image }: { image: IndexedImage }) => {
  const { showContextMenu, exportImage } = useContextMenu();

  return (
    <div>
      <button onContextMenu={(event) => showContextMenu(event, image, 'D:/library')}>Open</button>
      <button onClick={exportImage}>Export</button>
    </div>
  );
};

describe('useContextMenu export targeting', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
  });

  it('exports the full current selection when the clicked image is part of it', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    useImageStore.setState({
      selectedImages: new Set(['img-1', 'img-2', 'img-3']),
    } as any);

    render(<Harness image={imageFixture} />);

    fireEvent.contextMenu(screen.getByText('Open'), { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByText('Export'));

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'imagemetahub:open-batch-export',
          detail: {
            imageIds: ['img-1', 'img-2', 'img-3'],
            preferredSource: 'selected',
          },
        })
      );
    });

    dispatchSpy.mockRestore();
  });

  it('exports only the clicked image when it is outside the current selection', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    useImageStore.setState({
      selectedImages: new Set(['img-2', 'img-3']),
    } as any);

    render(<Harness image={imageFixture} />);

    fireEvent.contextMenu(screen.getByText('Open'), { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByText('Export'));

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'imagemetahub:open-batch-export',
          detail: {
            imageIds: ['img-1'],
            preferredSource: 'selected',
          },
        })
      );
    });

    dispatchSpy.mockRestore();
  });
});

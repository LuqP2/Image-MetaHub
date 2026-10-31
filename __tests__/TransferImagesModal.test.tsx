import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TransferImagesModal, { resetTransferDestinationSession } from '../components/TransferImagesModal';

declare global {
  interface Window {
    electronAPI?: any;
  }
}

describe('TransferImagesModal', () => {
  afterEach(() => {
    cleanup(); resetTransferDestinationSession();
    vi.restoreAllMocks();
    delete window.electronAPI;
  });

  it('lists nested destination folders returned by Electron', async () => {
    window.electronAPI = {
      listSubfolders: vi.fn(async (folderPath: string) => {
        if (folderPath === '/Output') {
          return {
            success: true,
            subfolders: [{ name: 'Nested', path: '/Output/Nested', realPath: '/Volumes/Raid/Nested' }],
          };
        }
        return { success: true, subfolders: [] };
      }),
    };

    render(
      <TransferImagesModal
        isOpen
        images={[{ id: '/Output::a.png', name: 'a.png' } as any]}
        directories={[{ id: '/Output', name: 'Output', path: '/Output' } as any]}
        mode="move"
        isSubmitting={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Nested')).toBeTruthy();
    });
    // Each folder row exposes its full path as a title (tooltip) rather than as
    // inline text, so assert the nested folder is rendered with the right path.
    expect(screen.getByTitle('/Output/Nested')).toBeTruthy();
  });
  it('restores the destination, collapsed roots and scroll across Copy/Move remounts', async () => {
    window.electronAPI = { listSubfolders: vi.fn(async (path: string) => ({ success: true, subfolders: path === '/Output' ? [{ name: 'Nested', path: '/Output/Nested' }] : [] })) };
    const props = { isOpen: true, images: [] as any[], directories: [{ id: '/Output', name: 'Output', path: '/Output' }] as any[], isSubmitting: false, onClose: vi.fn(), onConfirm: vi.fn() };
    const first = render(<TransferImagesModal {...props} mode="move" />);
    fireEvent.click(await screen.findByTitle('/Output/Nested'));
    fireEvent.click(screen.getByLabelText('Collapse folder'));
    const tree = screen.getByLabelText('Destination folders');
    tree.scrollTop = 75; fireEvent.scroll(tree);
    first.unmount();
    render(<TransferImagesModal {...props} mode="copy" />);
    await waitFor(() => expect(screen.getByLabelText('Expand folder')).toBeTruthy());
    expect(screen.queryByText('Nested')).toBeNull();
    await waitFor(() => expect(screen.getByLabelText('Destination folders').scrollTop).toBe(75));
    fireEvent.click(screen.getByRole('button', { name: 'Copy 0 images' }));
    expect(props.onConfirm).toHaveBeenCalledWith(expect.objectContaining({ destinationRelativePath: 'Nested' }));
  });

});

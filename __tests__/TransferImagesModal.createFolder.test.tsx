import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import TransferImagesModal from '../components/TransferImagesModal';
import type { Directory } from '../types';

const directory = {
  id: 'dir-1',
  name: 'Renders',
  path: '/root/Renders',
} as unknown as Directory;

const baseProps = {
  isOpen: true,
  images: [],
  directories: [directory],
  mode: 'move' as const,
  isSubmitting: false,
  onClose: () => {},
  onConfirm: () => {},
};

describe('TransferImagesModal — Create New Folder', () => {
  let createSubfolder: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createSubfolder = vi.fn().mockResolvedValue({
      success: true,
      folder: { name: 'Keepers', path: '/root/Renders/Keepers', realPath: '/root/Renders/Keepers' },
    });
    (window as any).electronAPI = {
      listSubfolders: vi.fn().mockResolvedValue({ success: true, subfolders: [] }),
      createSubfolder,
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('creates a subfolder under the selected destination and selects it', async () => {
    render(<TransferImagesModal {...baseProps} />);

    // Wait for the root option to be present and selected.
    await screen.findByText('Renders');

    fireEvent.click(screen.getByText('New folder'));

    const input = screen.getByPlaceholderText('Folder name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Keepers' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(createSubfolder).toHaveBeenCalledWith('/root/Renders', 'Keepers');
    });

    // The new folder shows up as a destination option.
    await screen.findByText('Keepers');
  });

  it('shows a validation error for an invalid name without calling the API', async () => {
    render(<TransferImagesModal {...baseProps} />);
    await screen.findByText('Renders');

    fireEvent.click(screen.getByText('New folder'));
    const input = screen.getByPlaceholderText('Folder name');
    fireEvent.change(input, { target: { value: 'bad/name' } });
    fireEvent.click(screen.getByText('Create'));

    await screen.findByText('Folder name contains invalid characters.');
    expect(createSubfolder).not.toHaveBeenCalled();
  });

  it('keeps a created folder when a slow subfolder scan resolves afterwards', async () => {
    let resolveList: (value: unknown) => void = () => {};
    const listPromise = new Promise((resolve) => { resolveList = resolve; });
    (window as any).electronAPI = {
      listSubfolders: vi.fn().mockReturnValue(listPromise),
      createSubfolder: vi.fn().mockResolvedValue({
        success: true,
        folder: { name: 'Keepers', path: '/root/Renders/Keepers', realPath: '/root/Renders/Keepers' },
      }),
    };

    render(<TransferImagesModal {...baseProps} />);
    // Root option is available immediately, before the (still pending) scan.
    await screen.findByText('Renders');

    fireEvent.click(screen.getByText('New folder'));
    fireEvent.change(screen.getByPlaceholderText('Folder name'), { target: { value: 'Keepers' } });
    fireEvent.click(screen.getByText('Create'));
    await screen.findByText('Keepers');

    // The slow scan now finishes with an older set that does not include the new folder.
    resolveList({ success: true, subfolders: [{ name: 'Old', path: '/root/Renders/Old', realPath: '/root/Renders/Old' }] });
    await screen.findByText('Old');

    // The just-created folder must survive the scan replacing subfolderOptions.
    expect(screen.getByText('Keepers')).toBeTruthy();
  });

  it('derives the relative path from the selected parent even if the backend returns a resolved (symlink) path', async () => {
    // Simulate the IPC resolving the parent's realpath: the returned folder.path
    // is NOT a textual child of the root directory. The new option must still get
    // a correct, non-empty relative path derived from the selected parent.
    createSubfolder.mockResolvedValueOnce({
      success: true,
      folder: { name: 'Keepers', path: '/mnt/real-target/Keepers', realPath: '/mnt/real-target/Keepers' },
    });

    render(<TransferImagesModal {...baseProps} />);
    await screen.findByText('Renders');

    fireEvent.click(screen.getByText('New folder'));
    fireEvent.change(screen.getByPlaceholderText('Folder name'), { target: { value: 'Keepers' } });
    fireEvent.click(screen.getByText('Create'));

    // The row renders its relativePath as the label; it must be 'Keepers', not empty.
    const label = await screen.findByText('Keepers');
    expect(label).toBeTruthy();
  });

  it('surfaces a backend error (e.g. duplicate folder)', async () => {
    createSubfolder.mockResolvedValueOnce({ success: false, error: 'A folder with that name already exists.' });
    render(<TransferImagesModal {...baseProps} />);
    await screen.findByText('Renders');

    fireEvent.click(screen.getByText('New folder'));
    fireEvent.change(screen.getByPlaceholderText('Folder name'), { target: { value: 'Keepers' } });
    fireEvent.click(screen.getByText('Create'));

    await screen.findByText('A folder with that name already exists.');
  });
});

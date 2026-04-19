import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TransferImagesModal from '../components/TransferImagesModal';

declare global {
  interface Window {
    electronAPI?: any;
  }
}

describe('TransferImagesModal', () => {
  afterEach(() => {
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
    expect(screen.getByText('/Output/Nested')).toBeTruthy();
  });
});

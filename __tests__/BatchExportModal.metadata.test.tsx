import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BatchExportModal from '../components/BatchExportModal';

const exportBatchToFolder = vi.fn();
const onExportBatchProgress = vi.fn(() => vi.fn());

describe('BatchExportModal metadata mode', () => {
  beforeEach(() => {
    exportBatchToFolder.mockReset();
    exportBatchToFolder.mockResolvedValue({ success: true, exportedCount: 1, failedCount: 0 });
    onExportBatchProgress.mockClear();

    (window as any).electronAPI = {
      onExportBatchProgress,
      showDirectoryDialog: vi.fn().mockResolvedValue({ success: true, canceled: false, path: 'D:/exports' }),
      showSaveDialog: vi.fn(),
      exportBatchToFolder,
      exportBatchToZip: vi.fn(),
      showItemInFolder: vi.fn(),
    };
  });

  it('sends strip mode for folder exports', async () => {
    render(
      <BatchExportModal
        isOpen
        onClose={vi.fn()}
        selectedImageIds={new Set(['img-1'])}
        filteredImages={[
          {
            id: 'img-1',
            name: 'portrait.png',
            directoryId: 'dir-1',
            metadata: {},
            metadataString: '',
          } as any,
        ]}
        directories={[{ id: 'dir-1', path: 'D:/library' }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove embedded metadata' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => {
      expect(exportBatchToFolder).toHaveBeenCalledWith(expect.objectContaining({
        metadataMode: 'strip',
        destDir: 'D:/exports',
      }));
    });
  });
});

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmbeddedMetadataEditorModal from '../components/EmbeddedMetadataEditorModal';

const writeEmbeddedMetadata = vi.fn();

describe('EmbeddedMetadataEditorModal', () => {
  beforeEach(() => {
    writeEmbeddedMetadata.mockReset();
    (window as any).electronAPI = {
      joinPaths: vi.fn().mockResolvedValue({ success: true, path: 'D:/library/image.png' }),
      getEmbeddedMetadataBackupStatus: vi.fn().mockResolvedValue({ success: true, hasBackup: false }),
      writeEmbeddedMetadata,
      restoreEmbeddedMetadataBackup: vi.fn(),
    };

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue(JSON.stringify({
          prompt: 'pasted prompt',
          negativePrompt: 'pasted negative',
          seed: 99,
          steps: 30,
          cfg_scale: 8,
          sampler: 'euler',
          model: 'model-a',
          width: 640,
          height: 832,
        })),
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('pastes metadata into the form without writing the file', async () => {
    render(
      <EmbeddedMetadataEditorModal
        isOpen
        image={{
          id: 'img-1',
          name: 'image.png',
          metadataString: '',
          metadata: { normalizedMetadata: { prompt: 'original', width: 512, height: 512 } },
        } as any}
        directoryPath="D:/library"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByText('Edit File Metadata')).toBeTruthy();
    expect(screen.getByText('Writes to the image file. A backup is saved before the first write.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Paste Metadata' }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('pasted prompt')).toBeTruthy();
    });
    expect(screen.getByDisplayValue('pasted negative')).toBeTruthy();
    expect(writeEmbeddedMetadata).not.toHaveBeenCalled();
  });
});

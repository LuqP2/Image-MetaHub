import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LibrarySettingsPanel } from '../components/settings/LibrarySettingsPanel';
import { useSettingsStore } from '../store/useSettingsStore';

describe('LibrarySettingsPanel cache location', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetState();
  });

  afterEach(() => {
    cleanup();
    delete window.electronAPI;
  });

  it('shows an observable error when the authorized directory cannot be opened', async () => {
    window.electronAPI = {
      getRuntimeInfo: vi.fn().mockResolvedValue({
        isPortable: false,
        userDataPath: 'C:\\UserData',
        autoUpdateSupported: true,
      }),
      getDefaultCachePath: vi.fn().mockResolvedValue({ success: true, path: 'C:\\UserData' }),
      openCacheLocation: vi.fn().mockResolvedValue({ success: false, error: 'Access denied' }),
    } as any;

    render(<LibrarySettingsPanel onClose={() => {}} />);

    const button = await screen.findByRole('button', { name: 'Open location' });
    await waitFor(() => expect(screen.getByText('C:\\UserData')).toBeTruthy());
    fireEvent.click(button);

    expect((await screen.findByRole('alert')).textContent).toBe('Access denied');
    expect(window.electronAPI.openCacheLocation).toHaveBeenCalledWith();
  });
});

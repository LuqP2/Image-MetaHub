import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LibrarySettingsPanel } from '../components/settings/LibrarySettingsPanel';
import { useSemanticStore } from '../store/useSemanticStore';
import { useSettingsStore } from '../store/useSettingsStore';

describe('LibrarySettingsPanel cache location', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetState();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

  it('stops visual-search jobs before changing the cache root', async () => {
    let finishTeardown!: () => void;
    const teardown = vi.spyOn(useSemanticStore.getState(), 'teardown').mockReturnValue(
      new Promise<void>((resolve) => { finishTeardown = resolve; }),
    );
    window.electronAPI = {
      getRuntimeInfo: vi.fn().mockResolvedValue({
        isPortable: false,
        userDataPath: 'C:\\UserData',
        autoUpdateSupported: true,
      }),
      getDefaultCachePath: vi.fn().mockResolvedValue({ success: true, path: 'C:\\UserData' }),
      showDirectoryDialog: vi.fn().mockResolvedValue({ success: true, path: 'D:\\NewCache' }),
      getSettings: vi.fn().mockResolvedValue({}),
      saveSettings: vi.fn().mockResolvedValue({ success: true }),
    } as any;

    render(<LibrarySettingsPanel onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change location' }));

    await waitFor(() => expect(teardown).toHaveBeenCalledTimes(1));
    expect(useSettingsStore.getState().cachePath).toBeNull();
    finishTeardown();
    await waitFor(() => expect(useSettingsStore.getState().cachePath).toBe('D:\\NewCache'));
  });
});

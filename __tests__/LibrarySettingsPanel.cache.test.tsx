import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LibrarySettingsPanel } from '../components/settings/LibrarySettingsPanel';
import { useSemanticStore } from '../store/useSemanticStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { LIBRARY_CACHE_REBUILD_KEY } from '../utils/cacheReset';

describe('LibrarySettingsPanel cache location', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetState();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.removeItem(LIBRARY_CACHE_REBUILD_KEY);
    delete window.electronAPI;
  });

  it('disables cache clearing while pending and announces the reload after success', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // Hold the paint callback so this test can observe the status without navigating.
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    let finishClear!: (result: { success: boolean }) => void;
    const clearLibraryCache = vi.fn(() => new Promise<{ success: boolean }>((resolve) => {
      finishClear = resolve;
    }));
    window.electronAPI = {
      getDefaultCachePath: vi.fn().mockResolvedValue({ success: false }),
      clearLibraryCache,
    } as any;

    render(<LibrarySettingsPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear library cache' }));
    const clearingButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Clearing library cache…' });
    expect(clearingButton.disabled).toBe(true);
    fireEvent.click(clearingButton);
    expect(clearLibraryCache).toHaveBeenCalledTimes(1);

    await act(async () => finishClear({ success: true }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reloading library…' }).disabled).toBe(true);
    expect(sessionStorage.getItem(LIBRARY_CACHE_REBUILD_KEY)).toBe('1');
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

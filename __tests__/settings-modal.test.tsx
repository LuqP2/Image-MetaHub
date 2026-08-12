import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SettingsModal from '../components/SettingsModal';
import { LibrarySettingsPanel } from '../components/settings/LibrarySettingsPanel';
import { useSettingsStore } from '../store/useSettingsStore';
import type { PortableStorageStatus } from '../types';

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.getState().resetState();
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
  });

  it('maps the legacy general tab to the Library panel', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} initialTab="general" />);

    expect(screen.getByRole('heading', { name: 'Library' })).toBeTruthy();
  });

  it('maps the legacy hotkeys tab to the Shortcuts panel', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} initialTab="hotkeys" />);

    expect(screen.getByRole('heading', { name: 'Shortcuts' })).toBeTruthy();
  });

  it('opens the license panel when focusSection is license', async () => {
    render(
      <SettingsModal
        isOpen={true}
        onClose={() => {}}
        initialTab="general"
        focusSection="license"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Support / License' })).toBeTruthy();
    });
  });

  it('shows and can cancel the portable mode configured for the next launch', async () => {
    const pendingStatus: PortableStorageStatus = {
      success: true,
      enabled: false,
      nextLaunchEnabled: true,
      source: 'not-configured',
      baseDir: 'D:\\ImageMetaHub',
      markerPath: 'D:\\ImageMetaHub\\portable.txt',
      dataDir: 'C:\\Users\\test\\AppData\\Roaming\\image-metahub',
      candidateDataDir: 'D:\\ImageMetaHub\\data',
      managedByEnv: false,
      markerFileNames: ['portable.txt', '.portable'],
      error: null,
    };
    const currentStatus = { ...pendingStatus, nextLaunchEnabled: false, markerPath: null };
    const getPortableStorageStatus = vi.fn()
      .mockResolvedValueOnce(pendingStatus)
      .mockResolvedValueOnce(currentStatus);
    const setPortableStorageEnabled = vi.fn().mockResolvedValue({ success: true, needsRestart: true });

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        getDefaultCachePath: vi.fn().mockResolvedValue({ success: true, path: 'C:\\cache' }),
        getPortableStorageStatus,
        setPortableStorageEnabled,
        restartApp: vi.fn(),
      } as unknown as NonNullable<typeof window.electronAPI>,
    });
    vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    render(<LibrarySettingsPanel onClose={() => {}} />);

    const portableRow = screen.getByText('Store app data next to the app').closest('div.flex');
    expect(portableRow).toBeTruthy();
    const portableSwitch = within(portableRow as HTMLElement).getByRole('switch');

    await waitFor(() => expect(portableSwitch.getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByText('Restart Image MetaHub to start using the new location.')).toBeTruthy();

    fireEvent.click(portableSwitch);

    await waitFor(() => {
      expect(setPortableStorageEnabled).toHaveBeenCalledWith(false);
      expect(portableSwitch.getAttribute('aria-checked')).toBe('false');
    });
    expect(screen.queryByText('Restart Image MetaHub to start using the new location.')).toBeNull();
  });
});

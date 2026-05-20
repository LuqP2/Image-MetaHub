import { describe, expect, it, vi } from 'vitest';
import { mergeSettingsWithExisting, stripLicenseFromSettings, useSettingsStore } from '../store/useSettingsStore';

describe('useSettingsStore persistence helpers', () => {
  it('strips license data before hydrating the settings store', () => {
    const next = stripLicenseFromSettings({
      theme: 'dark',
      autoUpdate: true,
      license: {
        licenseStatus: 'pro',
        licenseEmail: 'pro@example.com',
      },
    });

    expect(next).toEqual({
      theme: 'dark',
      autoUpdate: true,
    });
  });

  it('preserves existing license data when saving general settings', () => {
    const next = mergeSettingsWithExisting(
      {
        theme: 'system',
        a1111LastConnectionStatus: 'unknown',
        license: {
          licenseStatus: 'pro',
          licenseEmail: 'pro@example.com',
          licenseKey: 'ABCD-EFGH-IJKL-MNOP',
        },
      },
      {
        theme: 'dark',
        a1111LastConnectionStatus: 'connected',
      },
    );

    expect(next).toEqual({
      theme: 'dark',
      a1111LastConnectionStatus: 'connected',
      license: {
        licenseStatus: 'pro',
        licenseEmail: 'pro@example.com',
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
      },
    });
  });

  it('enables ComfyUI queue monitoring by default and persists toggle changes', () => {
    useSettingsStore.getState().resetState();

    expect(useSettingsStore.getState().comfyUIQueueMonitoringEnabled).toBe(true);

    useSettingsStore.getState().setComfyUIQueueMonitoringEnabled(false);

    expect(useSettingsStore.getState().comfyUIQueueMonitoringEnabled).toBe(false);
  });

  it('does not notify subscribers when generator connection status is unchanged', () => {
    useSettingsStore.getState().resetState();
    useSettingsStore.getState().setComfyUIConnectionStatus('connected');
    useSettingsStore.getState().setA1111ConnectionStatus('connected');
    const listener = vi.fn();
    const unsubscribe = useSettingsStore.subscribe(listener);

    useSettingsStore.getState().setComfyUIConnectionStatus('connected');
    useSettingsStore.getState().setA1111ConnectionStatus('connected');

    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});

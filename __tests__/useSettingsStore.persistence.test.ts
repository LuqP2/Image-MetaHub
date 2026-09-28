import { describe, expect, it, vi } from 'vitest';
import { mergeSettingsWithExisting, stripLicenseFromSettings, useSettingsStore } from '../store/useSettingsStore';
import type { Keymap } from '../types';

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

  it('keeps Local Visual Search opt-in off by default', () => {
    useSettingsStore.getState().resetState();

    expect(useSettingsStore.getState()).toMatchObject({
      semanticSearchEnabled: false,
      semanticSearchDevice: 'wasm',
      semanticSearchModel: 'clip-b32',
    });
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

  it('notifies subscribers with migrated shortcuts after async hydration', async () => {
    useSettingsStore.getState().resetState();
    const originalStorage = useSettingsStore.persist.getOptions().storage;
    const legacyKeymap: Keymap = {
      version: '1.0',
      global: { openCommandPalette: 'alt+p' },
      preview: { navigateNext: 'n' },
    };
    useSettingsStore.persist.setOptions({ storage: {
      getItem: async () => ({ state: { keymap: legacyKeymap } as ReturnType<typeof useSettingsStore.getState>, version: 0 }),
      setItem: async () => {},
      removeItem: async () => {},
    } });
    let notifiedKeymap: Keymap | null = null;
    const unsubscribe = useSettingsStore.subscribe((state) => {
      notifiedKeymap = state.keymap;
    });

    try {
      await useSettingsStore.persist.rehydrate();
      const global = notifiedKeymap?.global as Record<string, string> | undefined;
      const preview = notifiedKeymap?.preview as Record<string, string> | undefined;
      expect(global).toMatchObject({
        openCommandPalette: 'alt+p',
        rateImage1: '1',
        clearRating: '0',
        toggleRejected: 'x',
      });
      expect(preview?.navigateNext).toBe('n');
    } finally {
      unsubscribe();
      useSettingsStore.persist.setOptions({ storage: originalStorage });
      useSettingsStore.getState().resetState();
    }
  });

  it('keeps legacy bindings and leaves colliding new shortcuts unbound during hydration', async () => {
    useSettingsStore.getState().resetState();
    const originalStorage = useSettingsStore.persist.getOptions().storage;
    const legacyKeymap: Keymap = {
      version: '1.0',
      global: { quickSearch: 'x', focusSidebar: '0' },
      preview: { toggleFavoriteInViewer: '1', navigateNext: '2' },
    };
    useSettingsStore.persist.setOptions({ storage: {
      getItem: async () => ({ state: { keymap: legacyKeymap } as ReturnType<typeof useSettingsStore.getState>, version: 0 }),
      setItem: async () => {},
      removeItem: async () => {},
    } });
    let notifiedKeymap: Keymap | null = null;
    const unsubscribe = useSettingsStore.subscribe((state) => { notifiedKeymap = state.keymap; });

    try {
      await useSettingsStore.persist.rehydrate();
      const global = notifiedKeymap?.global as Record<string, string> | undefined;
      const preview = notifiedKeymap?.preview as Record<string, string> | undefined;
      expect(global).toMatchObject({
        quickSearch: 'x',
        focusSidebar: '0',
        rateImage1: '',
        rateImage2: '',
        rateImage3: '3',
        clearRating: '',
        toggleRejected: '',
      });
      expect(preview).toMatchObject({ toggleFavoriteInViewer: '1', navigateNext: '2' });
    } finally {
      unsubscribe();
      useSettingsStore.persist.setOptions({ storage: originalStorage });
      useSettingsStore.getState().resetState();
    }
  });
});

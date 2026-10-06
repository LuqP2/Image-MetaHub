import { beforeEach, describe, expect, it } from 'vitest';
import {
  sanitizeImageViewerDefaultZoom,
  sanitizeImageViewerMode,
  useSettingsStore,
} from '../store/useSettingsStore';

describe('image viewer preference', () => {
  beforeEach(() => useSettingsStore.getState().resetState());

  it('defaults missing and invalid values to detached', () => {
    expect(sanitizeImageViewerMode(undefined)).toBe('detached');
    expect(sanitizeImageViewerMode('unknown')).toBe('detached');
    expect(useSettingsStore.getState().imageViewerMode).toBe('detached');
  });

  it('stores both supported modes and rejects invalid setter input', () => {
    useSettingsStore.getState().setImageViewerMode('inline');
    expect(useSettingsStore.getState().imageViewerMode).toBe('inline');
    useSettingsStore.getState().setImageViewerMode('detached');
    expect(useSettingsStore.getState().imageViewerMode).toBe('detached');
    useSettingsStore.getState().setImageViewerMode('invalid' as never);
    expect(useSettingsStore.getState().imageViewerMode).toBe('detached');
  });

  it('defaults image zoom to fit and stores 1:1 as the alternative', () => {
    expect(sanitizeImageViewerDefaultZoom(undefined)).toBe('fit');
    expect(useSettingsStore.getState().imageViewerDefaultZoom).toBe('fit');
    useSettingsStore.getState().setImageViewerDefaultZoom('actual');
    expect(useSettingsStore.getState().imageViewerDefaultZoom).toBe('actual');
    useSettingsStore.getState().setImageViewerDefaultZoom('invalid' as never);
    expect(useSettingsStore.getState().imageViewerDefaultZoom).toBe('fit');
  });

  it('persists single-window opt-in and resets to multiple windows', async () => {
    expect(useSettingsStore.getState().reuseImageViewerWindow).toBe(false);
    useSettingsStore.getState().setReuseImageViewerWindow(true);
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().reuseImageViewerWindow).toBe(true);
    useSettingsStore.getState().resetState();
    expect(useSettingsStore.getState().reuseImageViewerWindow).toBe(false);
  });

  it('migrates older settings and invalid saved values to multiple windows', async () => {
    for (const state of [{}, { reuseImageViewerWindow: 'true' }]) {
      useSettingsStore.getState().resetState();
      localStorage.setItem('image-metahub-settings', JSON.stringify({ state, version: 0 }));
      await useSettingsStore.persist.rehydrate();
      expect(useSettingsStore.getState().reuseImageViewerWindow).toBe(false);
    }
  });
});

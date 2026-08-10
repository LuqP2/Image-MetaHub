import { beforeEach, describe, expect, it } from 'vitest';
import { sanitizeImageViewerMode, useSettingsStore } from '../store/useSettingsStore';

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
});

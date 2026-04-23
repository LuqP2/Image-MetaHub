import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SLIDESHOW_INTERVAL_SECONDS,
  MAX_SLIDESHOW_INTERVAL_SECONDS,
  MIN_SLIDESHOW_INTERVAL_SECONDS,
  sanitizeSlideshowIntervalSeconds,
  useSettingsStore,
} from '../store/useSettingsStore';

describe('useSettingsStore slideshow preferences', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetState();
  });

  it('uses slideshow defaults', () => {
    const state = useSettingsStore.getState();

    expect(state.slideshowIntervalSeconds).toBe(DEFAULT_SLIDESHOW_INTERVAL_SECONDS);
    expect(state.slideshowShowFilename).toBe(true);
  });

  it('clamps slideshow interval values', () => {
    useSettingsStore.getState().setSlideshowIntervalSeconds(MAX_SLIDESHOW_INTERVAL_SECONDS + 100);
    expect(useSettingsStore.getState().slideshowIntervalSeconds).toBe(MAX_SLIDESHOW_INTERVAL_SECONDS);

    useSettingsStore.getState().setSlideshowIntervalSeconds(MIN_SLIDESHOW_INTERVAL_SECONDS - 1);
    expect(useSettingsStore.getState().slideshowIntervalSeconds).toBe(MIN_SLIDESHOW_INTERVAL_SECONDS);

    useSettingsStore.getState().setSlideshowIntervalSeconds(Number.NaN);
    expect(useSettingsStore.getState().slideshowIntervalSeconds).toBe(DEFAULT_SLIDESHOW_INTERVAL_SECONDS);
  });

  it('sanitizes decimal intervals to whole seconds', () => {
    expect(sanitizeSlideshowIntervalSeconds(6.8)).toBe(6);
  });

  it('persists the filename overlay preference in state', () => {
    useSettingsStore.getState().setSlideshowShowFilename(false);

    expect(useSettingsStore.getState().slideshowShowFilename).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readLegacyVideoRepeatMode, useSettingsStore } from '../store/useSettingsStore';

describe('useSettingsStore video playback preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().resetState();
  });

  it('uses playback defaults that match the previous hardcoded behavior', () => {
    const state = useSettingsStore.getState();

    expect(state.autoPlayMedia).toBe(true);
    expect(state.videoRepeatMode).toBe('off');
    expect(state.videoShuffle).toBe(false);
  });

  it('stores the auto-play preference', () => {
    useSettingsStore.getState().setAutoPlayMedia(false);

    expect(useSettingsStore.getState().autoPlayMedia).toBe(false);
  });

  it('accepts every repeat mode and falls back to off for unknown values', () => {
    useSettingsStore.getState().setVideoRepeatMode('all');
    expect(useSettingsStore.getState().videoRepeatMode).toBe('all');

    useSettingsStore.getState().setVideoRepeatMode('one');
    expect(useSettingsStore.getState().videoRepeatMode).toBe('one');

    useSettingsStore.getState().setVideoRepeatMode('everything' as never);
    expect(useSettingsStore.getState().videoRepeatMode).toBe('off');
  });

  it('stores the shuffle preference', () => {
    useSettingsStore.getState().setVideoShuffle(true);

    expect(useSettingsStore.getState().videoShuffle).toBe(true);
  });

  it('reads the legacy boolean loop flag as repeat one', () => {
    localStorage.setItem('video_player_loop', 'true');
    expect(readLegacyVideoRepeatMode()).toBe('one');

    localStorage.setItem('video_player_loop', 'false');
    expect(readLegacyVideoRepeatMode()).toBe('off');

    localStorage.removeItem('video_player_loop');
    expect(readLegacyVideoRepeatMode()).toBe('off');
  });

  it('seeds the initial repeat mode from the legacy loop flag', async () => {
    // Drop the settings blob persisted by resetState() so the fresh store starts from defaults.
    localStorage.clear();
    localStorage.setItem('video_player_loop', 'true');
    vi.resetModules();

    const freshStore = (await import('../store/useSettingsStore')).useSettingsStore;

    expect(freshStore.getState().videoRepeatMode).toBe('one');
  });

  it('lets a persisted repeat mode win over the legacy flag', async () => {
    localStorage.clear();
    localStorage.setItem('video_player_loop', 'true');
    localStorage.setItem(
      'image-metahub-settings',
      JSON.stringify({ state: { videoRepeatMode: 'all' }, version: 0 }),
    );
    vi.resetModules();

    const freshStore = (await import('../store/useSettingsStore')).useSettingsStore;
    await freshStore.persist.rehydrate();

    expect(freshStore.getState().videoRepeatMode).toBe('all');
  });

  it('resets an unknown persisted repeat mode to off on rehydrate', async () => {
    localStorage.setItem(
      'image-metahub-settings',
      JSON.stringify({ state: { videoRepeatMode: 'sideways' }, version: 0 }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().videoRepeatMode).toBe('off');
  });
});

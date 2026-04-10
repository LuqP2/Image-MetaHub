import { beforeEach, describe, expect, it } from 'vitest';
import hotkeyManager from '../services/hotkeyManager';

const resetPauseState = () => {
  for (let index = 0; index < 10; index += 1) {
    hotkeyManager.resumeHotkeys();
  }
};

describe('hotkeyManager pause state', () => {
  beforeEach(() => {
    resetPauseState();
  });

  it('keeps hotkeys paused until every pause request is resumed', () => {
    expect(hotkeyManager.areHotkeysPaused()).toBe(false);

    hotkeyManager.pauseHotkeys();
    hotkeyManager.pauseHotkeys();

    expect(hotkeyManager.areHotkeysPaused()).toBe(true);

    hotkeyManager.resumeHotkeys();

    expect(hotkeyManager.areHotkeysPaused()).toBe(true);

    hotkeyManager.resumeHotkeys();

    expect(hotkeyManager.areHotkeysPaused()).toBe(false);
  });

  it('ignores extra resume calls', () => {
    hotkeyManager.resumeHotkeys();

    expect(hotkeyManager.areHotkeysPaused()).toBe(false);
  });
});

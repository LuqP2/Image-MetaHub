import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import hotkeyManager from '../services/hotkeyManager';
import { useSettingsStore } from '../store/useSettingsStore';

const resetPauseState = () => {
  for (let index = 0; index < 10; index += 1) {
    hotkeyManager.resumeHotkeys();
  }
};

describe('hotkeyManager pause state', () => {
  beforeEach(() => {
    resetPauseState();
    hotkeyManager.clearActions();
  });

  afterEach(() => {
    hotkeyManager.clearActions();
    hotkeyManager.setScope('all');
    document.body.innerHTML = '';
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

  it('does not run app hotkeys while typing in an input', () => {
    const quickSearch = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);

    hotkeyManager.registerAction('quickSearch', quickSearch);
    hotkeyManager.bindAllActions();

    input.focus();

    const slashEvent = new KeyboardEvent('keydown', {
      key: '/',
      code: 'Slash',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(slashEvent, 'keyCode', { value: 191 });
    Object.defineProperty(slashEvent, 'which', { value: 191 });

    input.dispatchEvent(slashEvent);

    expect(quickSearch).not.toHaveBeenCalled();
  });

  it('runs an unmodified rejection shortcut once and ignores a focused select', () => {
    const toggleRejected = vi.fn();
    const select = document.createElement('select');
    document.body.appendChild(select);
    useSettingsStore.getState().updateKeybinding('global', 'toggleRejected', 'x');
    hotkeyManager.registerAction('toggleRejected', toggleRejected);
    hotkeyManager.bindAllActions();
    hotkeyManager.setScope('global');

    const pressX = (target: HTMLElement) => {
      const event = new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', bubbles: true, cancelable: true });
      Object.defineProperty(event, 'keyCode', { value: 88 });
      Object.defineProperty(event, 'which', { value: 88 });
      target.dispatchEvent(event);
    };

    pressX(document.body);
    expect(toggleRejected).toHaveBeenCalledTimes(1);
    pressX(select);
    expect(toggleRejected).toHaveBeenCalledTimes(1);
  });
});

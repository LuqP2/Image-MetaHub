import { describe, expect, it } from 'vitest';
import { eventMatchesKeybinding, isTypingElement } from '../utils/hotkeyUtils';

const keyboardEvent = (overrides: Partial<KeyboardEvent> = {}): Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> => ({
  key: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe('eventMatchesKeybinding', () => {
  it('matches plain and function keys', () => {
    expect(eventMatchesKeybinding(keyboardEvent({ key: 'f' }), 'f')).toBe(true);
    expect(eventMatchesKeybinding(keyboardEvent({ key: 'F5' }), 'f5')).toBe(true);
  });

  it('matches aliases and modifier combinations', () => {
    expect(eventMatchesKeybinding(keyboardEvent({ key: 'ArrowLeft' }), 'left')).toBe(true);
    expect(eventMatchesKeybinding(keyboardEvent({ key: ' ' }), 'space')).toBe(true);
    expect(eventMatchesKeybinding(keyboardEvent({ key: 'Enter', altKey: true }), 'alt+enter')).toBe(true);
    expect(eventMatchesKeybinding(keyboardEvent({ key: 'x', ctrlKey: true }), 'delete, ctrl+x')).toBe(true);
    expect(eventMatchesKeybinding(keyboardEvent({ key: 'k', metaKey: true }), 'ctrl+k, cmd+k')).toBe(true);
  });

  it('rejects mismatched shortcuts', () => {
    expect(eventMatchesKeybinding(keyboardEvent({ key: 'f', shiftKey: true }), 'f')).toBe(false);
    expect(eventMatchesKeybinding(keyboardEvent({ key: 'Delete' }), 'ctrl+x')).toBe(false);
  });
});

describe('isTypingElement', () => {
  it('detects editable targets', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';

    expect(isTypingElement(input)).toBe(true);
    expect(isTypingElement(textarea)).toBe(true);
    expect(isTypingElement(editable)).toBe(true);
  });

  it('ignores non-editable targets', () => {
    const button = document.createElement('button');
    expect(isTypingElement(button)).toBe(false);
    expect(isTypingElement(null)).toBe(false);
  });
});

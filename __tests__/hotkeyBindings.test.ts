import { describe, expect, it } from 'vitest';
import { getDefaultKeymap } from '../services/hotkeyConfig';
import { expandHotkeyBindings, findHotkeyConflict, resolveAnnotationShortcut } from '../services/hotkeyBindings';
import { hotkeyConfig } from '../services/hotkeyConfig';

describe('configured annotation shortcuts', () => {
  it('expands numpad and platform variants the same way as runtime binding', () => {
    const rate = hotkeyConfig.find((action) => action.id === 'rateImage1')!;
    expect(expandHotkeyBindings('ctrl+1', rate)).toEqual(['ctrl+1', 'ctrl+num_1', 'cmd+1', 'cmd+num_1']);
  });

  it('finds conflicts across alternatives and overlapping scopes', () => {
    const keymap = getDefaultKeymap();
    expect(findHotkeyConflict(keymap, 'rateImage1', 'ctrl+1')?.id).toBe('focusSidebar');
    expect(findHotkeyConflict(keymap, 'rateImage1', 'f')?.id).toBe('toggleFavoriteInViewer');
    expect(findHotkeyConflict(keymap, 'rateImage1', 'ctrl+9')).toBeNull();
  });

  it('resolves remapped rating, clear and reject actions in the detached viewer', () => {
    const keymap = getDefaultKeymap().global as Record<string, string>;
    keymap.rateImage1 = 'alt+1';
    const event = (key: string, code: string, altKey = false) =>
      new KeyboardEvent('keydown', { key, code, altKey });
    expect(resolveAnnotationShortcut(event('1', 'Numpad1', true), keymap)).toEqual({ type: 'rating', rating: 1 });
    expect(resolveAnnotationShortcut(event('0', 'Numpad0'), keymap)).toEqual({ type: 'rating', rating: null });
    expect(resolveAnnotationShortcut(event('x', 'KeyX'), keymap)).toEqual({ type: 'toggle-rejected' });
    expect(resolveAnnotationShortcut(event('1', 'Digit1'), keymap)).toBeNull();
  });
});

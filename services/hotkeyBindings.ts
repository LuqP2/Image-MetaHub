import type { ImageRating, Keymap } from '../types';
import { getDefaultKeymap, hotkeyConfig, type HotkeyDefinition } from './hotkeyConfig';
import { eventMatchesKeybinding } from '../utils/hotkeyUtils';

export const expandHotkeyBindings = (key: string, definition: HotkeyDefinition): string[] => {
  const bindings = key.toLowerCase().split(',').map((part) => part.trim()).filter(Boolean);
  const platformBindings = bindings.flatMap((binding) =>
    /\bctrl\b/.test(binding) && !/\bcmd\b/.test(binding)
      ? [binding, binding.replace(/\bctrl\b/g, 'cmd')]
      : [binding]
  );
  const numpadBindings = definition.numpadEquivalent
    ? platformBindings.flatMap((binding) => {
        const alias = binding.replace(/(^|\+)([0-9])$/, '$1num_$2');
        return alias === binding ? [binding] : [binding, alias];
      })
    : platformBindings;
  return [...new Set(numpadBindings)];
};

const activeScopes = (definition: HotkeyDefinition) => definition.activeScopes ?? [definition.scope];

export const findHotkeyConflict = (
  keymap: Keymap,
  actionId: string,
  proposedKey: string,
): HotkeyDefinition | null => {
  const target = hotkeyConfig.find((action) => action.id === actionId);
  if (!target || !proposedKey.trim()) return null;
  const proposedBindings = new Set(expandHotkeyBindings(proposedKey, target));

  return hotkeyConfig.find((other) => {
    if (other.id === actionId || !activeScopes(other).some((scope) => activeScopes(target).includes(scope))) return false;
    const otherKey = (keymap[other.scope] as Record<string, string> | undefined)?.[other.id] ?? other.defaultKey;
    return expandHotkeyBindings(otherKey, other).some((binding) => proposedBindings.has(binding));
  }) ?? null;
};

export const mergeKeymapWithDefaults = (persistedKeymap?: Keymap): Keymap => {
  const defaults = getDefaultKeymap();
  const merged: Keymap = { ...defaults, ...persistedKeymap };
  for (const scope of ['global', 'preview'] as const) {
    const saved = persistedKeymap?.[scope] as Record<string, string> | undefined;
    merged[scope] = {
      ...Object.fromEntries(Object.keys(defaults[scope] as Record<string, string>).map((id) => [id, ''])),
      ...saved,
    };
  }

  for (const action of hotkeyConfig) {
    const saved = persistedKeymap?.[action.scope] as Record<string, string> | undefined;
    if (saved && Object.hasOwn(saved, action.id)) continue;
    const binding = findHotkeyConflict(merged, action.id, action.defaultKey) ? '' : action.defaultKey;
    (merged[action.scope] as Record<string, string>)[action.id] = binding;
  }
  return merged;
};

export type AnnotationShortcut = { type: 'rating'; rating: ImageRating | null } | { type: 'toggle-rejected' };

export const resolveAnnotationShortcut = (
  event: KeyboardEvent,
  globalKeymap?: Record<string, string>,
): AnnotationShortcut | null => {
  for (const action of hotkeyConfig) {
    const isRating = /^rateImage[1-5]$/.test(action.id);
    if (!isRating && action.id !== 'clearRating' && action.id !== 'toggleRejected') continue;
    const binding = globalKeymap?.[action.id] ?? action.defaultKey;
    if (!eventMatchesKeybinding(event, expandHotkeyBindings(binding, action).join(', '))) continue;
    if (action.id === 'toggleRejected') return { type: 'toggle-rejected' };
    return { type: 'rating', rating: action.id === 'clearRating' ? null : Number(action.id.slice(-1)) as ImageRating };
  }
  return null;
};

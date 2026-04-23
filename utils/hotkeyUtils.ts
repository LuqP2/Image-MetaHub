const KEY_ALIASES: Record<string, string> = {
  del: 'delete',
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
  escape: 'esc',
  ' ': 'space',
};

const normalizeKey = (key: string): string => {
  const raw = key.toLowerCase();
  const aliasedRaw = KEY_ALIASES[raw] ?? raw;
  const normalized = aliasedRaw.trim();
  return KEY_ALIASES[normalized] ?? normalized;
};

export const isTypingElement = (target: EventTarget | null | undefined): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return Boolean(
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    target.isContentEditable ||
    target.contentEditable === 'true' ||
    target.getAttribute('contenteditable') === 'true',
  );
};

export const eventMatchesKeybinding = (
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  keybinding?: string,
): boolean => {
  if (!keybinding) {
    return false;
  }

  return keybinding
    .split(',')
    .map((combo) => combo.trim())
    .filter(Boolean)
    .some((combo) => {
      const parts = combo.split('+').map((part) => part.trim().toLowerCase()).filter(Boolean);
      if (parts.length === 0) {
        return false;
      }

      const key = normalizeKey(parts[parts.length - 1]);
      const modifiers = new Set(parts.slice(0, -1));

      return (
        event.ctrlKey === modifiers.has('ctrl') &&
        event.metaKey === (modifiers.has('cmd') || modifiers.has('meta')) &&
        event.altKey === modifiers.has('alt') &&
        event.shiftKey === modifiers.has('shift') &&
        normalizeKey(event.key) === key
      );
    });
};

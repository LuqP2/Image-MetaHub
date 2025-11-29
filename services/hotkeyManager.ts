import hotkeys, { KeyHandler } from 'hotkeys-js';
import { useSettingsStore } from '../store/useSettingsStore';
import { hotkeyConfig, HotkeyDefinition } from './hotkeyConfig';

interface RegisteredAction {
  id: string;
  scope: string;
  callback: KeyHandler;
}

// Configure hotkeys-js to work with numpad and allow shortcuts in input fields when needed
// This fixes Issue #48 (numpad keys not working on Linux)
hotkeys.filter = function(event) {
  const target = (event.target || event.srcElement) as HTMLElement;
  const tagName = target.tagName;

  // Allow hotkeys in most contexts, including when inputs are focused
  // We'll handle input-specific blocking at the action level
  return true;
};

// A map to store the actions that the application supports.
const registeredActions = new Map<string, RegisteredAction>();

/**
 * Unbinds all currently bound hotkeys from the hotkeys-js instance.
 * This is crucial before re-binding to prevent duplicate listeners.
 */
const unbindAll = () => {
  hotkeys.unbind();
};

/**
 * Binds all registered actions to their corresponding keybindings from the settings store.
 * It first unbinds all existing hotkeys to ensure a clean slate.
 */
const bindAllActions = () => {
  unbindAll();
  const { keymap } = useSettingsStore.getState();

  registeredActions.forEach((action) => {
    const scopeKeymap = keymap[action.scope] as Record<string, string> | undefined;
    if (!scopeKeymap) return;

    const key = scopeKeymap[action.id];
    if (!key) return; // No keybinding for this action

    // Handle platform differences (Ctrl/Cmd)
    const platformKey = key.replace('ctrl', 'cmd');
    const keysToRegister = key.includes('cmd') ? key : `${key}, ${platformKey}`;

    hotkeys(keysToRegister, { scope: action.scope, keyup: false, keydown: true }, (event, handler) => {
      // Don't block keys in text inputs for typing operations
      const target = event.target as HTMLElement;
      const isTypingContext = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // For navigation/action keys, prevent default even in inputs
      const isActionKey = ['delete', 'enter', 'escape', 'f1'].some(k => key.includes(k));

      if (isActionKey || !isTypingContext) {
        event.preventDefault();
      }

      action.callback(event, handler);
    });
  });
};

/**
 * Registers a hotkey action with the manager. This does not bind the key immediately.
 * The action is stored and will be bound when `bindAllActions` is called.
 * @param id - The unique identifier for the action (from hotkeyConfig).
 * @param callback - The function to execute when the hotkey is pressed.
 */
const registerAction = (id: string, callback: KeyHandler) => {
  const config = hotkeyConfig.find(h => h.id === id);
  if (!config) {
    console.warn(`[HotkeyManager] Attempted to register an unknown hotkey action: ${id}`);
    return;
  }

  registeredActions.set(id, { id, scope: config.scope, callback });
};

/**
 * Clears all registered actions. Should be called on cleanup.
 */
const clearActions = () => {
  registeredActions.clear();
  unbindAll();
};

/**
 * Sets the active scope for hotkeys.
 * @param scope - The name of the scope (e.g., 'preview', 'global').
 */
const setScope = (scope: string) => {
  hotkeys.setScope(scope);
};

/**
 * Retrieves a list of all defined hotkeys and their current keybindings.
 * @returns An array of objects, each containing the definition and current key.
 */
const getRegisteredHotkeys = (): (HotkeyDefinition & { currentKey: string })[] => {
  const { keymap } = useSettingsStore.getState();
  return hotkeyConfig.map(config => {
    const scopeKeymap = keymap[config.scope] as Record<string, string> | undefined;
    const currentKey = scopeKeymap ? scopeKeymap[config.id] : config.defaultKey;
    return { ...config, currentKey };
  });
};

const hotkeyManager = {
  registerAction,
  bindAllActions,
  clearActions,
  setScope,
  getRegisteredHotkeys,
};

export default hotkeyManager;
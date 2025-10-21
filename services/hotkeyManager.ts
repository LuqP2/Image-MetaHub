import hotkeys, { KeyHandler } from 'hotkeys-js';
import { useSettingsStore } from '../store/useSettingsStore';
import { hotkeyConfig, HotkeyDefinition, getDefaultKeymap } from './hotkeyConfig';

interface RegisteredAction {
  id: string;
  scope: string;
  callback: KeyHandler;
}

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
  const defaultKeymap = getDefaultKeymap();

  // Migrate keymap: add missing actions from default
  let needsMigration = false;
  Object.keys(defaultKeymap).forEach(scope => {
    if (!keymap[scope]) {
      keymap[scope] = {};
      needsMigration = true;
    }
    Object.keys(defaultKeymap[scope] as Record<string, string>).forEach(actionId => {
      if (!(keymap[scope] as Record<string, string>)[actionId]) {
        (keymap[scope] as Record<string, string>)[actionId] = (defaultKeymap[scope] as Record<string, string>)[actionId];
        needsMigration = true;
      }
    });
  });

  if (needsMigration) {
    useSettingsStore.setState({ keymap });
  }

  registeredActions.forEach((action) => {
    const scopeKeymap = keymap[action.scope] as Record<string, string> | undefined;
    if (!scopeKeymap) {
      return;
    }

    const key = scopeKeymap[action.id];
    if (!key) {
      return;
    }

    // Handle platform differences (Ctrl/Cmd)
    let keysToRegister = key;
    if (key.includes('ctrl') && !key.includes('cmd')) {
      // Only add cmd variant if it has ctrl and doesn't already have cmd
      const platformKey = key.replace('ctrl', 'cmd');
      keysToRegister = `${key}, ${platformKey}`;
    }

    hotkeys(keysToRegister, { scope: action.scope }, (event, handler) => {
      event.preventDefault();
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
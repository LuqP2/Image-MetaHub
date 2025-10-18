import hotkeys, { KeyHandler } from 'hotkeys-js';
import { useSettingsStore } from '../store/useSettingsStore';
import { hotkeyConfig, HotkeyDefinition } from './hotkeyConfig';

interface RegisteredAction {
  id: string;
  scope: string;
  callback: KeyHandler;
}

// A map to store the actions that the application supports.
const registeredActions = new Map<string, RegisteredAction>();

/**
 * @function unbindAll
 * @description Unbinds all currently bound hotkeys from the hotkeys-js instance. This is crucial before re-binding to prevent duplicate listeners.
 */
const unbindAll = () => {
  hotkeys.unbind();
};

/**
 * @function bindAllActions
 * @description Binds all registered actions to their corresponding keybindings from the settings store. It first unbinds all existing hotkeys to ensure a clean slate.
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

    hotkeys(keysToRegister, { scope: action.scope }, (event, handler) => {
      event.preventDefault();
      action.callback(event, handler);
    });
  });
};

/**
 * @function registerAction
 * @description Registers a hotkey action with the manager. This does not bind the key immediately. The action is stored and will be bound when `bindAllActions` is called.
 * @param {string} id - The unique identifier for the action (from hotkeyConfig).
 * @param {KeyHandler} callback - The function to execute when the hotkey is pressed.
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
 * @function clearActions
 * @description Clears all registered actions. Should be called on cleanup.
 */
const clearActions = () => {
  registeredActions.clear();
  unbindAll();
};

/**
 * @function setScope
 * @description Sets the active scope for hotkeys.
 * @param {string} scope - The name of the scope (e.g., 'preview', 'global').
 */
const setScope = (scope: string) => {
  hotkeys.setScope(scope);
};

/**
 * @function getRegisteredHotkeys
 * @description Retrieves a list of all defined hotkeys and their current keybindings.
 * @returns {(HotkeyDefinition & { currentKey: string })[]} - An array of objects, each containing the definition and current key.
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
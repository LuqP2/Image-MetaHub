import hotkeys, { KeyHandler } from 'hotkeys-js';

/**
 * A map to store registered hotkeys and their descriptions for the help overlay.
 */
const registeredHotkeys = new Map<string, string>();

/**
 * Initializes the hotkey manager.
 */
const init = () => {
  // Global configuration for hotkeys-js can be set here if needed.
  console.log('Hotkey manager initialized.');
};

/**
 * Registers a hotkey with a callback function and an optional description.
 * This function handles the platform differences between Ctrl (Windows/Linux) and Cmd (macOS).
 * @param key - The key combination (e.g., 'ctrl+f'). Use 'ctrl' as the standard modifier.
 * @param description - A user-friendly description for the help overlay.
 * @param callback - The function to execute when the hotkey is pressed.
 */
const on = (key: string, description: string, callback: KeyHandler) => {
  const platformKey = key.replace('ctrl', 'cmd');
  const keysToRegister = `${key}, ${platformKey}`;

  hotkeys(keysToRegister, (event, handler) => {
    event.preventDefault();
    callback(event, handler);
  });

  registeredHotkeys.set(key, description);
};

/**
 * Unbinds a previously registered hotkey.
 * @param key - The key combination to unbind.
 */
const off = (key: string) => {
  const platformKey = key.replace('ctrl', 'cmd');
  hotkeys.unbind(`${key}, ${platformKey}`);
  registeredHotkeys.delete(key);
};

/**
 * Unbinds all registered hotkeys to prevent memory leaks on component unmount.
 */
const unbindAll = () => {
  for (const key of registeredHotkeys.keys()) {
    const platformKey = key.replace('ctrl', 'cmd');
    hotkeys.unbind(`${key}, ${platformKey}`);
  }
  registeredHotkeys.clear();
};

/**
 * Sets the active scope for hotkeys.
 * @param scope - The name of the scope (e.g., 'preview', 'input').
 */
const setScope = (scope: string) => {
  hotkeys.setScope(scope);
};

/**
 * Retrieves a list of all registered hotkeys and their descriptions.
 * @returns An array of objects, each containing a key and its description.
 */
const getRegisteredHotkeys = (): { key: string, description: string }[] => {
  return Array.from(registeredHotkeys.entries()).map(([key, description]) => ({
    key,
    description,
  }));
};

const hotkeyManager = {
  init,
  on,
  off,
  unbindAll,
  setScope,
  getRegisteredHotkeys,
};

export default hotkeyManager;
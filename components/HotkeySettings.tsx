import React, { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { hotkeyConfig } from '../services/hotkeyConfig';
import { Keymap } from '../types';

export const HotkeySettings = () => {
  const { keymap, updateKeybinding, resetKeymap } = useSettingsStore();
  const [recording, setRecording] = useState<{ scope: string; action: string } | null>(null);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!recording) return;

    // Allow Escape to propagate to close the modal
    if (event.key === 'Escape') {
      setRecording(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const { ctrlKey, metaKey, altKey, shiftKey, key } = event;

    // Ignore modifier-only key presses
    const isModifier = ['Control', 'Meta', 'Alt', 'Shift'].includes(key);
    if (isModifier) {
      return;
    }

    const keyParts = [];
    if (ctrlKey) keyParts.push('ctrl');
    if (metaKey) keyParts.push('cmd');
    if (altKey) keyParts.push('alt');
    if (shiftKey) keyParts.push('shift');
    keyParts.push(key.toLowerCase());

    // Prevent single modifier keys from being set as hotkeys
    if (keyParts.length === 1 && ['ctrl', 'cmd', 'alt', 'shift'].includes(keyParts[0])) {
        return;
    }

    const newKeybinding = keyParts.join('+');

      if (newKeybinding) {
        // --- Conflict Detection ---
        let conflict: { action: string, scope: string } | null = null;
        for (const scope in keymap) {
          if (scope === 'version') continue;
          const scopeActions = keymap[scope] as Record<string, string>;
          for (const action in scopeActions) {
            if (scopeActions[action] === newKeybinding && (scope !== recording.scope || action !== recording.action)) {
              conflict = { action, scope };
              break;
            }
          }
          if (conflict) break;
        }

        if (conflict) {
            const conflictingActionName = hotkeyConfig.find(h => h.id === conflict.action)?.name || conflict.action;
            const recordingActionName = hotkeyConfig.find(h => h.id === recording.action)?.name || recording.action;

            // Find a new available hotkey
            const findAvailableHotkey = (baseKey: string) => {
                const modifiers = ['shift', 'ctrl', 'alt'];
                for (const mod of modifiers) {
                    if (!baseKey.includes(mod)) {
                        const newKey = `${mod}+${baseKey}`;
                        const isTaken = Object.values(keymap).some(scope => typeof scope === 'object' && Object.values(scope).includes(newKey));
                        if (!isTaken) return newKey;
                    }
                }
                return null;
            };

            const autoRemapKey = findAvailableHotkey(newKeybinding);

            let confirmationMessage = `Hotkey "${newKeybinding}" is already assigned to "${conflictingActionName}".\n\nAssign it to "${recordingActionName}"?`;
            if (autoRemapKey) {
                confirmationMessage += `\n\nWe can automatically remap "${conflictingActionName}" to "${autoRemapKey}".`;
            } else {
                confirmationMessage += `\n\nWarning: Could not find an available alternative for "${conflictingActionName}". It will be unassigned.`;
            }

            const confirmed = window.confirm(confirmationMessage);

            if (confirmed) {
                if (autoRemapKey) {
                    updateKeybinding(conflict.scope, conflict.action, autoRemapKey); // Remap original
                } else {
                    updateKeybinding(conflict.scope, conflict.action, ''); // Unbind original
                }
                updateKeybinding(recording.scope, recording.action, newKeybinding); // Bind new
            }
          } else {
            updateKeybinding(recording.scope, recording.action, newKeybinding);
          }
          setRecording(null);
        }
    }, [recording, updateKeybinding, keymap]);

  useEffect(() => {
    if (recording) {
      document.addEventListener('keydown', handleKeyDown, true);
    } else {
      document.removeEventListener('keydown', handleKeyDown, true);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [recording, handleKeyDown]);

  const handleResetAll = () => {
    // Add confirmation dialog here
    resetKeymap();
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(keymap, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);

    const exportFileDefaultName = 'image-metahub-keymap.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedKeymap = JSON.parse(e.target?.result as string) as Keymap;
        // Add validation for the imported keymap structure here
        useSettingsStore.setState({ keymap: importedKeymap });
      } catch (error) {
        console.error('Failed to parse keymap file:', error);
        // Add user-facing error message here
      }
    };
    reader.readAsText(file);
  };

  const groupedHotkeys = hotkeyConfig.reduce((acc, hotkey) => {
    const scope = hotkey.scope.charAt(0).toUpperCase() + hotkey.scope.slice(1);
    if (!acc[scope]) {
      acc[scope] = [];
    }
    acc[scope].push(hotkey);
    return acc;
  }, {} as Record<string, typeof hotkeyConfig>);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-grow overflow-y-auto pr-2 space-y-6 max-h-[60vh]">
        {Object.entries(groupedHotkeys).map(([scope, hotkeys]) => (
          <div key={scope}>
            <h3 className="text-lg font-semibold mb-3 text-gray-200 border-b border-gray-700 pb-2">{scope}</h3>
            <div className="space-y-2">
              {hotkeys.map((hotkey) => (
                <div key={hotkey.id} className="flex items-center justify-between p-2 rounded-md hover:bg-gray-700/50">
                  <p className="text-gray-300">{hotkey.name}</p>
                  <div className="flex items-center space-x-4">
                    <button
                      onClick={() => setRecording({ scope: hotkey.scope, action: hotkey.id })}
                      className={`px-3 py-1 w-36 text-center text-sm font-mono rounded-md transition-colors ${
                        recording?.action === hotkey.id
                          ? 'bg-blue-600 text-white animate-pulse'
                          : 'bg-gray-900 text-gray-200 border border-gray-600'
                      }`}
                    >
                      {recording?.action === hotkey.id
                        ? 'Recording...'
                        : (keymap[hotkey.scope] as Record<string, string>)?.[hotkey.id] || 'Unset'}
                    </button>
                    <button
                      onClick={() => updateKeybinding(hotkey.scope, hotkey.id, hotkey.defaultKey)}
                      className="text-xs text-gray-400 hover:text-white hover:underline"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end space-x-4 pt-4 mt-4 border-t border-gray-700">
        <input type="file" id="import-keymap" className="hidden" accept=".json" onChange={handleImport} />
        <button
            onClick={() => document.getElementById('import-keymap')?.click()}
            className="px-4 py-2 text-sm font-semibold rounded-md bg-blue-500 text-white hover:bg-blue-600"
        >
            Import
        </button>
        <button
            onClick={handleExport}
            className="px-4 py-2 text-sm font-semibold rounded-md bg-green-500 text-white hover:bg-green-600"
        >
            Export
        </button>
        <button
            onClick={handleResetAll}
            className="px-4 py-2 text-sm font-semibold rounded-md bg-red-500 text-white hover:bg-red-600"
        >
            Reset All
        </button>
      </div>
    </div>
  );
};
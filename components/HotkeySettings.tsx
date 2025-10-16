import React, { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { hotkeyConfig } from '../services/hotkeyConfig';
import { Keymap } from '../types';

export const HotkeySettings = () => {
  const { keymap, updateKeybinding, resetKeymap } = useSettingsStore();
  const [recording, setRecording] = useState<{ scope: string; action: string } | null>(null);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!recording) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      setRecording(null);
      return;
    }

    const { ctrlKey, metaKey, altKey, shiftKey, key } = event;
    const keyParts = [];

    if (ctrlKey) keyParts.push('ctrl');
    if (metaKey) keyParts.push('cmd');
    if (altKey) keyParts.push('alt');
    if (shiftKey) keyParts.push('shift');

    // Add the main key, avoiding modifiers
    if (!['Control', 'Meta', 'Alt', 'Shift'].includes(key)) {
      keyParts.push(key.toLowerCase());
    }

    if (keyParts.length > 0) {
      const newKeybinding = keyParts.join('+');

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

        const autoRemapKey = `shift+${newKeybinding}`; // Suggest a remapping
        const confirmed = window.confirm(
          `Hotkey "${newKeybinding}" is already assigned to "${conflictingActionName}".\n\n` +
          `Do you want to assign it to "${recordingActionName}" and automatically remap "${conflictingActionName}" to "${autoRemapKey}"?`
        );

        if (confirmed) {
          // Check if the suggested remap key is also taken
          const isAutoRemapKeyTaken = Object.values(keymap).some(scope =>
            typeof scope === 'object' && Object.values(scope).includes(autoRemapKey)
          );

          if (isAutoRemapKeyTaken) {
            alert(`Could not automatically remap "${conflictingActionName}" because the suggested hotkey "${autoRemapKey}" is also in use. Please remap it manually.`);
            updateKeybinding(conflict.scope, conflict.action, ''); // Unbind original
          } else {
            updateKeybinding(conflict.scope, conflict.action, autoRemapKey); // Remap original
          }
          updateKeybinding(recording.scope, recording.action, newKeybinding); // Bind new
        }
      } else {
        updateKeybinding(recording.scope, recording.action, newKeybinding);
      }

      setRecording(null);
    }
  }, [recording, updateKeybinding]);

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
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Keyboard Shortcuts</h2>
      {Object.entries(groupedHotkeys).map(([scope, hotkeys]) => (
        <div key={scope}>
          <h3 className="text-lg font-medium mb-2">{scope}</h3>
          <div className="space-y-2">
            {hotkeys.map((hotkey) => (
              <div key={hotkey.id} className="flex items-center justify-between p-2 rounded-md bg-gray-100 dark:bg-gray-800">
                <div>
                  <p className="font-semibold">{hotkey.name}</p>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setRecording({ scope: hotkey.scope, action: hotkey.id })}
                    className={`px-2 py-1 text-sm font-mono rounded-md ${
                      recording?.action === hotkey.id
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  >
                    {recording?.action === hotkey.id
                      ? 'Press a key...'
                      : (keymap[hotkey.scope] as Record<string, string>)?.[hotkey.id] || hotkey.defaultKey}
                  </button>
                  <button
                    onClick={() => updateKeybinding(hotkey.scope, hotkey.id, hotkey.defaultKey)}
                    className="px-2 py-1 text-xs rounded-md hover:bg-gray-300 dark:hover:bg-gray-600"
                  >
                    Reset
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex justify-end space-x-4 pt-4">
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
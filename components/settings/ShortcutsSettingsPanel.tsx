import React from 'react';
import { HotkeySettings } from '../HotkeySettings';
import { SettingsPanel } from './SettingsPanel';

export const ShortcutsSettingsPanel: React.FC = () => {
  return (
    <SettingsPanel title="Shortcuts" description="Customize keyboard shortcuts.">
      <HotkeySettings />
    </SettingsPanel>
  );
};

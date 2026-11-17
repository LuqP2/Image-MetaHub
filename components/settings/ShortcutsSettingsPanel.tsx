import { useTranslation } from '../../i18n/useTranslation';
import React from 'react';
import { HotkeySettings } from '../HotkeySettings';
import { SettingsPanel } from './SettingsPanel';

export const ShortcutsSettingsPanel: React.FC = () => {
  const { t } = useTranslation();
  return (
    <SettingsPanel title={t("settings.shortcuts.shortcuts")} description={t("settings.shortcuts.customizeKeyboardShortcuts")}>
      <HotkeySettings />
    </SettingsPanel>
  );
};

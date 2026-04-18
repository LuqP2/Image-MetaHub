import React from 'react';
import { Check } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { SettingRow } from './SettingRow';
import { SettingsPanel } from './SettingsPanel';
import { SettingsSectionCard } from './SettingsSectionCard';
import { SettingSwitch } from './SettingSwitch';

const themeOptions = [
  { id: 'system', name: 'System', colors: ['#525252', '#a3a3a3'] },
  { id: 'light', name: 'Light', colors: ['#ffffff', '#3b82f6', '#1f2937'] },
  { id: 'dark', name: 'Dark', colors: ['#0a0a0a', '#3b82f6', '#e5e5e5'] },
  { id: 'dracula', name: 'Dracula', colors: ['#282a36', '#bd93f9', '#f8f8f2'] },
  { id: 'nord', name: 'Nord', colors: ['#2e3440', '#88c0d0', '#d8dee9'] },
  { id: 'ocean', name: 'Ocean', colors: ['#0f172a', '#38bdf8', '#e2e8f0'] },
] as const;

export const AppearanceSettingsPanel: React.FC = () => {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const enableAnimations = useSettingsStore((state) => state.enableAnimations);
  const setEnableAnimations = useSettingsStore((state) => state.setEnableAnimations);

  return (
    <SettingsPanel title="Appearance" description="Choose the app theme and motion preferences.">
      <SettingsSectionCard title="Theme">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {themeOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setTheme(option.id)}
              className={`rounded-xl border-2 p-4 text-left transition-colors ${
                theme === option.id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-gray-700 bg-gray-950/60 hover:border-gray-600 hover:bg-gray-900'
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="font-medium text-gray-100">{option.name}</span>
                {theme === option.id ? <Check size={16} className="text-blue-300" /> : null}
              </div>
              <div className="flex gap-2">
                {option.colors.map((color) => (
                  <span
                    key={`${option.id}-${color}`}
                    className="h-6 w-6 rounded-full border border-gray-700"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </button>
          ))}
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="Motion">
        <SettingRow
          label="Enable animations"
          description="Use small interface animations, including modal minimize and restore."
          control={<SettingSwitch checked={enableAnimations} onChange={setEnableAnimations} />}
        />
      </SettingsSectionCard>
    </SettingsPanel>
  );
};

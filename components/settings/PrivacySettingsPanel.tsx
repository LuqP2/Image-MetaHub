import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { SettingRow } from './SettingRow';
import { SettingsPanel } from './SettingsPanel';
import { SettingsSectionCard } from './SettingsSectionCard';
import { SettingSwitch } from './SettingSwitch';

export const PrivacySettingsPanel: React.FC = () => {
  const sensitiveTags = useSettingsStore((state) => state.sensitiveTags);
  const setSensitiveTags = useSettingsStore((state) => state.setSensitiveTags);
  const blurSensitiveImages = useSettingsStore((state) => state.blurSensitiveImages);
  const setBlurSensitiveImages = useSettingsStore((state) => state.setBlurSensitiveImages);
  const [sensitiveTagsInput, setSensitiveTagsInput] = useState('');

  useEffect(() => {
    setSensitiveTagsInput((sensitiveTags ?? []).join(', '));
  }, [sensitiveTags]);

  return (
    <SettingsPanel title="Privacy" description="Hide or blur images that match your sensitive tags.">
      <SettingsSectionCard title="Sensitive content">
        <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3">
          <label className="text-sm font-medium text-gray-100" htmlFor="sensitive-tags-input">
            Sensitive tags
          </label>
          <input
            id="sensitive-tags-input"
            type="text"
            value={sensitiveTagsInput}
            onChange={(event) => {
              const nextValue = event.target.value;
              setSensitiveTagsInput(nextValue);
              setSensitiveTags(
                nextValue
                  .split(',')
                  .map((tag) => tag.trim().toLowerCase())
                  .filter(Boolean)
              );
            }}
            placeholder="nsfw, private, hidden"
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          <p className="text-sm text-gray-400">Separate tags with commas.</p>
        </div>

        <SettingRow
          label="Blur instead of hide"
          description="Keep matches visible with blur, instead of removing them from the grid."
          control={<SettingSwitch checked={blurSensitiveImages} onChange={setBlurSensitiveImages} />}
        />
      </SettingsSectionCard>
    </SettingsPanel>
  );
};

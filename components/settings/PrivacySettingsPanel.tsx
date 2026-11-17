import { useTranslation } from '../../i18n/useTranslation';
import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { SettingRow } from './SettingRow';
import { SettingsPanel } from './SettingsPanel';
import { SettingsSectionCard } from './SettingsSectionCard';
import { SettingSwitch } from './SettingSwitch';

export const PrivacySettingsPanel: React.FC = () => {
  const { t } = useTranslation();
  const sensitiveTags = useSettingsStore((state) => state.sensitiveTags);
  const setSensitiveTags = useSettingsStore((state) => state.setSensitiveTags);
  const blurSensitiveImages = useSettingsStore((state) => state.blurSensitiveImages);
  const setBlurSensitiveImages = useSettingsStore((state) => state.setBlurSensitiveImages);
  const civitaiLookupEnabled = useSettingsStore((state) => state.civitaiLookupEnabled);
  const setCivitaiLookupEnabled = useSettingsStore((state) => state.setCivitaiLookupEnabled);
  const [sensitiveTagsInput, setSensitiveTagsInput] = useState('');

  useEffect(() => {
    setSensitiveTagsInput((sensitiveTags ?? []).join(', '));
  }, [sensitiveTags]);

  return (
    <SettingsPanel title={t("settings.privacy.privacy")} description={t("settings.privacy.hideOrBlurImagesThatMatchYour")}>
      <SettingsSectionCard title={t("settings.privacy.sensitiveContent")}>
        <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3">
          <label className="text-sm font-medium text-gray-100" htmlFor="sensitive-tags-input">
            {t("settings.privacy.sensitiveTags")}
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
          <p className="text-sm text-gray-400">{t("settings.privacy.separateTagsWithCommas")}</p>
        </div>

        <SettingRow
          label={t("settings.privacy.blurInsteadOfHide")}
          description={t("settings.privacy.keepMatchesVisibleWithBlurInsteadOf")}
          control={<SettingSwitch checked={blurSensitiveImages} onChange={setBlurSensitiveImages} />}
        />
      </SettingsSectionCard>

      <SettingsSectionCard title={t("settings.privacy.onlineLookups")}>
        <SettingRow
          label={t("settings.privacy.civitaiLinks")}
          description={t("settings.privacy.letTheModelAndLoraNamesLink")}
          control={<SettingSwitch checked={civitaiLookupEnabled} onChange={setCivitaiLookupEnabled} />}
        />
      </SettingsSectionCard>
    </SettingsPanel>
  );
};

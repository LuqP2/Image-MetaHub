import { useTranslation, type Language } from '../../i18n/useTranslation';
import { languages, languageNames } from '../../i18n/messages.mjs';
import { useSettingsStore } from '../../store/useSettingsStore';
import { SettingRow } from './SettingRow';
import React, { useEffect, useRef } from 'react';
import { ExrSettingsPanel } from './ExrSettingsPanel';
import { SettingsPanel } from './SettingsPanel';
import type { SettingsFocusSection } from './types';

export function GeneralSettingsPanel({ focusSection }: { focusSection: SettingsFocusSection }) {
  const { language, t } = useTranslation();
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const exrSection = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusSection === 'exr') {
      exrSection.current?.scrollIntoView({ block: 'nearest' });
      exrSection.current?.focus({ preventScroll: true });
    }
  }, [focusSection]);
  return <SettingsPanel title={t("settings.general.general")}>
    <SettingRow
      label={t("settings.general.language")}
      control={
        <select
          aria-label={t("settings.general.language")}
          value={language}
          onChange={(event) => setLanguage(event.target.value as Language)}
          className="ui-select"
        >
          {languages.map((option) => <option key={option} value={option}>{languageNames[option]}</option>)}
        </select>
      }
    />
    <section aria-labelledby="optional-components-title" className="space-y-4">
      <h2 id="optional-components-title" className="text-lg font-semibold text-gray-100">{t("settings.general.optionalComponents")}</h2>
      <div ref={exrSection} tabIndex={-1} aria-label="EXR / OpenColorIO" className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <ExrSettingsPanel />
      </div>
    </section>
  </SettingsPanel>;
}

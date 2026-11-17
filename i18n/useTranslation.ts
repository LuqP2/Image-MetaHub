import { useCallback } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatMessage, type normalizeLanguage } from './messages.mjs';
import en from './en.json';

export type Language = ReturnType<typeof normalizeLanguage>;
export type MessageKey = keyof typeof en;
export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function useTranslation() {
  const language = useSettingsStore((state) => state.language);
  const t: Translate = useCallback((key, values) => formatMessage(language, key, values), [language]);
  return { language, t };
}

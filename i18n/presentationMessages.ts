import en from './en.json';
import type { MessageKey, Translate } from './useTranslation';

const messagesByEnglish = new Map<string, MessageKey>(
  (Object.keys(en) as MessageKey[]).map(key => [en[key], key]),
);

/** For IMH-owned status/error sentences only. Never apply to metadata or user content. */
export function translatePresentationMessage(message: string, t: Translate): string {
  const key = messagesByEnglish.get(message);
  return key ? t(key) : message;
}

import { formatMessage } from './messages.mjs';
import type { Translate } from './useTranslation';

const statusKeys = [
  'promptLibrary.copied', 'promptLibrary.copyFailed', 'promptLibrary.fillRequired',
  'promptLibrary.alreadySaved', 'promptLibrary.saveFailed', 'promptLibrary.bringChanged',
  'promptLibrary.bringFailed', 'promptLibrary.sourceMissing', 'canvas.addPromptFailed',
] as const;

/** Keep stored errors and external details intact; translate known presentation messages. */
export function translatePromptMessage(message: string, t: Translate): string {
  for (const key of statusKeys) {
    if (message === key || message === formatMessage('en', key)) return t(key);
  }
  return message;
}

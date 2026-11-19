import { formatMessage } from './messages.mjs';
import type { Translate } from './useTranslation';

const statusKeys = [
  'promptLibrary.copied', 'promptLibrary.copyFailed', 'promptLibrary.fillRequired',
  'promptLibrary.alreadySaved', 'promptLibrary.saveFailed', 'promptLibrary.bringChanged',
  'promptLibrary.bringFailed', 'promptLibrary.sourceMissing', 'canvas.addPromptFailed',
  'promptLibrary.variableNames', 'promptLibrary.unknownVariableType', 'promptLibrary.unsupportedDocument',
  'promptLibrary.partsList', 'promptLibrary.invalidPart', 'promptLibrary.unsupportedEditor', 'promptLibrary.promptRequired',
] as const;

/** Keep stored errors and external details intact; translate known presentation messages. */
export function translatePromptMessage(message: string, t: Translate): string {
  const detail = message.startsWith('Error: ') ? message.slice(7) : message;
  for (const key of statusKeys) {
    if (detail === key || detail === formatMessage('en', key)) return t(key);
  }
  const patterns = [
    [/^Define variable ([\s\S]+)\.$/, 'promptLibrary.defineVariable', 'variable'],
    [/^Fill ([\s\S]+)\.$/, 'promptLibrary.fillField', 'field'],
    [/^Conflicting definitions for ([\s\S]+)\. Rename the variable before inserting this block\.$/, 'promptLibrary.conflictingVariable', 'variable'],
  ] as const;
  for (const [pattern, key, argument] of patterns) {
    const match = pattern.exec(detail);
    if (match) return t(key, { [argument]: match[1] });
  }
  return message;
}

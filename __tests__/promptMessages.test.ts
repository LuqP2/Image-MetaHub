import { describe, expect, it } from 'vitest';
import { formatMessage, languages } from '../i18n/messages.mjs';
import { translatePromptMessage } from '../i18n/promptMessages';

describe('localized prompt diagnostics', () => {
  it.each(languages)('preserves original field labels in %s', language => {
    const variable = 'subject_2';
    const field = 'Original {field} 海';
    const t = (key, values?) => formatMessage(language, key, values);
    expect(translatePromptMessage(`Define variable ${variable}.`, t)).toBe(t('promptLibrary.defineVariable', { variable }));
    expect(translatePromptMessage(`Fill ${field}.`, t)).toBe(t('promptLibrary.fillField', { field }));
    expect(translatePromptMessage(`Error: Conflicting definitions for ${variable}. Rename the variable before inserting this block.`, t)).toBe(t('promptLibrary.conflictingVariable', { variable }));
    const detail = 'External detail: original {value} 海';
    expect(translatePromptMessage(detail, t)).toBe(detail);
  });
});

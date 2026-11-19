import { describe, expect, it } from 'vitest';
import { formatMessage, languages } from '../i18n/messages.mjs';
import { modelKindText, translateModelMessage } from '../i18n/modelMessages';

describe('model presentation translations', () => {
  it.each(languages)('preserves original model names and technical kinds in %s', language => {
    const t = (key, values?) => formatMessage(language, key, values);
    const name = 'Original: {model} 海.safetensors';
    expect(translateModelMessage(`${name}: no unread new versions.`, t)).toBe(t('modelLibrary.noVersionsNamed', { name }));
    expect(translateModelMessage(`${name}: new updates available — see the provider links on this model.`, t)).toBe(t('modelLibrary.updatesNamed', { name }));
    expect(translateModelMessage('Same family', t)).toBe(t('modelLibrary.sameFamily'));
    expect(modelKindText('diffusion', t)).toBe(t('modelLibrary.kindDiffusion'));
    expect(modelKindText('lora', t)).toBe('LoRA');
    expect(modelKindText('checkpoint', t)).toBe('Checkpoint');
    const externalDetail = 'Provider error: original {detail} 海';
    expect(translateModelMessage(externalDetail, t)).toBe(externalDetail);
  });
});

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SettingsModal from '../components/SettingsModal';
import { createMessageFormatter, formatMessage } from '../i18n/messages.mjs';
import { useSettingsStore } from '../store/useSettingsStore';
import { diffCatalog, pendingTranslations, reviewHash, validateCatalogs } from '../scripts/i18n-catalogs.mjs';

describe('settings language', () => {
  beforeEach(() => useSettingsStore.getState().resetState());
  afterEach(() => {
    cleanup();
    useSettingsStore.getState().resetState();
  });

  it('changes settings navigation in place and restores the choice from storage', async () => {
    render(<SettingsModal isOpen onClose={() => {}} initialTab="general" />);
    const selector = screen.getByRole('combobox', { name: 'Language' });
    fireEvent.change(selector, { target: { value: 'es' } });
    expect(screen.getByRole('dialog', { name: 'Configuración' })).toBeTruthy();
    expect(screen.getByText('Componentes opcionales')).toBeTruthy();
    fireEvent.change(selector, { target: { value: 'pt-BR' } });
    expect(screen.getByRole('dialog', { name: 'Configurações' })).toBeTruthy();
    act(() => useSettingsStore.setState({ language: 'en' }));
    // Emulate another renderer reading the persisted choice.
    localStorage.setItem('image-metahub-settings', JSON.stringify({ state: { language: 'pt-BR' }, version: 0 }));
    await act(async () => useSettingsStore.persist.rehydrate());
    expect(screen.getByRole('dialog', { name: 'Configurações' })).toBeTruthy();
  });

  it.each([undefined, 'xx'])('uses English for an absent or unsupported stored locale (%s)', async (language) => {
    localStorage.setItem('image-metahub-settings', JSON.stringify({ state: { language }, version: 0 }));
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().language).toBe('en');
  });

  it('formats plurals and preserves technical values', () => {
    expect(formatMessage('es', 'settings.library.detectedCores', { count: 1 })).toBe('Se detectó 1 núcleo lógico.');
    expect(formatMessage('pt-BR', 'settings.library.detectedCores', { count: 8 })).toBe('Foram detectados 8 núcleos lógicos.');
    expect(formatMessage('pt-BR', 'settings.integrations.connectionFailure', { error: 'KSampler {seed}' })).toBe('Falha na conexão: KSampler {seed}');
  });

  it('falls back per key when a translation is missing, invalid, or incompatible', () => {
    const format = createMessageFormatter({
      en: { missing: 'English', incompatible: 'Hello {name}', invalid: 'Try again', valid: 'Hello {name}' },
      es: { incompatible: 'Hola', invalid: '{', valid: 'Hola {name}' },
    });
    expect(format('es', 'missing')).toBe('English');
    expect(format('es', 'incompatible', { name: 'test.png' })).toBe('Hello test.png');
    expect(format('es', 'invalid')).toBe('Try again');
    expect(format('es', 'valid', { name: 'test.png' })).toBe('Hola test.png');
  });
});

describe('catalog review', () => {
  const key = 'settings.test.hello';
  const coverage = { settings: { paths: ['components/settings/'] } };
  const oldSource = { [key]: 'Hello {name}' };
  const source = { [key]: 'Welcome {name}' };
  const catalogs = { es: { [key]: 'Hola {name}' }, 'pt-BR': {} };
  const reviewed = { es: { [key]: reviewHash(oldSource[key]) }, 'pt-BR': {} };

  it('requires all reviews during initial migration and queues later changes', () => {
    expect(diffCatalog(oldSource, source)).toEqual({ added: [], changed: [key], removed: [] });
    expect(validateCatalogs(source, catalogs, reviewed, coverage, {})).toHaveLength(2);
    expect(validateCatalogs(source, catalogs, reviewed, coverage, coverage)).toEqual([]);
    expect(pendingTranslations(source, catalogs, reviewed, coverage)).toEqual([
      { key, locale: 'es', english: 'Welcome {name}', hash: reviewHash(source[key]) },
      { key, locale: 'pt-BR', english: 'Welcome {name}', hash: reviewHash(source[key]) },
    ]);
  });

  it('rejects invalid syntax and incompatible arguments on current approvals', () => {
    const approvals = { es: { [key]: reviewHash(source[key]) }, 'pt-BR': {} };
    expect(validateCatalogs(source, { ...catalogs, es: { [key]: 'Hola {' } }, approvals, coverage, coverage)).toHaveLength(1);
    expect(validateCatalogs(source, { ...catalogs, es: { [key]: 'Hola {username}' } }, approvals, coverage, coverage))
      .toEqual([`es ${key}: ICU arguments differ from the approved English message`]);
  });
});

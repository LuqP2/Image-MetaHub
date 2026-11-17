import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SettingsModal from '../components/SettingsModal';
import { createMessageFormatter, formatMessage } from '../i18n/messages.mjs';
import { useSettingsStore } from '../store/useSettingsStore';
import { diffCatalog, pendingTranslations, reviewHash, targetLanguages, validateCatalogs } from '../scripts/i18n-catalogs.mjs';

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

  it('offers Japanese and uses the shared Japanese catalog for Settings and native menus', () => {
    render(<SettingsModal isOpen onClose={() => {}} initialTab="general" />);
    expect(screen.getByRole('option', { name: '日本語' }).getAttribute('value')).toBe('ja');
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'ja' } });
    expect(screen.getByRole('dialog', { name: '設定' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '言語' })).toBeTruthy();
    expect(useSettingsStore.getState().language).toBe('ja');
    expect(formatMessage('ja', 'settings.native.file')).toBe('ファイル');
    expect(formatMessage('ja', 'settings.library.detectedCores', { count: 8 })).toBe('8 個の論理コアを検出しました。');
  });

  it.each([
    ['de', 'Deutsch', 'Einstellungen', 'Datei', 'Ordner'],
    ['fr', 'Français', 'Paramètres', 'Fichier', 'Dossiers'],
    ['ko', '한국어', '설정', '파일', '폴더'],
    ['zh-CN', '简体中文', '设置', '文件', '文件夹'],
    ['zh-TW', '繁體中文', '設定', '檔案', '資料夾'],
  ] as const)('selects %s and uses its Settings, native menu, and folder labels', (locale, name, settings, file, folders) => {
    render(<SettingsModal isOpen onClose={() => {}} initialTab="general" />);
    expect(screen.getByRole('option', { name }).getAttribute('value')).toBe(locale);
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: locale } });
    expect(screen.getByRole('dialog', { name: settings })).toBeTruthy();
    expect(useSettingsStore.getState().language).toBe(locale);
    expect(formatMessage(locale, 'settings.native.file')).toBe(file);
    expect(formatMessage(locale, 'libraryFolders.folders')).toBe(folders);
  });

  it.each([undefined, 'xx', '__proto__'])('uses English for an absent or unsupported stored locale (%s)', async (language) => {
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
    }, { es: {
      incompatible: reviewHash('Hello {name}'),
      invalid: reviewHash('Try again'),
      valid: reviewHash('Hello {name}'),
    } });
    expect(format('es', 'missing')).toBe('English');
    expect(format('es', 'incompatible', { name: 'test.png' })).toBe('Hello test.png');
    expect(format('es', 'invalid')).toBe('Try again');
    expect(format('es', 'valid', { name: 'test.png' })).toBe('Hola test.png');
  });

  it.each(['es', 'pt-BR', 'ja'])('uses current English until %s is reviewed again', (locale) => {
    const catalogs = { en: { price: 'Price: €20 for {plan}' }, [locale]: { price: 'Precio: €10 para {plan}' } };
    const format = createMessageFormatter(catalogs, { [locale]: { price: reviewHash('Price: €10 for {plan}') } });
    expect(format(locale, 'price', { plan: 'Pro' })).toBe('Price: €20 for Pro');
    expect(createMessageFormatter(catalogs, {})(locale, 'price', { plan: 'Pro' })).toBe('Price: €20 for Pro');
    const approved = { ...catalogs, [locale]: { price: '€20 — {plan}' } };
    const formatApproved = createMessageFormatter(approved, { [locale]: { price: reviewHash(catalogs.en.price) } });
    expect(formatApproved(locale, 'price', { plan: 'Pro' })).toBe('€20 — Pro');
  });
});

describe('catalog review', () => {
  const key = 'settings.test.hello';
  const coverage = { settings: { paths: ['components/settings/'] } };
  const oldSource = { [key]: 'Hello {name}' };
  const source = { [key]: 'Welcome {name}' };
  const catalogs = {
    ...Object.fromEntries(targetLanguages.map(locale => [locale, { [key]: source[key] }])),
    es: { [key]: 'Hola {name}' },
    'pt-BR': {},
    ja: { [key]: 'ようこそ、{name}さん' },
  };
  const reviewed = {
    ...Object.fromEntries(targetLanguages.map(locale => [locale, { [key]: reviewHash(source[key]) }])),
    es: { [key]: reviewHash(oldSource[key]) },
    'pt-BR': {},
  };

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
    const approvals = { ...reviewed, es: { [key]: reviewHash(source[key]) } };
    expect(validateCatalogs(source, { ...catalogs, es: { [key]: 'Hola {' } }, approvals, coverage, coverage)).toHaveLength(1);
    expect(validateCatalogs(source, { ...catalogs, es: { [key]: 'Hola {username}' } }, approvals, coverage, coverage))
      .toEqual([`es ${key}: ICU arguments differ from the approved English message`]);
  });

  it('requires current approvals for a newly added locale even in an existing module', () => {
    const baseLanguages = targetLanguages.filter(locale => locale !== 'ja');
    expect(validateCatalogs(source, catalogs, reviewed, coverage, coverage, baseLanguages)).toEqual([]);
    const missingJapanese = { ...catalogs, ja: {} };
    expect(validateCatalogs(source, missingJapanese, { ...reviewed, ja: {} }, coverage, coverage, baseLanguages))
      .toEqual([`ja ${key}: Initial migration requires an approved translation`]);
  });
});

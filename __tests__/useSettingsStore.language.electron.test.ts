import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  delete window.electronAPI;
  vi.resetModules();
});

it('saves language independently of general settings snapshots in Electron', async () => {
  const persisted = { language: 'es' };
  const saveSettings = vi.fn(async (changes: Record<string, unknown>) => {
    Object.assign(persisted, changes);
    return { success: true };
  });
  window.electronAPI = {
    getSettings: async () => ({ ...persisted }),
    saveSettings,
  } as unknown as NonNullable<Window['electronAPI']>;
  const { useSettingsStore } = await import('../store/useSettingsStore');
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().language).toBe('es');

  useSettingsStore.getState().setLanguage('pt-BR');
  await vi.waitFor(() => expect(persisted.language).toBe('pt-BR'));
  useSettingsStore.getState().setLanguage('en');
  await vi.waitFor(() => expect(persisted.language).toBe('en'));

  useSettingsStore.getState().setTheme('ayu-light');
  await vi.waitFor(() => expect(persisted).toMatchObject({ theme: 'ayu-light', language: 'en' }));
  expect(saveSettings.mock.calls.filter(([payload]) => Object.hasOwn(payload, 'language')))
    .toEqual([[{ language: 'pt-BR' }], [{ language: 'en' }]]);
});

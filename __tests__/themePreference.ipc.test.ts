import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { themeOptions, resolveTheme } from '../src/theme/themeRegistry';

const source = readFileSync(path.resolve('electron.mjs'), 'utf8');
const handlerSource = source.slice(source.indexOf("  ipcMain.handle('save-settings'"), source.indexOf("  ipcMain.handle('mark-changelog-viewed'"));

function fixture(theme: string) {
  let persisted: Record<string, unknown> = { theme, language: 'pt-BR' };
  let handler: (event: unknown, changes: unknown, options?: unknown) => Promise<unknown>;
  const broadcast = vi.fn();
  new Function('ipcMain', 'queueSettingsUpdate', 'normalizeLanguage', 'mergeSettingsUpdate', 'applyAppLanguage', 'broadcastSettingsUpdated', handlerSource)(
    { handle: (_: string, callback: typeof handler) => { handler = callback; } },
    async (update: (settings: typeof persisted) => typeof persisted) => { persisted = update(persisted); return persisted; },
    (language: string) => language,
    (current: object, changes: object) => ({ ...current, ...changes }),
    vi.fn(), broadcast,
  );
  return { save: (changes: object, options?: object) => handler({ sender: {} }, changes, options), read: () => persisted, broadcast };
}

describe('persisted theme preference', () => {
  it.each(themeOptions.map(option => option.id))('preserves %s through startup and stale window snapshots', async theme => {
    const app = fixture(theme);
    expect(await app.save({ theme: 'system', imageSize: 200 })).toEqual({ success: true });
    expect(app.read()).toMatchObject({ theme, imageSize: 200 });
    expect(await app.save({ theme: 'dark', language: 'en', viewMode: 'list' })).toEqual({ success: true });
    expect(app.read()).toMatchObject({ theme, language: 'pt-BR', viewMode: 'list' });
  });

  it.each(themeOptions.map(option => option.id))('persists an explicit %s selection independently', async theme => {
    const app = fixture('ayu');
    await app.save({ theme }, { themeOnly: true });
    await app.save({ theme: 'ayu', imageSize: 250 });
    expect(app.read()).toMatchObject({ theme, language: 'pt-BR', imageSize: 250 });
    expect(app.broadcast).toHaveBeenCalledTimes(2);
  });

  it('only resolves System to the new Dark/Light default family', () => {
    expect(resolveTheme('system', true).id).toBe('dark');
    expect(resolveTheme('system', false).id).toBe('light');
    expect(resolveTheme('ayu', false).id).toBe('ayu');
    expect(resolveTheme('ayu-light', true).id).toBe('ayu-light');
  });
});

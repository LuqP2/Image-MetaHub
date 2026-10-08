import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(path.resolve('electron.mjs'), 'utf8');
const handlersSource = source.slice(source.indexOf('function setupLicenseHandlers()'), source.indexOf('function broadcastLicenseStatusChanged('));
const mergeSource = source.slice(source.indexOf('function mergeSettingsUpdate('), source.indexOf('async function getCacheRootPath('));

const fixture = (options: { portable?: boolean; paid?: boolean; failSave?: boolean; ageDays?: number } = {}) => {
  let settings = { license: { trialActivated: true, trialStartDate: Date.now() - (options.ageDays ?? 20) * 86400000, trialExtensionStartDate: null as number | null } };
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();
  let queue = Promise.resolve();
  const broadcast = vi.fn();
  const queueSettingsUpdate = (updater: (current: typeof settings) => typeof settings) => {
    const next = queue.then(() => {
      const updated = updater(settings);
      if (options.failSave) throw new Error('Save failed');
      settings = updated;
    });
    queue = next.catch(() => {});
    return next;
  };
  new Function('ipcMain', 'desktopRuntime', 'licenseManager', 'queueSettingsUpdate', 'broadcastSettingsUpdated', `${handlersSource}\nsetupLicenseHandlers();`)(
    { handle: (name: string, handler: (...args: any[]) => Promise<any>) => handlers.set(name, handler) },
    { isPortable: options.portable },
    { getStatus: async () => ({ authorized: options.paid }) },
    queueSettingsUpdate,
    broadcast,
  );
  return { activate: () => handlers.get('trial:extend')!({ sender: {} }), getSettings: () => settings, broadcast };
};

describe('extra trial main-process boundary', () => {
  it('serializes simultaneous activations and grants only one period', async () => {
    const context = fixture();
    const originalDate = context.getSettings().license.trialStartDate;
    const results = await Promise.all([context.activate(), context.activate()]);
    expect(results.filter(result => result.success)).toHaveLength(1);
    expect(context.getSettings().license.trialStartDate).toBe(originalDate);
    expect(context.getSettings().license.trialExtensionStartDate).toBe(results.find(result => result.success).trialExtensionStartDate);
    expect(context.broadcast).toHaveBeenCalledTimes(1);
  });

  it.each([{ portable: true }, { paid: true }, { ageDays: 1 }, { failSave: true }])('rejects unavailable extensions: %j', async (options) => {
    const context = fixture(options);
    expect((await context.activate()).success).toBe(false);
    expect(context.getSettings().license.trialExtensionStartDate).toBeNull();
    expect(context.broadcast).not.toHaveBeenCalled();
  });

  it('preserves canonical activation against stale renderer settings and blocks renderer grants', () => {
    const merge = new Function('app', `${mergeSource}\nreturn mergeSettingsUpdate;`)({ getVersion: () => '0.21.0' });
    const current = { license: { trialExtensionStartDate: 123 } };
    expect(merge(current, { license: { trialExtensionStartDate: null } }).license.trialExtensionStartDate).toBe(123);
    expect(merge(current, { license: { trialExtensionStartDate: 999 } }).license.trialExtensionStartDate).toBe(123);
    expect(merge({ license: {} }, { license: { trialExtensionStartDate: 999 } }).license.trialExtensionStartDate).toBeNull();
  });
});

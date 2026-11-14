import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DAY_MS, TRIAL_DURATION_DAYS } from '../utils/trialPeriod.mjs';

const source = readFileSync(path.resolve('electron.mjs'), 'utf8');
const handlersSource = source.slice(source.indexOf('function setupLicenseHandlers()'), source.indexOf('function broadcastLicenseStatusChanged('));
const mergeSource = source.slice(source.indexOf('function mergeSettingsUpdate('), source.indexOf('async function getCacheRootPath('));

const fixture = (options: { portable?: boolean; paid?: boolean; failSave?: boolean; ageDays?: number; grantedAt?: number } = {}) => {
  let settings = { license: { trialActivated: true, trialStartDate: Date.now() - (options.ageDays ?? 20) * 86400000, trialExtensionStartDate: null as number | null, trialRelease023: options.grantedAt ? { grantedAt: options.grantedAt, noticeDismissed: false } : null } };
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
  new Function('ipcMain', 'desktopRuntime', 'licenseManager', 'queueSettingsUpdate', 'broadcastSettingsUpdated', 'TRIAL_DURATION_DAYS', 'DAY_MS', `${handlersSource}\nsetupLicenseHandlers();`)(
    { handle: (name: string, handler: (...args: any[]) => Promise<any>) => handlers.set(name, handler) },
    { isPortable: options.portable },
    { getStatus: async () => ({ authorized: options.paid }) },
    queueSettingsUpdate,
    broadcast,
    TRIAL_DURATION_DAYS,
    DAY_MS,
  );
  return { activate: () => handlers.get('trial:extend')!({ sender: {} }), dismiss: () => handlers.get('trial:dismiss-release-extension-notice')!({ sender: {} }), getSettings: () => settings, broadcast };
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

describe('release extension dismissal main-process boundary', () => {
  it('persists the dismissal without changing the grant timestamp and is safe to repeat', async () => {
    const grantedAt = Date.now();
    const context = fixture({ grantedAt });
    expect((await context.activate()).success).toBe(false);
    expect((await context.dismiss()).success).toBe(true);
    expect((await context.dismiss()).success).toBe(true);
    expect(context.getSettings().license.trialRelease023).toEqual({ grantedAt, noticeDismissed: true });
  });

  it('keeps the notification pending when its dismissal fails to save', async () => {
    const grantedAt = Date.now();
    const context = fixture({ grantedAt, failSave: true });
    expect((await context.dismiss()).success).toBe(false);
    expect(context.getSettings().license.trialRelease023).toEqual({ grantedAt, noticeDismissed: false });
  });

  it('keeps the canonical grant and dismissal across stale renderer settings writes', () => {
    const merge = new Function('app', `${mergeSource}\nreturn mergeSettingsUpdate;`)({ getVersion: () => '0.23.0' });
    const trialRelease023 = { grantedAt: Date.now(), noticeDismissed: true };
    const current = { license: { trialRelease023, trialActivated: true, trialStartDate: 123 } };
    for (const staleLicense of [null, { trialRelease023: null, trialActivated: false, trialStartDate: null }]) {
      expect(merge(current, { license: staleLicense }).license).toMatchObject(current.license);
    }
    expect(merge({ license: {} }, { license: { trialRelease023 } }).license.trialRelease023).toBeNull();
  });
});

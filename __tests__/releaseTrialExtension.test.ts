import { describe, expect, it } from 'vitest';
import { applyReleaseTrialExtension, DAY_MS, getTrialPeriod } from '../utils/trialPeriod.mjs';

const now = Date.UTC(2026, 10, 14);
const hour = DAY_MS / 24;
const launch = { version: '0.23.0', isPortable: false, authorized: false, now };
const trial = (age: number) => ({
  license: { trialActivated: true, trialStartDate: now - age },
});
const expiration = (settings: ReturnType<typeof trial>) => {
  const { startDate, durationDays } = getTrialPeriod(settings.license);
  return startDate! + durationDays * DAY_MS;
};

describe('0.23.0 trial extension on first launch', () => {
  it.each([8 * DAY_MS, 7 * DAY_MS, 7 * DAY_MS - hour])(
    'gives exactly 72 hours from launch when the original trial age is %d ms',
    (age) => {
      const settings = trial(age);
      const next = applyReleaseTrialExtension(settings, launch);
      expect(next.license).toMatchObject({
        ...settings.license,
        trialRelease023: { grantedAt: now, noticeDismissed: false },
      });
      expect(expiration(next)).toBe(now + 72 * hour);
    },
  );

  it.each([2, 3])('leaves an active %d-day-old trial unchanged', (ageDays) => {
    const settings = trial(ageDays * DAY_MS);
    const next = applyReleaseTrialExtension(settings, launch);
    expect(next.license.trialRelease023.grantedAt).toBeNull();
    expect(expiration(next)).toBe(expiration(settings));
    expect(applyReleaseTrialExtension(next, { ...launch, now: now + 8 * DAY_MS })).toBe(next);
  });

  it('preserves standard activation for first-time users and does not extend that trial later', () => {
    const next = applyReleaseTrialExtension({}, launch);
    expect(next.license).toEqual({ trialRelease023: { grantedAt: null, noticeDismissed: false } });
    Object.assign(next.license, { trialActivated: true, trialStartDate: now });
    expect(expiration(next)).toBe(now + 7 * DAY_MS);
    expect(applyReleaseTrialExtension(next, { ...launch, now: now + 8 * DAY_MS })).toBe(next);
  });

  it.each(['pro', 'lifetime'])('does not extend an old trial for active %s license holders', (licenseStatus) => {
    const settings = trial(20 * DAY_MS);
    Object.assign(settings.license, { licenseStatus });
    const next = applyReleaseTrialExtension(settings, { ...launch, authorized: true });
    expect(next.license).toMatchObject({ ...settings.license, trialRelease023: { grantedAt: null } });
    expect(expiration(next)).toBe(expiration(settings));
  });

  it('does not regrant after a restart, even once the extension expires', () => {
    const saved = JSON.parse(JSON.stringify(applyReleaseTrialExtension(trial(8 * DAY_MS), launch)));
    for (const nowOnRestart of [now + hour, now + 4 * DAY_MS]) {
      expect(applyReleaseTrialExtension(saved, { ...launch, now: nowOnRestart })).toBe(saved);
      expect(expiration(saved)).toBe(now + 72 * hour);
    }
  });

  it('accounts for a previous manual extension and preserves its history', () => {
    const settings = trial(20 * DAY_MS);
    const manualStart = now - DAY_MS;
    Object.assign(settings.license, { trialExtensionStartDate: manualStart });
    const next = applyReleaseTrialExtension(settings, launch);
    expect(next.license.trialExtensionStartDate).toBe(manualStart);
    expect(expiration(next)).toBe(now + 72 * hour);
  });

  it.each([{ version: '0.23.1' }, { isPortable: true }])('skips other versions and Portable (%j)', (runtime) => {
    const settings = trial(8 * DAY_MS);
    expect(applyReleaseTrialExtension(settings, { ...launch, ...runtime })).toBe(settings);
  });
});

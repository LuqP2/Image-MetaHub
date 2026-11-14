export const TRIAL_DURATION_DAYS = 7;
export const TRIAL_EXTENSION_DAYS = 3;
export const TRIAL_EXTENSION_RELEASE = '0.23.0';
export const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {{trialStartDate: number | null, trialExtensionStartDate?: number | null, trialRelease023?: {grantedAt: number | null} | null}} trial */
export function getTrialPeriod(trial) {
  const extension = trial.trialRelease023?.grantedAt ?? trial.trialExtensionStartDate;
  return {
    startDate: extension ?? trial.trialStartDate,
    durationDays: extension ? TRIAL_EXTENSION_DAYS : TRIAL_DURATION_DAYS,
  };
}

/**
 * Snapshot eligibility once on the release's first launch. The grant timestamp
 * is both the one-time record and the start of the replacement trial period.
 * @param {object} settings
 * @param {{version: string, isPortable: boolean, authorized: boolean, now: number}} launch
 */
export function applyReleaseTrialExtension(settings, { version, isPortable, authorized, now }) {
  const license = settings.license ?? {};
  if (version !== TRIAL_EXTENSION_RELEASE || isPortable || license.trialRelease023) return settings;

  const period = getTrialPeriod(license);
  const hasTrialHistory = license.trialActivated === true
    && Number.isFinite(license.trialStartDate) && license.trialStartDate > 0;
  const eligible = !authorized && hasTrialHistory
    && Number.isFinite(period.startDate) && period.startDate >= license.trialStartDate
    && now >= period.startDate
    && period.startDate + period.durationDays * DAY_MS - now < TRIAL_EXTENSION_DAYS * DAY_MS;

  return {
    ...settings,
    license: {
      ...license,
      trialRelease023: { grantedAt: eligible ? now : null, noticeDismissed: false },
      ...(eligible ? {
        licenseStatus: 'trial',
        trialExpiredNoticeDismissed: false,
      } : {}),
      // Keep previous release migrations from resetting an existing trial.
      ...(!authorized && hasTrialHistory ? {
        migrationResetApplied: true,
        expiredTrialResetApplied: true,
        nextReleaseTrialResetApplied: true,
        trialDurationV2ResetApplied: true,
      } : {}),
    },
  };
}

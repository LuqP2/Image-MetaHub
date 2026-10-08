import { useEffect } from 'react';
import { getTrialPeriod, useLicenseStore } from '../store/useLicenseStore';
/** Small cushion so the refresh lands past the deadline, not exactly on it. */
const EXPIRY_CHECK_BUFFER_MS = 1000;

/**
 * `checkLicenseStatus` only runs at startup, so a trial that lapses while the app stays
 * open leaves `licenseStatus` stuck on 'trial' until the next restart — Pro features lock
 * (those derive from the timestamp) while the header still reads "Free" and the post-trial
 * notice never appears. Re-deriving from the timestamp in the consumers would not fix it on
 * its own: nothing re-renders just because wall-clock time passed. Refreshing the status at
 * the deadline updates the store, which re-renders every consumer at once.
 *
 * Mount once, at the app root.
 */
export const useTrialExpiryWatcher = (): void => {
  const licenseStatus = useLicenseStore((state) => state.licenseStatus);
  const trialStartDate = useLicenseStore((state) => state.trialStartDate);
  const trialExtensionStartDate = useLicenseStore((state) => state.trialExtensionStartDate);

  useEffect(() => {
    if (licenseStatus !== 'trial' || !trialStartDate) {
      return;
    }

    // `checkIfTrialExpired` compares with a strict `now > trialEnd`, so firing exactly on the
    // deadline would re-derive 'trial' and do nothing. Land just past it.
    const period = getTrialPeriod({ trialStartDate, trialExtensionStartDate });
    const msUntilExpiry = period.startDate! + period.durationDays * 24 * 60 * 60 * 1000 + EXPIRY_CHECK_BUFFER_MS - Date.now();
    const timer = setTimeout(() => {
      void useLicenseStore.getState().checkLicenseStatus();
    }, Math.max(0, msUntilExpiry));

    return () => clearTimeout(timer);
  }, [licenseStatus, trialStartDate, trialExtensionStartDate]);
};

import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import type { LicenseClientStatus, LicensePlan } from '../types';

let suppressElectronStorageWrites = false;

// --- Electron IPC-based storage for Zustand ---
// This storage adapter will be used if the app is running in Electron.
const electronStorage: StateStorage = {
  getItem: async (): Promise<string | null> => {
    if (window.electronAPI) {
      const settings = await window.electronAPI.getSettings();

      // License data is stored under 'license' key in settings
      const licenseData = settings?.license;
      if (!licenseData) return null;

      return JSON.stringify({ state: licenseData });
    }
    return null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (window.electronAPI && !suppressElectronStorageWrites) {
      const { state } = JSON.parse(value);
      const currentSettings = await window.electronAPI.getSettings();
      const result = await window.electronAPI.saveSettings({
        ...currentSettings,
        license: { ...(currentSettings?.license ?? {}), ...state },
      });
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to persist license settings.');
      }
    }
  },
  removeItem: async (): Promise<void> => {
    console.warn('Clearing license is not implemented.');
  },
};

// Check if running in Electron
const isElectron = !!window.electronAPI;

// Trial duration (shared across UI)
export const TRIAL_DURATION_DAYS = 7;

// Type definitions
type LicenseStatus = 'free' | 'trial' | 'expired' | 'pro' | 'lifetime';

interface LicenseState {
  // Initialization
  initialized: boolean;
  migrationResetApplied: boolean;
  expiredTrialResetApplied: boolean;
  nextReleaseTrialResetApplied: boolean;
  trialDurationV2ResetApplied: boolean;

  // Trial tracking
  trialStartDate: number | null;
  trialActivated: boolean;

  // License info
  licenseStatus: LicenseStatus;
  licenseKey: string | null;
  licenseEmail: string | null;
  licensePlan: LicensePlan | null;
  licenseMessage: string | null;

  /**
   * One-time dismissal of the post-trial notice. Set once the user closes it, so the
   * surface never comes back on its own. Re-armed only when a new trial is activated.
   */
  trialExpiredNoticeDismissed: boolean;

  // Actions
  activateTrial: () => void;
  checkLicenseStatus: () => Promise<void>;
  activateLicense: (key: string, email: string) => Promise<boolean>;
  refreshLicense: () => Promise<boolean>;
  deactivateLicense: () => Promise<boolean>;
  dismissTrialExpiredNotice: () => void;
  _resetLicense: () => void;
}

const clearStoredLicenseState = () => ({
  licenseStatus: 'free' as LicenseStatus,
  licenseKey: null,
  licenseEmail: null,
  licensePlan: null,
  licenseMessage: null,
});

const stateFromAuthority = (status: LicenseClientStatus) => ({
  initialized: true,
  licenseStatus: status.licenseStatus as LicenseStatus,
  licenseKey: null,
  licenseEmail: status.licenseEmail,
  licensePlan: status.plan,
  licenseMessage: status.message,
});

// Helper: Check if trial has expired
const checkIfTrialExpired = (trialStartDate: number | null): boolean => {
  if (!trialStartDate) return false;

  const now = Date.now();
  const trialEnd = trialStartDate + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;

  // Detect clock rollback
  if (now < trialStartDate) {
    console.warn('[IMH] Clock rollback detected, disabling trial');
    return true;
  }

  // Check if trial period ended
  return now > trialEnd;
};

export const mergePersistedLicenseState = (
  persistedState: unknown,
  currentState: LicenseState,
): LicenseState => {
  const persisted = (persistedState ?? {}) as Partial<LicenseState>;
  const persistedMigrationStatus = persisted.licenseStatus === 'trial' || persisted.licenseStatus === 'expired'
    ? persisted.licenseStatus
    : 'free';

  if (currentState.initialized) {
    return {
      ...currentState,
      ...persisted,
      initialized: true,
      licenseStatus: currentState.licenseStatus,
      licenseKey: currentState.licenseKey,
      licenseEmail: currentState.licenseEmail,
      licensePlan: currentState.licensePlan,
      licenseMessage: currentState.licenseMessage,
    };
  }

  return {
    ...currentState,
    ...persisted,
    initialized: false,
    licenseStatus: persistedMigrationStatus,
    licensePlan: null,
    licenseMessage: null,
  };
};

export const useLicenseStore = create<LicenseState>()(
  persist(
    (set, get) => ({
      // Initial state
      initialized: false,
      migrationResetApplied: false,
      expiredTrialResetApplied: false,
      nextReleaseTrialResetApplied: false,
      trialDurationV2ResetApplied: false,
      trialStartDate: null,
      trialActivated: false,
      licenseStatus: 'free',
      licenseKey: null,
      licenseEmail: null,
      licensePlan: null,
      licenseMessage: null,
      trialExpiredNoticeDismissed: false,

      // Activate trial (only works once)
      activateTrial: () => {
        const state = get();

        // Only activate once
        if (state.trialActivated) {
          console.log('[IMH] Trial already activated');
          set({ initialized: true, licenseStatus: checkIfTrialExpired(state.trialStartDate) ? 'expired' : 'trial' });
          return;
        }

        const now = Date.now();

        set({
          trialStartDate: now,
          trialActivated: true,
          licenseStatus: 'trial',
          initialized: true,
          // A fresh trial re-arms the post-trial notice for when this one ends.
          trialExpiredNoticeDismissed: false,
        });

        console.log(`[IMH] Trial activated! ${TRIAL_DURATION_DAYS} days of Pro features unlocked.`);
      },

      // Check license status (called on app start and periodically)
      checkLicenseStatus: async () => {
        let state = get();

        if (isElectron) {
          try {
            const authorityStatus = await window.electronAPI.getLicenseStatus();
            if (authorityStatus.authorized) {
              set({
                ...stateFromAuthority(authorityStatus),
                migrationResetApplied: true,
                expiredTrialResetApplied: true,
                nextReleaseTrialResetApplied: true,
                trialDurationV2ResetApplied: true,
              });
              return;
            }

            const localTrialStatus = state.licenseStatus === 'trial' || state.licenseStatus === 'expired'
              ? state.licenseStatus
              : 'free';
            set({
              initialized: true,
              licenseStatus: localTrialStatus,
              licenseKey: authorityStatus.migrationRequired ? state.licenseKey : null,
              licenseEmail: authorityStatus.licenseEmail ?? (authorityStatus.migrationRequired ? state.licenseEmail : null),
              licensePlan: null,
              licenseMessage: authorityStatus.message,
            });
            if (authorityStatus.migrationRequired) return;
            state = get();
          } catch {
            set({
              initialized: true,
              licenseStatus: 'free',
              licenseMessage: 'License status is temporarily unavailable.',
            });
            return;
          }
        } else if (state.licenseStatus === 'pro' || state.licenseStatus === 'lifetime') {
          // Browser builds have no trusted main process and cannot authorize a
          // persisted paid state.
          set({ ...clearStoredLicenseState(), initialized: true });
          return;
        }

        // One-time migration: reset auto-start trials from 0.10.x to opt-in flow
        if (!state.migrationResetApplied && state.trialActivated && (state.licenseStatus === 'trial' || state.licenseStatus === 'expired')) {
          set({
            trialStartDate: null,
            trialActivated: false,
            licenseStatus: 'free',
            migrationResetApplied: true,
            expiredTrialResetApplied: true,
            nextReleaseTrialResetApplied: true,
            initialized: true,
          });
          console.log('[IMH] Trial reset to Free due to opt-in change. User can start a fresh trial.');
          return;
        } else if (!state.migrationResetApplied) {
          set({ migrationResetApplied: true });
        }

        // One-time migration: let users with an already-finished trial start a fresh 3-day trial
        if (!state.expiredTrialResetApplied && state.trialActivated && state.licenseStatus === 'expired') {
          set({
            trialStartDate: null,
            trialActivated: false,
            licenseStatus: 'free',
            migrationResetApplied: true,
            expiredTrialResetApplied: true,
            nextReleaseTrialResetApplied: true,
            initialized: true,
          });
          console.log('[IMH] Expired trial reset to Free due to trial duration change. User can start a fresh trial.');
          return;
        } else if (!state.expiredTrialResetApplied) {
          set({ expiredTrialResetApplied: true });
        }

        // Re-read state after applying previous migrations
        // This ensures we have the latest migration flags before proceeding
        let currentState = get();

        // Next Release Migration: Reset all expired and active trials for non-Pro users
        // Only applies after previous migrations have been processed
        if (!currentState.nextReleaseTrialResetApplied && currentState.migrationResetApplied && currentState.expiredTrialResetApplied && currentState.trialActivated && (currentState.licenseStatus === 'expired' || currentState.licenseStatus === 'trial')) {
          set({
            trialStartDate: null,
            trialActivated: false,
            licenseStatus: 'free',
            nextReleaseTrialResetApplied: true,
            initialized: true,
          });
          console.log('[IMH] Trial reset for next release. Non-Pro users can start a fresh trial.');
          return;
        } else if (!currentState.nextReleaseTrialResetApplied) {
          set({ nextReleaseTrialResetApplied: true });
        }

        currentState = get();

        // One-time migration: trial duration reverted from 3 to 7 days. Let users who already
        // burned through the 3-day trial start a fresh 7-day trial.
        if (!currentState.trialDurationV2ResetApplied && currentState.licenseStatus === 'expired') {
          set({
            trialStartDate: null,
            trialActivated: false,
            licenseStatus: 'free',
            trialDurationV2ResetApplied: true,
            initialized: true,
          });
          console.log('[IMH] Expired trial reset to Free due to trial duration reverting to 7 days. User can start a fresh trial.');
          return;
        } else if (!currentState.trialDurationV2ResetApplied) {
          set({ trialDurationV2ResetApplied: true });
        }

        currentState = get();

        // If trial never started, stay in free mode
        if (!currentState.trialActivated) {
          set({ initialized: true, ...clearStoredLicenseState(), trialStartDate: null, trialActivated: false });
          return;
        }

        // Derive trial status from stored dates
        const trialExpired = checkIfTrialExpired(currentState.trialStartDate) || !currentState.trialStartDate;
        const nextStatus: LicenseStatus = trialExpired ? 'expired' : 'trial';

        set({
          licenseStatus: nextStatus,
          initialized: true,
          migrationResetApplied: true,
          expiredTrialResetApplied: true,
          nextReleaseTrialResetApplied: true,
          trialDurationV2ResetApplied: true,
        });

        if (trialExpired) {
          console.log('[IMH] Trial expired. Upgrade to Pro to unlock features.');
        }
      },

      // Paid entitlement authority lives in Electron main. The renderer receives
      // only a summarized status and never the signed certificate.
      activateLicense: async (key: string, email: string) => {
        if (!key || !email || !isElectron) {
          set({ licenseMessage: isElectron ? 'Please enter both email and license key.' : 'License activation requires the desktop app.' });
          return false;
        }

        try {
          const result = await window.electronAPI.activateLicense(key, email);
          applyLicenseAuthorityStatus(result.status);
          if (!result.activated) {
            return false;
          }
          return true;
        } catch {
          set({ licenseMessage: 'License service is temporarily unavailable.' });
          return false;
        }
      },

      refreshLicense: async () => {
        if (!isElectron) return false;
        const result = await window.electronAPI.refreshLicense();
        set(result.authorized ? stateFromAuthority(result) : {
          ...clearStoredLicenseState(),
          initialized: true,
          licenseMessage: result.message,
        });
        return result.authorized;
      },

      deactivateLicense: async () => {
        if (!isElectron) return false;
        const result = await window.electronAPI.deactivateLicense();
        set({
          ...clearStoredLicenseState(),
          initialized: true,
          licenseMessage: result.message,
        });
        return !result.authorized;
      },

      // Dismiss the post-trial notice for good (until a new trial is activated)
      dismissTrialExpiredNotice: () => {
        set({ trialExpiredNoticeDismissed: true });
      },

      // Dev only: reset license
      _resetLicense: () => {
        if (process.env.NODE_ENV !== 'development') {
          console.warn('[IMH] _resetLicense is only available in development');
          return;
        }

        set({
          initialized: false,
          migrationResetApplied: false,
          expiredTrialResetApplied: false,
          nextReleaseTrialResetApplied: false,
          trialDurationV2ResetApplied: false,
          trialStartDate: null,
          trialActivated: false,
          licenseStatus: 'free',
          licenseKey: null,
          licenseEmail: null,
          licensePlan: null,
          licenseMessage: null,
          trialExpiredNoticeDismissed: false,
        });

        console.log('[IMH] License reset');
      },
    }),
    {
      name: 'image-metahub-license',
      storage: createJSONStorage(() => (isElectron ? electronStorage : localStorage)),
      partialize: (state) => ({
        migrationResetApplied: state.migrationResetApplied,
        expiredTrialResetApplied: state.expiredTrialResetApplied,
        nextReleaseTrialResetApplied: state.nextReleaseTrialResetApplied,
        trialDurationV2ResetApplied: state.trialDurationV2ResetApplied,
        trialStartDate: state.trialStartDate,
        trialActivated: state.trialActivated,
        trialExpiredNoticeDismissed: state.trialExpiredNoticeDismissed,
      }),
      merge: mergePersistedLicenseState,
    }
  )
);

export const applyLicenseAuthorityStatus = (status: LicenseClientStatus) => {
  if (status.authorized) {
    useLicenseStore.setState(stateFromAuthority(status));
    return;
  }
  useLicenseStore.setState((currentState) => (
    currentState.licenseStatus === 'trial' || currentState.licenseStatus === 'expired'
      ? { initialized: true, licenseMessage: status.message }
      : {
          ...clearStoredLicenseState(),
          initialized: true,
          licenseEmail: status.licenseEmail,
          licenseMessage: status.message,
        }
  ));
};

// License data shares the settings file across every renderer. When another
// window activates a trial or license, rehydrate this renderer so its Pro state
// updates immediately instead of remaining stale until the app is reloaded.
if (typeof window !== 'undefined') {
  window.electronAPI?.onLicenseStatusChanged?.(applyLicenseAuthorityStatus);
  window.electronAPI?.onSettingsUpdated?.(() => {
    suppressElectronStorageWrites = true;
    void Promise.resolve(useLicenseStore.persist.rehydrate())
      .then(() => useLicenseStore.getState().checkLicenseStatus())
      .finally(() => {
        suppressElectronStorageWrites = false;
      });
  });
}

import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';

// --- Electron IPC-based storage for Zustand ---
// This storage adapter will be used if the app is running in Electron.
const electronStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
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
    if (window.electronAPI) {
      const { state } = JSON.parse(value);
      const currentSettings = await window.electronAPI.getSettings();
      await window.electronAPI.saveSettings({ ...currentSettings, license: state });
    }
  },
  removeItem: async (name: string): Promise<void> => {
    console.warn('Clearing license is not implemented.');
  },
};

// Check if running in Electron
const isElectron = !!window.electronAPI;

// Type definitions
type LicenseStatus = 'trial' | 'expired' | 'pro' | 'lifetime';

interface LicenseState {
  // Initialization
  initialized: boolean;

  // Trial tracking
  trialStartDate: number | null;
  trialActivated: boolean;

  // License info
  licenseStatus: LicenseStatus;
  licenseKey: string | null;
  licenseEmail: string | null;

  // Actions
  activateTrial: () => void;
  checkLicenseStatus: () => void;
  activateLicense: (key: string, email: string) => Promise<boolean>;
  _resetLicense: () => void;
}

// Helper: Check if trial has expired
const checkIfTrialExpired = (trialStartDate: number | null): boolean => {
  if (!trialStartDate) return false;

  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
  const trialEnd = trialStartDate + sevenDays;

  // Detect clock rollback
  if (now < trialStartDate) {
    console.warn('[IMH] Clock rollback detected, disabling trial');
    return true;
  }

  // Check if trial period ended
  return now > trialEnd;
};

export const useLicenseStore = create<LicenseState>()(
  persist(
    (set, get) => ({
      // Initial state
      initialized: false,
      trialStartDate: null,
      trialActivated: false,
      licenseStatus: 'trial',
      licenseKey: null,
      licenseEmail: null,

      // Activate trial (only works once)
      activateTrial: () => {
        const state = get();

        // Only activate once
        if (state.trialActivated) {
          console.log('[IMH] Trial already activated');
          set({ initialized: true });
          return;
        }

        const now = Date.now();

        set({
          trialStartDate: now,
          trialActivated: true,
          licenseStatus: 'trial',
          initialized: true,
        });

        console.log('✅ [IMH] Trial activated! 7 days of Pro features unlocked.');
      },

      // Check license status (called on app start and periodically)
      checkLicenseStatus: () => {
        const state = get();

        // If Pro/Lifetime, keep that status
        if (state.licenseStatus === 'pro' || state.licenseStatus === 'lifetime') {
          set({ initialized: true });
          return;
        }

        // Check if trial expired
        if (state.licenseStatus === 'trial' && checkIfTrialExpired(state.trialStartDate)) {
          set({
            licenseStatus: 'expired',
            initialized: true,
          });
          console.log('⚠️ [IMH] Trial expired. Upgrade to Pro to unlock features.');
          return;
        }

        // Mark as initialized
        set({ initialized: true });
      },

      // Activate license (future: will validate with LemonSqueezy/Gumroad)
      activateLicense: async (key: string, email: string) => {
        // TODO: Validate with LemonSqueezy/Gumroad API
        // For now, simple client-side check
        if (!key || !email) return false;

        // Placeholder: accept any key starting with 'IMH-PRO-' or 'IMH-LIFE-'
        if (key.startsWith('IMH-PRO-')) {
          set({
            licenseStatus: 'pro',
            licenseKey: key,
            licenseEmail: email,
            initialized: true,
          });
          console.log('✅ [IMH] Pro license activated!');
          return true;
        }

        if (key.startsWith('IMH-LIFE-')) {
          set({
            licenseStatus: 'lifetime',
            licenseKey: key,
            licenseEmail: email,
            initialized: true,
          });
          console.log('✅ [IMH] Lifetime license activated!');
          return true;
        }

        console.error('[IMH] Invalid license key format');
        return false;
      },

      // Dev only: reset license
      _resetLicense: () => {
        if (process.env.NODE_ENV !== 'development') {
          console.warn('[IMH] _resetLicense is only available in development');
          return;
        }

        set({
          initialized: false,
          trialStartDate: null,
          trialActivated: false,
          licenseStatus: 'trial',
          licenseKey: null,
          licenseEmail: null,
        });

        console.log('🔄 [IMH] License reset');
      },
    }),
    {
      name: 'image-metahub-license',
      storage: createJSONStorage(() => (isElectron ? electronStorage : localStorage)),
    }
  )
);

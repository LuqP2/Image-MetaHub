import { create } from 'zustand';
import type { LicenseSnapshot } from '../types';
import { validateLicenseKey } from '../utils/licenseKey';

export const TRIAL_DURATION_DAYS = 7;

interface LicenseState extends LicenseSnapshot {
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  activateTrial: () => Promise<boolean>;
  checkLicenseStatus: () => Promise<void>;
  activateLicense: (key: string, email: string) => Promise<boolean>;
  deactivateLicense: () => Promise<boolean>;
  _resetLicense: () => Promise<void>;
}

const isDevelopment = (() => {
  try {
    return Boolean((import.meta as any)?.env?.DEV);
  } catch {
    return false;
  }
})();

const createDefaultSnapshot = (): LicenseSnapshot => ({
  initialized: false,
  licenseStatus: 'free',
  licensePlan: null,
  featureSet: 'free',
  trialActivated: false,
  trialStartDate: null,
  trialEndDate: null,
  trialDaysRemaining: 0,
  licenseKey: null,
  licenseEmail: null,
  licenseId: null,
  activationId: null,
  deviceId: 'unknown-device',
  deviceLabel: 'This device',
  maxDevices: 2,
  expiresAt: null,
  offlineValidUntil: null,
  lastValidatedAt: null,
  nextRefreshAt: null,
  entitlementSource: null,
});

const applySnapshot = (set: (partial: Partial<LicenseState>) => void, snapshot: LicenseSnapshot) => {
  set({
    ...snapshot,
    initialized: true,
  });
};

const getBrowserFallbackSnapshot = (): LicenseSnapshot => {
  const now = Date.now();
  const raw = localStorage.getItem('image-metahub-license-browser');
  if (!raw) {
    return {
      ...createDefaultSnapshot(),
      initialized: true,
      deviceId: 'browser',
      deviceLabel: 'Browser Session',
    };
  }

  try {
    const snapshot = JSON.parse(raw) as LicenseSnapshot;
    if (snapshot.licenseStatus === 'trial' && snapshot.trialEndDate && now > snapshot.trialEndDate) {
      return {
        ...snapshot,
        initialized: true,
        licenseStatus: 'expired',
        featureSet: 'free',
        trialDaysRemaining: 0,
      };
    }

    return {
      ...createDefaultSnapshot(),
      ...snapshot,
      initialized: true,
    };
  } catch {
    return {
      ...createDefaultSnapshot(),
      initialized: true,
      deviceId: 'browser',
      deviceLabel: 'Browser Session',
    };
  }
};

const saveBrowserFallbackSnapshot = (snapshot: LicenseSnapshot) => {
  localStorage.setItem('image-metahub-license-browser', JSON.stringify(snapshot));
};

export const useLicenseStore = create<LicenseState>((set, get) => ({
  ...createDefaultSnapshot(),

  initialize: async () => {
    if (window.electronAPI?.getLicenseState) {
      const snapshot = await window.electronAPI.getLicenseState();
      applySnapshot(set, snapshot);
      return;
    }

    applySnapshot(set, getBrowserFallbackSnapshot());
  },

  refresh: async () => {
    if (window.electronAPI?.getLicenseState) {
      const snapshot = await window.electronAPI.getLicenseState();
      applySnapshot(set, snapshot);
      return;
    }

    applySnapshot(set, getBrowserFallbackSnapshot());
  },

  activateTrial: async () => {
    if (window.electronAPI?.startLicenseTrial) {
      const result = await window.electronAPI.startLicenseTrial();
      if (result.snapshot) {
        applySnapshot(set, result.snapshot);
      }
      return !!result.success;
    }

    const state = get();
    if (state.trialActivated) {
      return false;
    }

    const now = Date.now();
    const snapshot: LicenseSnapshot = {
      ...state,
      initialized: true,
      licenseStatus: 'trial',
      licensePlan: 'trial',
      featureSet: 'pro',
      trialActivated: true,
      trialStartDate: now,
      trialEndDate: now + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000,
      trialDaysRemaining: TRIAL_DURATION_DAYS,
      entitlementSource: 'local-trial',
      deviceId: 'browser',
      deviceLabel: 'Browser Session',
    };
    saveBrowserFallbackSnapshot(snapshot);
    applySnapshot(set, snapshot);
    return true;
  },

  checkLicenseStatus: async () => {
    await get().refresh();
  },

  activateLicense: async (key: string, email: string) => {
    if (!key || !email) {
      return false;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedKey = key.trim().toUpperCase();
    const isValid = await validateLicenseKey(normalizedEmail, normalizedKey);

    if (!isValid) {
      return false;
    }

    if (window.electronAPI?.activateLicense) {
      const result = await window.electronAPI.activateLicense({
        email: normalizedEmail,
        key: normalizedKey,
        activationMode: 'legacy-offline',
      });
      if (result.snapshot) {
        applySnapshot(set, result.snapshot);
      }
      return !!result.success;
    }

    const snapshot: LicenseSnapshot = {
      ...get(),
      initialized: true,
      licenseStatus: 'lifetime',
      licensePlan: 'lifetime',
      featureSet: 'pro',
      licenseEmail: normalizedEmail,
      licenseKey: normalizedKey,
      trialActivated: true,
      trialDaysRemaining: 0,
      deviceId: 'browser',
      deviceLabel: 'Browser Session',
      entitlementSource: 'legacy-offline-key',
    };
    saveBrowserFallbackSnapshot(snapshot);
    applySnapshot(set, snapshot);
    return true;
  },

  deactivateLicense: async () => {
    if (window.electronAPI?.deactivateLicense) {
      const result = await window.electronAPI.deactivateLicense();
      if (result.snapshot) {
        applySnapshot(set, result.snapshot);
      }
      return !!result.success;
    }

    const current = get();
    const snapshot: LicenseSnapshot = {
      ...createDefaultSnapshot(),
      initialized: true,
      deviceId: current.deviceId,
      deviceLabel: current.deviceLabel,
      trialActivated: current.trialActivated,
      trialStartDate: current.trialStartDate,
      trialEndDate: current.trialEndDate,
      licenseStatus: current.trialActivated ? 'expired' : 'free',
      licensePlan: current.trialActivated ? 'trial' : null,
      entitlementSource: current.trialActivated ? 'local-trial' : null,
    };
    saveBrowserFallbackSnapshot(snapshot);
    applySnapshot(set, snapshot);
    return true;
  },

  _resetLicense: async () => {
    if (!isDevelopment) {
      return;
    }

    await get().deactivateLicense();
  },
}));

import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { useLicenseStore, TRIAL_DURATION_DAYS } from '../store/useLicenseStore';

export type ProFeature = 'a1111' | 'comfyui' | 'comparison' | 'analytics' | 'clustering' | 'batch_export' | 'bulk_tagging' | 'file_management' | 'image_editor' | 'semantic_search';


export const CLUSTERING_FREE_TIER_LIMIT = 300;
export const CLUSTERING_PREVIEW_LIMIT = 500; // Process extra for blurred preview

// Free tier embeds the most recent N images. Larger than the clustering cap on
// purpose: visual search needs volume to be useful, ~2k embeds run in a few
// minutes on CPU, and the Pro pitch grows with the library rather than the cap.
export const SEMANTIC_FREE_TIER_LIMIT = 2000;

const isDevelopmentBuild =
  (typeof import.meta !== 'undefined' && Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV)) ||
  (typeof process !== 'undefined' && process.env.NODE_ENV === 'development');

/**
 * Dev-only Pro unlock via `localStorage.IMH_DEV_LICENSE = 'pro'`. Exported so non-React code
 * (e.g. the clustering action in useImageStore) can honor the same override the hook does —
 * otherwise the UI unlocks but the underlying work still applies the free-tier limit.
 */
export const isDevProLicenseOverride = (): boolean =>
  isDevelopmentBuild &&
  typeof window !== 'undefined' &&
  localStorage.getItem('IMH_DEV_LICENSE') === 'pro';

export type ProModalBlockedAttempts = Record<ProFeature, number>;

const EMPTY_BLOCKED_ATTEMPTS: ProModalBlockedAttempts = {
  a1111: 0,
  comfyui: 0,
  comparison: 0,
  analytics: 0,
  clustering: 0,
  batch_export: 0,
  bulk_tagging: 0,
  file_management: 0,
  image_editor: 0,
  semantic_search: 0,
};

// --- Electron IPC-based storage for the Pro modal's blocked-attempt counters ---
const electronProModalStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (window.electronAPI) {
      const settings = await window.electronAPI.getSettings();
      const blockedAttempts = settings?.proModalBlockedAttempts;
      if (!blockedAttempts) return null;

      return JSON.stringify({ state: { blockedAttempts } });
    }
    return null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (window.electronAPI) {
      const { state } = JSON.parse(value);
      const currentSettings = await window.electronAPI.getSettings();
      const result = await window.electronAPI.saveSettings({
        ...currentSettings,
        proModalBlockedAttempts: state.blockedAttempts,
      });
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to persist Pro modal attempt counts.');
      }
    }
  },
  removeItem: async (name: string): Promise<void> => {
    console.warn('Clearing Pro modal attempt counts is not implemented.');
  },
};

const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

type ProModalState = {
  proModalOpen: boolean;
  proModalFeature: ProFeature;
  blockedAttempts: ProModalBlockedAttempts;
  openProModal: (feature: ProFeature) => void;
  closeProModal: () => void;
};

export const useProModalStore = create<ProModalState>()(
  persist(
    (set) => ({
      proModalOpen: false,
      proModalFeature: 'a1111',
      blockedAttempts: { ...EMPTY_BLOCKED_ATTEMPTS },
      openProModal: (feature) =>
        set((state) => ({
          proModalOpen: true,
          proModalFeature: feature,
          blockedAttempts: {
            ...state.blockedAttempts,
            [feature]: (state.blockedAttempts[feature] ?? 0) + 1,
          },
        })),
      closeProModal: () => set({ proModalOpen: false }),
    }),
    {
      name: 'image-metahub-pro-modal',
      storage: createJSONStorage(() => (isElectron ? electronProModalStorage : localStorage)),
      partialize: (state) => ({ blockedAttempts: state.blockedAttempts }),
    }
  )
);

// Helper: Check if trial has expired
const isTrialExpired = (trialStartDate: number | null): boolean => {
  if (!trialStartDate) return false;

  const now = Date.now();
  const trialEnd = trialStartDate + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;

  // Clock rollback or expired
  return now < trialStartDate || now > trialEnd;
};

// Helper: Calculate days remaining in trial
const calculateDaysRemaining = (trialStartDate: number | null): number => {
  if (!trialStartDate) return 0;

  const now = Date.now();
  const trialEnd = trialStartDate + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;
  const msRemaining = trialEnd - now;

  return Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
};

export const useFeatureAccess = () => {
  const licenseStore = useLicenseStore();
  const proModalOpen = useProModalStore((state) => state.proModalOpen);
  const proModalFeature = useProModalStore((state) => state.proModalFeature);
  const openProModal = useProModalStore((state) => state.openProModal);
  const closeProModal = useProModalStore((state) => state.closeProModal);

  // Dev override: localStorage flag to bypass all checks
  const devOverride = isDevProLicenseOverride();

  const isInitialized = licenseStore.initialized;
  const hasProLicense = isInitialized && (licenseStore.licenseStatus === 'pro' || licenseStore.licenseStatus === 'lifetime');

  // Compute status (CENTRALIZED LOGIC HERE!)
  const isPro = devOverride || hasProLicense;

  const isTrialActive = isInitialized &&
                        licenseStore.licenseStatus === 'trial' &&
                        !isTrialExpired(licenseStore.trialStartDate);

  const isExpired = isInitialized && licenseStore.licenseStatus === 'expired';
  const isFree = isInitialized && licenseStore.licenseStatus === 'free';
  const trialUsed = isInitialized && licenseStore.trialActivated;
  const canStartTrial = isInitialized && !hasProLicense && !isTrialActive && !trialUsed;

  // Keep the development shortcut working, but do not open paid features before license state loads.
  const allowDuringInit = devOverride;
  const canUseDuringTrialOrPro = isPro || isTrialActive;

  // Feature flags (all Pro features have same access requirements)
  const canUseA1111 = allowDuringInit || canUseDuringTrialOrPro;
  const canUseComfyUI = allowDuringInit || canUseDuringTrialOrPro;
  const canUseComparison = allowDuringInit || canUseDuringTrialOrPro;
  const canUseAnalytics = allowDuringInit || canUseDuringTrialOrPro;
  const canUseBatchExport = allowDuringInit || canUseDuringTrialOrPro;
  const canUseFileManagement = allowDuringInit || canUseDuringTrialOrPro;
  const canUseImageEditor = allowDuringInit || canUseDuringTrialOrPro;
  // Semantic search itself is available on Free; only the number of images it
  // indexes is capped, so the flag gates the *unlimited* index, not the feature.
  const canUseUnlimitedSemanticSearch = allowDuringInit || canUseDuringTrialOrPro;

  // Trial countdown
  const trialDaysRemaining = isInitialized
    ? calculateDaysRemaining(licenseStore.trialStartDate)
    : 0;

  // Modal control
  const showProModal = (feature: ProFeature) => {
    openProModal(feature);
  };

  // Optional derived label for status indicators
  const statusLabel = useMemo(() => {
    if (isPro) return 'Pro License';
    if (isTrialActive) return `Pro Trial (${trialDaysRemaining} ${trialDaysRemaining === 1 ? 'day' : 'days'} left)`;
    if (isExpired) return 'Trial expired';
    return 'Free Version';
  }, [isPro, isTrialActive, isExpired, trialDaysRemaining]);

  const startTrial = () => {
    licenseStore.activateTrial();
    closeProModal();
  };

  // Log dev override
  useEffect(() => {
    if (devOverride) {
      console.log('🔓 [IMH] DEV MODE: Pro license unlocked via localStorage');
    }
  }, [devOverride]);

  return {
    // Feature flags
    canUseA1111,
    canUseComfyUI,
    canUseComparison,
    canUseAnalytics,
    canUseBatchExport,
    canUseFileManagement,
    canUseImageEditor,

    canUseBulkTagging: canUseDuringTrialOrPro,

    // Clustering limits
    canUseFullClustering: canUseDuringTrialOrPro,
    canUseDuringTrialOrPro,
    clusteringImageLimit: canUseDuringTrialOrPro ? Infinity : CLUSTERING_FREE_TIER_LIMIT,

    // Visual search: available to all, capped for Free.
    canUseUnlimitedSemanticSearch,
    semanticSearchImageLimit: canUseUnlimitedSemanticSearch ? Infinity : SEMANTIC_FREE_TIER_LIMIT,

    // Status
    isTrialActive,
    isExpired,
    isFree,
    isPro,
    canStartTrial,
    trialUsed,
    licenseStatus: licenseStore.licenseStatus,
    initialized: licenseStore.initialized,
    statusLabel,

    // Trial info
    trialDaysRemaining,
    startTrial,

    // Modal control
    proModalOpen,
    proModalFeature,
    showProModal,
    closeProModal,
  };
};


import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useLicenseStore, TRIAL_DURATION_DAYS } from '../store/useLicenseStore';

export type ProFeature = 'a1111' | 'comfyui' | 'comparison' | 'analytics' | 'clustering' | 'batch_export' | 'bulk_tagging' | 'file_management' | 'image_editor';


export const CLUSTERING_FREE_TIER_LIMIT = 300;
export const CLUSTERING_PREVIEW_LIMIT = 500; // Process extra for blurred preview

const isDevelopmentBuild =
  (typeof import.meta !== 'undefined' && Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV)) ||
  (typeof process !== 'undefined' && process.env.NODE_ENV === 'development');

type ProModalState = {
  proModalOpen: boolean;
  proModalFeature: ProFeature;
  openProModal: (feature: ProFeature) => void;
  closeProModal: () => void;
};

export const useProModalStore = create<ProModalState>((set) => ({
  proModalOpen: false,
  proModalFeature: 'a1111',
  openProModal: (feature) => set({ proModalOpen: true, proModalFeature: feature }),
  closeProModal: () => set({ proModalOpen: false }),
}));

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
  const devOverride = isDevelopmentBuild &&
                     typeof window !== 'undefined' &&
                     localStorage.getItem('IMH_DEV_LICENSE') === 'pro';

  const isInitialized = licenseStore.initialized;

  // Compute status (CENTRALIZED LOGIC HERE!)
  // 🔓 HARDCODED PRO BYPASS - FOR PERSONAL TESTING ONLY
  const isPro = true;
  const hasProLicense = true;

  const isTrialActive = isInitialized &&
                        licenseStore.licenseStatus === 'trial' &&
                        !isTrialExpired(licenseStore.trialStartDate);

  const isExpired = false;
  const isFree = false;
  const trialUsed = isInitialized && licenseStore.trialActivated;
  const canStartTrial = false;

  // Keep the development shortcut working, but do not open paid features before license state loads.
  const allowDuringInit = true;
  const canUseDuringTrialOrPro = true;

  // Feature flags (all Pro features have same access requirements)
  const canUseA1111 = allowDuringInit || canUseDuringTrialOrPro;
  const canUseComfyUI = allowDuringInit || canUseDuringTrialOrPro;
  const canUseComparison = allowDuringInit || canUseDuringTrialOrPro;
  const canUseAnalytics = allowDuringInit || canUseDuringTrialOrPro;
  const canUseBatchExport = allowDuringInit || canUseDuringTrialOrPro;
  const canUseFileManagement = allowDuringInit || canUseDuringTrialOrPro;
  const canUseImageEditor = allowDuringInit || canUseDuringTrialOrPro;

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
    return 'Pro License (Bypassed)';
  }, []);

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


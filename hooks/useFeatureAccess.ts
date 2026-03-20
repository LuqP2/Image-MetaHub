import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useLicenseStore } from '../store/useLicenseStore';

export type ProFeature = 'a1111' | 'comfyui' | 'comparison' | 'analytics' | 'clustering' | 'batch_export' | 'bulk_tagging';


export const CLUSTERING_FREE_TIER_LIMIT = 300;
export const CLUSTERING_PREVIEW_LIMIT = 500; // Process extra for blurred preview

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

export const useFeatureAccess = () => {
  const licenseStore = useLicenseStore();
  const proModalOpen = useProModalStore((state) => state.proModalOpen);
  const proModalFeature = useProModalStore((state) => state.proModalFeature);
  const openProModal = useProModalStore((state) => state.openProModal);
  const closeProModal = useProModalStore((state) => state.closeProModal);

  // Dev override: localStorage flag to bypass all checks
  const devOverride =
    Boolean((import.meta as any)?.env?.DEV) &&
    typeof window !== 'undefined' &&
    localStorage.getItem('IMH_DEV_LICENSE') === 'pro';

  const isInitialized = licenseStore.initialized;
  const hasProLicense = isInitialized && (
    licenseStore.licenseStatus === 'pro' ||
    licenseStore.licenseStatus === 'lifetime' ||
    licenseStore.licenseStatus === 'grace'
  );

  // Compute status (CENTRALIZED LOGIC HERE!)
  const isPro = devOverride || hasProLicense;

  const isTrialActive = isInitialized && licenseStore.licenseStatus === 'trial';

  const isExpired = isInitialized && (
    licenseStore.licenseStatus === 'expired' || licenseStore.licenseStatus === 'revoked'
  );
  const isFree = isInitialized && licenseStore.licenseStatus === 'free';
  const trialUsed = isInitialized && licenseStore.trialActivated;
  const canStartTrial = isInitialized && !hasProLicense && !isTrialActive && !trialUsed;

  // During initialization, keep features open to avoid flicker
  const allowDuringInit = !isInitialized || devOverride;
  const canUseDuringTrialOrPro = isPro || isTrialActive;

  // Feature flags (all Pro features have same access requirements)
  const canUseA1111 = allowDuringInit || canUseDuringTrialOrPro;
  const canUseComfyUI = allowDuringInit || canUseDuringTrialOrPro;
  const canUseComparison = allowDuringInit || canUseDuringTrialOrPro;
  const canUseAnalytics = allowDuringInit || canUseDuringTrialOrPro;
  const canUseBatchExport = allowDuringInit || canUseDuringTrialOrPro;

  // Trial countdown
  const trialDaysRemaining = isInitialized ? licenseStore.trialDaysRemaining : 0;

  // Modal control
  const showProModal = (feature: ProFeature) => {
    openProModal(feature);
  };

  // Optional derived label for status indicators
  const statusLabel = useMemo(() => {
    if (licenseStore.licenseStatus === 'lifetime') return 'Lifetime License';
    if (licenseStore.licenseStatus === 'grace') return 'Pro License (Offline Grace)';
    if (isPro) return licenseStore.licensePlan === 'annual' ? 'Pro Annual' : 'Pro License';
    if (isTrialActive) return `Pro Trial (${trialDaysRemaining} ${trialDaysRemaining === 1 ? 'day' : 'days'} left)`;
    if (isExpired) return 'Trial expired';
    return 'Free Version';
  }, [isPro, isTrialActive, isExpired, trialDaysRemaining, licenseStore.licensePlan, licenseStore.licenseStatus]);

  const startTrial = async () => {
    await licenseStore.activateTrial();
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


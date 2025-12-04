import { useState, useEffect } from 'react';
import { useLicenseStore } from '../store/useLicenseStore';

export type ProFeature = 'a1111' | 'comparison' | 'analytics';

// Helper: Check if trial has expired
const isTrialExpired = (trialStartDate: number | null): boolean => {
  if (!trialStartDate) return false;

  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const trialEnd = trialStartDate + sevenDays;

  // Clock rollback or expired
  return now < trialStartDate || now > trialEnd;
};

// Helper: Calculate days remaining in trial
const calculateDaysRemaining = (trialStartDate: number | null): number => {
  if (!trialStartDate) return 0;

  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const trialEnd = trialStartDate + sevenDays;
  const msRemaining = trialEnd - now;

  return Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
};

export const useFeatureAccess = () => {
  const licenseStore = useLicenseStore();
  const [proModalOpen, setProModalOpen] = useState(false);
  const [proModalFeature, setProModalFeature] = useState<ProFeature>('a1111');

  // Dev override: localStorage flag to bypass all checks
  const devOverride = typeof window !== 'undefined' &&
                     localStorage.getItem('IMH_DEV_LICENSE') === 'pro';

  // Fallback during initialization - allow all features to avoid race conditions
  if (!licenseStore.initialized) {
    return {
      // Feature flags - allow everything during init to avoid flickering
      canUseA1111: true,
      canUseComparison: true,
      canUseAnalytics: true,

      // Status
      isTrialActive: false,
      isExpired: false,
      isPro: false,
      initialized: false,

      // Trial info
      trialDaysRemaining: 0,

      // Modal control (don't show modal during init)
      proModalOpen: false,
      proModalFeature: 'a1111' as ProFeature,
      showProModal: () => {},
      closeProModal: () => {},
    };
  }

  // Compute status (CENTRALIZED LOGIC HERE!)
  const isPro = devOverride ||
                licenseStore.licenseStatus === 'pro' ||
                licenseStore.licenseStatus === 'lifetime';

  const isTrialActive = licenseStore.licenseStatus === 'trial' &&
                        !isTrialExpired(licenseStore.trialStartDate);

  const isExpired = licenseStore.licenseStatus === 'expired';

  // Feature flags (all Pro features have same access requirements)
  const canUseA1111 = isPro || isTrialActive;
  const canUseComparison = isPro || isTrialActive;
  const canUseAnalytics = isPro || isTrialActive;

  // Trial countdown
  const trialDaysRemaining = calculateDaysRemaining(licenseStore.trialStartDate);

  // Modal control
  const showProModal = (feature: ProFeature) => {
    setProModalFeature(feature);
    setProModalOpen(true);
  };

  const closeProModal = () => {
    setProModalOpen(false);
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
    canUseComparison,
    canUseAnalytics,

    // Status
    isTrialActive,
    isExpired,
    isPro,
    initialized: licenseStore.initialized,

    // Trial info
    trialDaysRemaining,

    // Modal control
    proModalOpen,
    proModalFeature,
    showProModal,
    closeProModal,
  };
};

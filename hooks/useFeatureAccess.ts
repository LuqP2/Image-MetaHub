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

  const isInitialized = licenseStore.initialized;

  // Compute status (CENTRALIZED LOGIC HERE!)
  const isPro = devOverride ||
                (isInitialized && (licenseStore.licenseStatus === 'pro' || licenseStore.licenseStatus === 'lifetime'));

  const isTrialActive = isInitialized &&
                        licenseStore.licenseStatus === 'trial' &&
                        !isTrialExpired(licenseStore.trialStartDate);

  const isExpired = isInitialized && licenseStore.licenseStatus === 'expired';

  // During initialization, keep features open to avoid flicker
  const allowDuringInit = !isInitialized || devOverride;
  const canUseDuringTrialOrPro = isPro || isTrialActive;

  // Feature flags (all Pro features have same access requirements)
  const canUseA1111 = allowDuringInit || canUseDuringTrialOrPro;
  const canUseComparison = allowDuringInit || canUseDuringTrialOrPro;
  const canUseAnalytics = allowDuringInit || canUseDuringTrialOrPro;

  // Trial countdown
  const trialDaysRemaining = isInitialized
    ? calculateDaysRemaining(licenseStore.trialStartDate)
    : 0;

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

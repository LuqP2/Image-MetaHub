import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SEMANTIC_FREE_TIER_LIMIT,
  useFeatureAccess,
} from '../hooks/useFeatureAccess';
import { useLicenseStore } from '../store/useLicenseStore';

const setLicenseStatus = (licenseStatus: 'free' | 'pro') => {
  useLicenseStore.setState({
    initialized: true,
    licenseStatus,
    licensePlan: licenseStatus === 'pro' ? 'monthly' : null,
    trialAvailable: true,
    trialActivated: false,
    trialStartDate: null,
  });
};

describe('Local Visual Search feature access', () => {
  beforeEach(() => {
    localStorage.clear();
    setLicenseStatus('free');
  });

  it('keeps Find Similar available on Free with the documented index cap', () => {
    const { result } = renderHook(() => useFeatureAccess());

    expect(result.current.canUseUnlimitedSemanticSearch).toBe(false);
    expect(result.current.semanticSearchImageLimit).toBe(SEMANTIC_FREE_TIER_LIMIT);
  });

  it('removes the index cap for an initialized Pro entitlement', () => {
    const { result } = renderHook(() => useFeatureAccess());

    act(() => setLicenseStatus('pro'));

    expect(result.current.canUseUnlimitedSemanticSearch).toBe(true);
    expect(result.current.semanticSearchImageLimit).toBe(Infinity);
  });

  it('does not offer a trial when the runtime marks it unavailable', () => {
    useLicenseStore.setState({ trialAvailable: false });
    const { result } = renderHook(() => useFeatureAccess());

    expect(result.current.isFree).toBe(true);
    expect(result.current.canStartTrial).toBe(false);
  });
});

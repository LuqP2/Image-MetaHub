import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { useLicenseStore } from '../store/useLicenseStore';

describe('Model Manager entitlement', () => {
  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.setState({ initialized: true, licenseStatus: 'free', trialActivated: false, trialStartDate: null });
  });
  afterEach(cleanup);

  it.each(['free', 'expired'] as const)('blocks %s accounts', (licenseStatus) => {
    useLicenseStore.setState({ licenseStatus });
    expect(renderHook(() => useFeatureAccess()).result.current.canUseModelManager).toBe(false);
  });

  it('waits for license initialization before starting background work', () => {
    useLicenseStore.setState({ initialized: false, licenseStatus: 'pro' });
    expect(renderHook(() => useFeatureAccess()).result.current.canUseModelManager).toBe(false);
  });

  it.each(['pro', 'lifetime'] as const)('allows %s accounts', (licenseStatus) => {
    useLicenseStore.setState({ licenseStatus });
    expect(renderHook(() => useFeatureAccess()).result.current.canUseModelManager).toBe(true);
  });

  it('allows an active trial and blocks an expired trial', () => {
    useLicenseStore.setState({ licenseStatus: 'trial', trialStartDate: Date.now() });
    const { result } = renderHook(() => useFeatureAccess());
    expect(result.current.canUseModelManager).toBe(true);
    act(() => useLicenseStore.setState({ trialStartDate: Date.now() - 30 * 86400000 }));
    expect(result.current.canUseModelManager).toBe(false);
  });
});

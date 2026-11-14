import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { useLicenseStore } from '../store/useLicenseStore';
beforeEach(() => { localStorage.clear(); useLicenseStore.setState({ initialized: true, licenseStatus: 'free', trialStartDate: null, trialExtensionStartDate: null, trialRelease023: null, trialActivated: false }); });
afterEach(cleanup);
describe('Canvas entitlement', () => {
  it('unlocks Canvas for a release extension on an expired original trial', () => {
    useLicenseStore.setState({
      licenseStatus: 'trial',
      trialActivated: true,
      trialStartDate: Date.now() - 20 * 86400000,
      trialRelease023: { grantedAt: Date.now(), noticeDismissed: false },
    });
    const access = renderHook(() => useFeatureAccess()).result.current;
    expect(access.canUseCanvas).toBe(true);
    expect(access.canStartTrial).toBe(false);
    expect(access.canExtendTrial).toBe(false);
  });
  it.each(['free', 'expired'] as const)('keeps %s accounts read-only', licenseStatus => { useLicenseStore.setState({ licenseStatus }); expect(renderHook(() => useFeatureAccess()).result.current.canUseCanvas).toBe(false); });
  it.each(['pro', 'lifetime'] as const)('allows editing for %s', licenseStatus => { useLicenseStore.setState({ licenseStatus }); expect(renderHook(() => useFeatureAccess()).result.current.canUseCanvas).toBe(true); });
  it('waits for license initialization and ends editing when the trial expires', () => {
    useLicenseStore.setState({ initialized: false, licenseStatus: 'pro' });
    const hook = renderHook(() => useFeatureAccess()); expect(hook.result.current.canUseCanvas).toBe(false);
    act(() => useLicenseStore.setState({ initialized: true, licenseStatus: 'trial', trialStartDate: Date.now() })); expect(hook.result.current.canUseCanvas).toBe(true);
    act(() => useLicenseStore.setState({ trialStartDate: Date.now() - 30 * 86400000 })); expect(hook.result.current.canUseCanvas).toBe(false);
  });
});

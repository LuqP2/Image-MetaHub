import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { useLicenseStore } from '../store/useLicenseStore';
describe('advanced Prompt Library entitlement', () => {
  beforeEach(() => { localStorage.clear(); useLicenseStore.setState({ initialized: true, licenseStatus: 'free', trialStartDate: null, trialExtensionStartDate: null, trialActivated: false }); }); afterEach(cleanup);
  it.each(['free', 'expired'] as const)('gates %s accounts', (licenseStatus) => { useLicenseStore.setState({ licenseStatus }); expect(renderHook(() => useFeatureAccess()).result.current.canUseAdvancedPromptLibrary).toBe(false); });
  it.each(['pro', 'lifetime'] as const)('allows %s accounts', (licenseStatus) => { useLicenseStore.setState({ licenseStatus }); expect(renderHook(() => useFeatureAccess()).result.current.canUseAdvancedPromptLibrary).toBe(true); });
  it('waits for initialization and allows only an active trial', () => {
    useLicenseStore.setState({ initialized: false, licenseStatus: 'pro' }); expect(renderHook(() => useFeatureAccess()).result.current.canUseAdvancedPromptLibrary).toBe(false);
    act(() => useLicenseStore.setState({ initialized: true, licenseStatus: 'trial', trialStartDate: Date.now() })); expect(renderHook(() => useFeatureAccess()).result.current.canUseAdvancedPromptLibrary).toBe(true);
    act(() => useLicenseStore.setState({ trialStartDate: Date.now() - 30 * 86400000 })); expect(renderHook(() => useFeatureAccess()).result.current.canUseAdvancedPromptLibrary).toBe(false);
  });
});

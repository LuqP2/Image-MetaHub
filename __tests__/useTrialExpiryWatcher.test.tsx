import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { TRIAL_DURATION_DAYS, useLicenseStore } from '../store/useLicenseStore';
import { useTrialExpiryWatcher } from '../hooks/useTrialExpiryWatcher';

const TRIAL_DURATION_MS = TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;

const setLicense = (overrides: Partial<ReturnType<typeof useLicenseStore.getState>>) => {
  useLicenseStore.setState({
    initialized: true,
    migrationResetApplied: true,
    expiredTrialResetApplied: true,
    nextReleaseTrialResetApplied: true,
    trialDurationV2ResetApplied: true,
    trialStartDate: null,
    trialActivated: false,
    licenseStatus: 'free',
    licenseKey: null,
    licenseEmail: null,
    trialExpiredNoticeDismissed: false,
    ...overrides,
  });
};

describe('useTrialExpiryWatcher', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('flips an active trial to expired at the deadline while the app stays open', async () => {
    setLicense({
      licenseStatus: 'trial',
      trialActivated: true,
      trialStartDate: Date.now() - (TRIAL_DURATION_MS - 60_000),
    });

    renderHook(() => useTrialExpiryWatcher());
    expect(useLicenseStore.getState().licenseStatus).toBe('trial');

    // Past the deadline, plus the hook's cushion.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });

    const nextState = useLicenseStore.getState();
    expect(nextState.licenseStatus).toBe('expired');
    // The post-trial notice is armed, not auto-dismissed.
    expect(nextState.trialExpiredNoticeDismissed).toBe(false);
  });

  it('leaves the trial alone before the deadline', async () => {
    setLicense({
      licenseStatus: 'trial',
      trialActivated: true,
      trialStartDate: Date.now() - (TRIAL_DURATION_MS - 2 * 60 * 60 * 1000),
    });

    renderHook(() => useTrialExpiryWatcher());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });

    expect(useLicenseStore.getState().licenseStatus).toBe('trial');
  });

  it.each(['free', 'expired', 'pro', 'lifetime'] as const)(
    'never refreshes status for %s users',
    async (status) => {
      setLicense({ licenseStatus: status, trialStartDate: Date.now() - TRIAL_DURATION_MS });
      const refresh = vi.spyOn(useLicenseStore.getState(), 'checkLicenseStatus');

      renderHook(() => useTrialExpiryWatcher());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2 * TRIAL_DURATION_MS);
      });

      expect(refresh).not.toHaveBeenCalled();
      expect(useLicenseStore.getState().licenseStatus).toBe(status);
    },
  );

  it('cancels the pending refresh on unmount', async () => {
    setLicense({
      licenseStatus: 'trial',
      trialActivated: true,
      trialStartDate: Date.now(),
    });
    const refresh = vi.spyOn(useLicenseStore.getState(), 'checkLicenseStatus');

    const { unmount } = renderHook(() => useTrialExpiryWatcher());
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * TRIAL_DURATION_MS);
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(useLicenseStore.getState().licenseStatus).toBe('trial');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { TRIAL_DURATION_DAYS, useLicenseStore } from '../store/useLicenseStore';

const resetLicenseState = () => {
  localStorage.clear();
  useLicenseStore.setState({
    initialized: false,
    migrationResetApplied: true,
    expiredTrialResetApplied: true,
    trialStartDate: null,
    trialActivated: false,
    licenseStatus: 'free',
    licenseKey: null,
    licenseEmail: null,
  });
};

describe('useLicenseStore trial policy', () => {
  beforeEach(() => {
    resetLicenseState();
  });

  it('uses a 3-day trial duration', () => {
    expect(TRIAL_DURATION_DAYS).toBe(3);
  });

  it('resets previously expired trials so users can start a fresh trial', () => {
    useLicenseStore.setState({
      initialized: false,
      migrationResetApplied: true,
      expiredTrialResetApplied: false,
      trialStartDate: Date.now() - 10 * 24 * 60 * 60 * 1000,
      trialActivated: true,
      licenseStatus: 'expired',
    });

    useLicenseStore.getState().checkLicenseStatus();

    const nextState = useLicenseStore.getState();
    expect(nextState.licenseStatus).toBe('free');
    expect(nextState.trialActivated).toBe(false);
    expect(nextState.trialStartDate).toBeNull();
    expect(nextState.expiredTrialResetApplied).toBe(true);
  });

  it('does not reset an active trial during the duration migration', () => {
    useLicenseStore.setState({
      initialized: false,
      migrationResetApplied: true,
      expiredTrialResetApplied: false,
      trialStartDate: Date.now() - 1 * 24 * 60 * 60 * 1000,
      trialActivated: true,
      licenseStatus: 'trial',
    });

    useLicenseStore.getState().checkLicenseStatus();

    const nextState = useLicenseStore.getState();
    expect(nextState.licenseStatus).toBe('trial');
    expect(nextState.trialActivated).toBe(true);
    expect(nextState.expiredTrialResetApplied).toBe(true);
  });
});

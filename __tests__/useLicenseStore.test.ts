import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../utils/licenseKey', () => ({
  validateLicenseKey: vi.fn(),
}));

import { validateLicenseKey } from '../utils/licenseKey';
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
    vi.mocked(validateLicenseKey).mockReset();
  });

  it('uses a 3-day trial duration', () => {
    expect(TRIAL_DURATION_DAYS).toBe(3);
  });

  it('resets previously expired trials so users can start a fresh trial', async () => {
    useLicenseStore.setState({
      initialized: false,
      migrationResetApplied: true,
      expiredTrialResetApplied: false,
      trialStartDate: Date.now() - 10 * 24 * 60 * 60 * 1000,
      trialActivated: true,
      licenseStatus: 'expired',
    });

    await useLicenseStore.getState().checkLicenseStatus();

    const nextState = useLicenseStore.getState();
    expect(nextState.licenseStatus).toBe('free');
    expect(nextState.trialActivated).toBe(false);
    expect(nextState.trialStartDate).toBeNull();
    expect(nextState.expiredTrialResetApplied).toBe(true);
  });

  it('does not reset an active trial during the duration migration', async () => {
    useLicenseStore.setState({
      initialized: false,
      migrationResetApplied: true,
      expiredTrialResetApplied: false,
      trialStartDate: Date.now() - 1 * 24 * 60 * 60 * 1000,
      trialActivated: true,
      licenseStatus: 'trial',
    });

    await useLicenseStore.getState().checkLicenseStatus();

    const nextState = useLicenseStore.getState();
    expect(nextState.licenseStatus).toBe('trial');
    expect(nextState.trialActivated).toBe(true);
    expect(nextState.expiredTrialResetApplied).toBe(true);
  });

  it('downgrades a persisted pro status when the stored key is missing', async () => {
    useLicenseStore.setState({
      initialized: false,
      migrationResetApplied: false,
      expiredTrialResetApplied: false,
      licenseStatus: 'pro',
      licenseEmail: 'test@example.com',
      licenseKey: null,
    });

    await useLicenseStore.getState().checkLicenseStatus();

    const nextState = useLicenseStore.getState();
    expect(nextState.licenseStatus).toBe('free');
    expect(nextState.licenseEmail).toBeNull();
    expect(nextState.licenseKey).toBeNull();
  });

  it('keeps persisted pro status only when the stored key still validates', async () => {
    vi.mocked(validateLicenseKey).mockResolvedValue(true);
    useLicenseStore.setState({
      initialized: false,
      migrationResetApplied: false,
      expiredTrialResetApplied: false,
      licenseStatus: 'pro',
      licenseEmail: 'test@example.com',
      licenseKey: 'ABCD-EFGH-IJKL-MNOP',
    });

    await useLicenseStore.getState().checkLicenseStatus();

    const nextState = useLicenseStore.getState();
    expect(validateLicenseKey).toHaveBeenCalledWith('test@example.com', 'ABCD-EFGH-IJKL-MNOP');
    expect(nextState.licenseStatus).toBe('pro');
    expect(nextState.licenseEmail).toBe('test@example.com');
    expect(nextState.licenseKey).toBe('ABCD-EFGH-IJKL-MNOP');
  });
});

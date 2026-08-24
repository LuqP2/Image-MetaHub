import { beforeEach, describe, expect, it } from 'vitest';
import { applyLicenseAuthorityStatus, mergePersistedLicenseState, TRIAL_DURATION_DAYS, useLicenseStore } from '../store/useLicenseStore';
import { formatLicenseValidity, licensePlanLabel } from '../utils/licenseDisplay';

const resetLicenseState = () => {
  localStorage.clear();
  useLicenseStore.setState({
    initialized: false,
    migrationResetApplied: true,
    expiredTrialResetApplied: true,
    nextReleaseTrialResetApplied: true,
    trialDurationV2ResetApplied: true,
    trialAvailable: true,
    trialStartDate: null,
    trialActivated: false,
    licenseStatus: 'free',
    licenseKey: null,
    licenseEmail: null,
    licensePlan: null,
    licenseExpiresAt: null,
    licenseMessage: null,
    trialExpiredNoticeDismissed: false,
  });
};

describe('useLicenseStore trial policy', () => {
  beforeEach(() => {
    resetLicenseState();
  });

  it('uses a 7-day trial duration', () => {
    expect(TRIAL_DURATION_DAYS).toBe(7);
  });

  it('does not reset a newly activated trial as legacy state after restart', async () => {
    useLicenseStore.setState({
      initialized: true,
      migrationResetApplied: false,
      expiredTrialResetApplied: false,
      nextReleaseTrialResetApplied: false,
      trialDurationV2ResetApplied: false,
    });

    useLicenseStore.getState().activateTrial();
    const activated = useLicenseStore.getState();

    expect(activated).toMatchObject({
      licenseStatus: 'trial',
      trialActivated: true,
      migrationResetApplied: true,
      expiredTrialResetApplied: true,
      nextReleaseTrialResetApplied: true,
      trialDurationV2ResetApplied: true,
    });

    useLicenseStore.setState({ ...activated, initialized: false });
    await useLicenseStore.getState().checkLicenseStatus();

    expect(useLicenseStore.getState()).toMatchObject({
      licenseStatus: 'trial',
      trialActivated: true,
      trialStartDate: activated.trialStartDate,
    });
  });

  it('preserves an initialized authoritative status across arbitrary rehydration', () => {
    const current = useLicenseStore.getState();
    const merged = mergePersistedLicenseState({ licenseStatus: 'free', licensePlan: null }, {
      ...current,
      initialized: true,
      licenseStatus: 'pro',
      licenseEmail: 'buyer@example.com',
      licensePlan: 'monthly',
    });

    expect(merged).toMatchObject({
      initialized: true,
      licenseStatus: 'pro',
      licenseEmail: 'buyer@example.com',
      licensePlan: 'monthly',
    });
  });

  it.each(['trial', 'expired'] as const)('preserves persisted %s status for pending migrations', (licenseStatus) => {
    const merged = mergePersistedLicenseState({
      licenseStatus,
      trialActivated: true,
      trialStartDate: Date.now() - 24 * 60 * 60 * 1000,
      trialDurationV2ResetApplied: false,
    }, useLicenseStore.getState());

    expect(merged).toMatchObject({
      initialized: false,
      licenseStatus,
      trialActivated: true,
      trialDurationV2ResetApplied: false,
    });
  });

  it('does not trust a paid status from persisted renderer state', () => {
    const merged = mergePersistedLicenseState({
      licenseStatus: 'pro',
      licensePlan: 'monthly',
    }, useLicenseStore.getState());

    expect(merged).toMatchObject({
      initialized: false,
      licenseStatus: 'free',
      licensePlan: null,
    });
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

  it('resets an active trial when all prior migrations are complete (next release migration)', async () => {
    // This test ensures that after expiredTrialResetApplied has been marked,
    // the next release migration applies and resets active trials
    useLicenseStore.setState({
      initialized: false,
      migrationResetApplied: true,
      expiredTrialResetApplied: false,
      nextReleaseTrialResetApplied: false,
      trialStartDate: Date.now() - 1 * 24 * 60 * 60 * 1000,
      trialActivated: true,
      licenseStatus: 'trial',
    });

    await useLicenseStore.getState().checkLicenseStatus();

    const nextState = useLicenseStore.getState();
    // Active trial should be reset now that all prior migrations are complete
    expect(nextState.licenseStatus).toBe('free');
    expect(nextState.trialActivated).toBe(false);
    expect(nextState.trialStartDate).toBeNull();
    expect(nextState.expiredTrialResetApplied).toBe(true);
    expect(nextState.nextReleaseTrialResetApplied).toBe(true);
  });

  it('downgrades a persisted pro status when the stored key is missing', async () => {
    useLicenseStore.setState({
      initialized: false,
      migrationResetApplied: false,
      expiredTrialResetApplied: false,
      nextReleaseTrialResetApplied: false,
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

  it('does not trust a renderer-persisted pro status even when a key is present', async () => {
    useLicenseStore.setState({
      initialized: false,
      migrationResetApplied: false,
      expiredTrialResetApplied: false,
      nextReleaseTrialResetApplied: false,
      licenseStatus: 'pro',
      licenseEmail: 'test@example.com',
      licenseKey: 'ABCD-EFGH-IJKL-MNOP',
    });

    await useLicenseStore.getState().checkLicenseStatus();

    const nextState = useLicenseStore.getState();
    expect(nextState.licenseStatus).toBe('free');
    expect(nextState.licenseEmail).toBeNull();
    expect(nextState.licenseKey).toBeNull();
  });

  it('resets expired trials for next release (non-Pro users)', async () => {
    useLicenseStore.setState({
      initialized: false,
      migrationResetApplied: true,
      expiredTrialResetApplied: true,
      nextReleaseTrialResetApplied: false,
      trialStartDate: Date.now() - 10 * 24 * 60 * 60 * 1000,
      trialActivated: true,
      licenseStatus: 'expired',
    });

    await useLicenseStore.getState().checkLicenseStatus();

    const nextState = useLicenseStore.getState();
    expect(nextState.licenseStatus).toBe('free');
    expect(nextState.trialActivated).toBe(false);
    expect(nextState.trialStartDate).toBeNull();
    expect(nextState.nextReleaseTrialResetApplied).toBe(true);
  });

  it('resets active trials for next release (non-Pro users)', async () => {
    useLicenseStore.setState({
      initialized: false,
      migrationResetApplied: true,
      expiredTrialResetApplied: true,
      nextReleaseTrialResetApplied: false,
      trialStartDate: Date.now() - 1 * 24 * 60 * 60 * 1000,
      trialActivated: true,
      licenseStatus: 'trial',
    });

    await useLicenseStore.getState().checkLicenseStatus();

    const nextState = useLicenseStore.getState();
    expect(nextState.licenseStatus).toBe('free');
    expect(nextState.trialActivated).toBe(false);
    expect(nextState.trialStartDate).toBeNull();
    expect(nextState.nextReleaseTrialResetApplied).toBe(true);
  });

  it('resets expired trials so users can start a fresh 7-day trial (trial duration v2 migration)', async () => {
    useLicenseStore.setState({
      initialized: false,
      migrationResetApplied: true,
      expiredTrialResetApplied: true,
      nextReleaseTrialResetApplied: true,
      trialDurationV2ResetApplied: false,
      trialStartDate: Date.now() - 10 * 24 * 60 * 60 * 1000,
      trialActivated: true,
      licenseStatus: 'expired',
    });

    await useLicenseStore.getState().checkLicenseStatus();

    const nextState = useLicenseStore.getState();
    expect(nextState.licenseStatus).toBe('free');
    expect(nextState.trialActivated).toBe(false);
    expect(nextState.trialStartDate).toBeNull();
    expect(nextState.trialDurationV2ResetApplied).toBe(true);
  });

});

describe('license billing display', () => {
  it('shows the three paid plans and their validity', () => {
    expect(licensePlanLabel('monthly')).toBe('Monthly');
    expect(licensePlanLabel('annual')).toBe('Annual');
    expect(licensePlanLabel('lifetime')).toBe('Lifetime');
    expect(formatLicenseValidity('monthly', '2026-09-23T00:00:00.000Z', 'en-US')).toMatch(/^Valid through /);
    expect(formatLicenseValidity('annual', '2027-08-23T00:00:00.000Z', 'en-US')).toMatch(/^Valid through /);
    expect(formatLicenseValidity('lifetime', null, 'en-US')).toBe('No expiration');
  });
});

describe('post-trial notice dismissal', () => {
  beforeEach(() => {
    resetLicenseState();
  });

  it('applies an authoritative runtime expiry update from Electron main', () => {
    useLicenseStore.setState({
      initialized: true,
      licenseStatus: 'pro',
      licensePlan: 'monthly',
      licenseExpiresAt: '2026-09-23T00:00:00.000Z',
    });
    applyLicenseAuthorityStatus({
      authorized: false,
      licenseStatus: 'free',
      plan: null,
      licenseEmail: 'buyer@example.com',
      expiresAt: null,
      refreshAfter: null,
      migrationRequired: false,
      message: 'License has expired.',
    });
    expect(useLicenseStore.getState()).toMatchObject({
      initialized: true,
      licenseStatus: 'free',
      licensePlan: null,
      licenseExpiresAt: null,
      licenseMessage: 'License has expired.',
    });
  });

  it('propagates the paid period from Electron authority into renderer state', () => {
    applyLicenseAuthorityStatus({
      authorized: true,
      licenseStatus: 'pro',
      plan: 'annual',
      licenseEmail: 'buyer@example.com',
      expiresAt: '2027-08-23T00:00:00.000Z',
      refreshAfter: '2026-08-24T00:00:00.000Z',
      migrationRequired: false,
      message: null,
    });
    expect(useLicenseStore.getState()).toMatchObject({
      licenseStatus: 'pro',
      licensePlan: 'annual',
      licenseExpiresAt: '2027-08-23T00:00:00.000Z',
    });
  });

  it('does not erase an active local trial when a paid activation attempt fails', () => {
    useLicenseStore.setState({ initialized: true, licenseStatus: 'trial', trialActivated: true, trialStartDate: Date.now() });
    applyLicenseAuthorityStatus({
      authorized: false,
      licenseStatus: 'free',
      plan: null,
      licenseEmail: null,
      expiresAt: null,
      refreshAfter: null,
      migrationRequired: false,
      message: 'Invalid license for this email.',
    });
    expect(useLicenseStore.getState()).toMatchObject({
      licenseStatus: 'trial',
      trialActivated: true,
      licenseMessage: 'Invalid license for this email.',
    });
  });

  it('records the dismissal without touching the license status', () => {
    useLicenseStore.setState({ initialized: true, licenseStatus: 'expired', trialActivated: true });

    useLicenseStore.getState().dismissTrialExpiredNotice();

    const nextState = useLicenseStore.getState();
    expect(nextState.trialExpiredNoticeDismissed).toBe(true);
    expect(nextState.licenseStatus).toBe('expired');
    expect(nextState.trialActivated).toBe(true);
  });

  it('re-arms the notice when a fresh trial is activated', () => {
    useLicenseStore.setState({ trialExpiredNoticeDismissed: true });

    useLicenseStore.getState().activateTrial();

    const nextState = useLicenseStore.getState();
    expect(nextState.licenseStatus).toBe('trial');
    expect(nextState.trialExpiredNoticeDismissed).toBe(false);
  });

  it('leaves the dismissal untouched when browser activation is unavailable', async () => {
    useLicenseStore.setState({ licenseStatus: 'expired', trialExpiredNoticeDismissed: true });

    const activated = await useLicenseStore.getState().activateLicense('ABCD-EFGH-IJKL-MNOP', 'test@example.com');

    const nextState = useLicenseStore.getState();
    expect(activated).toBe(false);
    expect(nextState.licenseStatus).toBe('expired');
    expect(nextState.trialExpiredNoticeDismissed).toBe(true);
  });

  it('derives expired status without auto-dismissing the notice', async () => {
    useLicenseStore.setState({
      initialized: false,
      trialStartDate: Date.now() - (TRIAL_DURATION_DAYS + 1) * 24 * 60 * 60 * 1000,
      trialActivated: true,
      licenseStatus: 'trial',
    });

    await useLicenseStore.getState().checkLicenseStatus();

    const nextState = useLicenseStore.getState();
    expect(nextState.licenseStatus).toBe('expired');
    expect(nextState.trialExpiredNoticeDismissed).toBe(false);
  });
});

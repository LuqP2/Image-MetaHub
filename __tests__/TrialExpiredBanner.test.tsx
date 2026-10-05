import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TrialExpiredBanner from '../components/TrialExpiredBanner';
import { useLicenseStore } from '../store/useLicenseStore';
import { useSettingsStore } from '../store/useSettingsStore';

type LicenseStatus = ReturnType<typeof useLicenseStore.getState>['licenseStatus'];

const setLicense = (
  licenseStatus: LicenseStatus,
  overrides: Partial<ReturnType<typeof useLicenseStore.getState>> = {},
) => {
  useLicenseStore.setState({
    initialized: true,
    migrationResetApplied: true,
    expiredTrialResetApplied: true,
    nextReleaseTrialResetApplied: true,
    trialDurationV2ResetApplied: true,
    trialAvailable: true,
    trialStartDate: null,
    trialActivated: licenseStatus === 'expired' || licenseStatus === 'trial',
    licenseStatus,
    licenseKey: null,
    licenseEmail: null,
    trialExpiredNoticeDismissed: false,
    ...overrides,
  });
};

const bannerText = /your pro trial has ended/i;
const ctaName = /get the lifetime license/i;

describe('TrialExpiredBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().resetState();
    setLicense('free');
  });
  afterEach(() => cleanup());

  it('shows the post-trial notice for expired users', () => {
    setLicense('expired');
    render(<TrialExpiredBanner />);

    expect(screen.getByText(bannerText)).toBeTruthy();
    expect(screen.getByRole('link', { name: ctaName })).toBeTruthy();
  });

  it('sends the checkout link through the trial_expired attribution context', () => {
    setLicense('expired');
    render(<TrialExpiredBanner />);

    const cta = screen.getByRole('link', { name: ctaName }) as HTMLAnchorElement;
    const url = new URL(cta.href);

    expect(url.origin).toBe('https://buy.stripe.com');
    expect(url.pathname).toBe('/14AfZg9a48pQa5p8lH3Ru00');
    expect(url.searchParams.get('ctx')).toBe('trial_expired');
    expect(url.searchParams.get('src')).toBe('app');
    expect(url.searchParams.get('imh_ref')).toBeNull();
    expect(url.searchParams.get('utm_term')).toBe('lifetime');
  });

  it('keeps the creator attribution token on the checkout link', () => {
    setLicense('expired');
    useSettingsStore.setState({ creatorAttributionToken: 'imhcrt_test' });
    render(<TrialExpiredBanner />);

    const cta = screen.getByRole('link', { name: ctaName }) as HTMLAnchorElement;
    const url = new URL(cta.href);

    expect(url.searchParams.get('ctx')).toBe('trial_expired');
    expect(url.searchParams.get('imh_ref')).toBe('imhcrt_test');
  });

  it('keeps annual and monthly direct checkout options available', () => {
    setLicense('expired');
    render(<TrialExpiredBanner />);

    const annual = screen.getByRole('link', { name: /annual.*19\.99\/year/i }) as HTMLAnchorElement;
    const monthly = screen.getByRole('link', { name: /monthly.*4\.99\/month/i }) as HTMLAnchorElement;

    expect(new URL(annual.href).searchParams.get('utm_term')).toBe('annual');
    expect(new URL(monthly.href).searchParams.get('utm_term')).toBe('monthly');
  });

  it('is dismissed in a single click and stays dismissed', () => {
    setLicense('expired');
    const view = render(<TrialExpiredBanner />);

    fireEvent.click(screen.getByRole('button', { name: /dismiss trial ended notice/i }));

    expect(screen.queryByText(bannerText)).toBeNull();
    expect(useLicenseStore.getState().trialExpiredNoticeDismissed).toBe(true);

    // Still gone after a remount (the flag is persisted license state).
    view.unmount();
    render(<TrialExpiredBanner />);
    expect(screen.queryByText(bannerText)).toBeNull();
  });

  it.each(['free', 'trial', 'pro', 'lifetime'] as const)(
    'does not show for %s users',
    (status) => {
      setLicense(status);
      render(<TrialExpiredBanner />);
      expect(screen.queryByText(bannerText)).toBeNull();
    },
  );

  it('stays hidden until the license store is initialized', () => {
    setLicense('expired', { initialized: false });
    render(<TrialExpiredBanner />);
    expect(screen.queryByText(bannerText)).toBeNull();
  });

  it('re-arms the notice when a new trial is activated', () => {
    setLicense('expired', { trialExpiredNoticeDismissed: true, trialActivated: false });

    useLicenseStore.getState().activateTrial();
    expect(useLicenseStore.getState().trialExpiredNoticeDismissed).toBe(false);
  });
});

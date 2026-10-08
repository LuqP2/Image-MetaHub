import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TrialExtensionModal from '../components/TrialExtensionModal';
import { useLicenseStore } from '../store/useLicenseStore';

describe('extra trial offer', () => {
  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.setState({ initialized: true, trialAvailable: true, licenseStatus: 'expired', trialActivated: true, trialStartDate: Date.now() - 20 * 86400000, trialExtensionStartDate: null });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('keeps the trial expired until the user explicitly activates the offer', async () => {
    render(<TrialExtensionModal isOpen onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(useLicenseStore.getState().licenseStatus).toBe('expired');
    fireEvent.click(screen.getByRole('button', { name: 'Activate 3 extra trial days' }));
    await waitFor(() => expect(useLicenseStore.getState().licenseStatus).toBe('trial'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closing the offer does not consume the extension', () => {
    render(<TrialExtensionModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
    expect(useLicenseStore.getState().trialExtensionStartDate).toBeNull();
    expect(useLicenseStore.getState().licenseStatus).toBe('expired');
  });

  it('does not show an already-used extension', () => {
    useLicenseStore.setState({ trialExtensionStartDate: Date.now() - 10 * 86400000 });
    render(<TrialExtensionModal isOpen onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps an activation failure visible after the button becomes available again', async () => {
    vi.spyOn(useLicenseStore.getState(), 'activateTrialExtension').mockResolvedValue(false);
    useLicenseStore.setState({ licenseMessage: 'Could not save the trial.' });
    render(<TrialExtensionModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Activate 3 extra trial days' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not save the trial.'));
    expect((screen.getByRole('button', { name: 'Activate 3 extra trial days' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

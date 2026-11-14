import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('0.23.0 changelog and trial notice', () => {
  it('renders 0.23.0 without a developer message and preserves it for 0.22', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => '## [0.23.0]\n\n- Canvas is here\n\n## [0.22.0]\n\n- New branding',
    })));
    const { default: ChangelogModal } = await import('../components/ChangelogModal');
    const onClose = vi.fn();
    const first = render(<ChangelogModal isOpen onClose={onClose} currentVersion="0.23.0" />);
    await screen.findByText('Canvas is here');
    expect(screen.queryByText('Message from the Dev')).toBeNull();
    first.unmount();
    render(<ChangelogModal isOpen onClose={onClose} currentVersion="0.22.0" />);
    await screen.findByText('Message from the Dev');
  });

  it('waits for the changelog to close, survives quitting early, and stays dismissed after relaunch', async () => {
    const extension = { grantedAt: Date.now(), noticeDismissed: false };
    vi.stubGlobal('electronAPI', {
      getSettings: async () => ({ license: { trialRelease023: { ...extension } } }),
      dismissReleaseTrialExtensionNotice: async () => {
        extension.noticeDismissed = true;
        return { success: true };
      },
    });
    const { default: Notice } = await import('../components/ReleaseTrialExtensionNotice');
    const { useLicenseStore } = await import('../store/useLicenseStore');
    await useLicenseStore.persist.rehydrate();

    const first = render(<Notice changelogOpen changelogReady />);
    expect(screen.queryByRole('status')).toBeNull();
    first.unmount();
    expect(extension.noticeDismissed).toBe(false);

    await useLicenseStore.persist.rehydrate();
    const second = render(<Notice changelogOpen={false} changelogReady={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    second.rerender(<Notice changelogOpen changelogReady />);
    expect(screen.queryByRole('status')).toBeNull();
    second.rerender(<Notice changelogOpen={false} changelogReady />);
    expect(screen.getByRole('heading', { name: 'Your Pro trial has been extended' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    second.unmount();

    vi.resetModules();
    const { default: RelaunchedNotice } = await import('../components/ReleaseTrialExtensionNotice');
    const { useLicenseStore: relaunchedStore } = await import('../store/useLicenseStore');
    await relaunchedStore.persist.rehydrate();
    render(<RelaunchedNotice changelogOpen={false} changelogReady />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows no notice after changelog close when no extension was granted', async () => {
    vi.stubGlobal('electronAPI', {
      getSettings: async () => ({ license: { trialRelease023: { grantedAt: null, noticeDismissed: false } } }),
    });
    const { default: Notice } = await import('../components/ReleaseTrialExtensionNotice');
    const { useLicenseStore } = await import('../store/useLicenseStore');
    await useLicenseStore.persist.rehydrate();
    render(<Notice changelogOpen={false} changelogReady />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

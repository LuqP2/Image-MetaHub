import { afterEach, describe, expect, it, vi } from 'vitest';

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

afterEach(() => {
  delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
  vi.resetModules();
});

describe('Electron trial activation', () => {
  it('does not unlock Pro until the main process commits the trial state', async () => {
    const activation = createDeferred<{
      success: boolean;
      activated: boolean;
      trialStartDate: number;
    }>();
    const saveSettings = vi.fn(async () => ({ success: true }));
    (window as typeof window & { electronAPI: Record<string, unknown> }).electronAPI = {
      activateTrial: vi.fn(() => activation.promise),
      getSettings: vi.fn(async () => ({})),
      saveSettings,
    };

    const { useLicenseStore } = await import('../store/useLicenseStore');
    useLicenseStore.setState({
      initialized: true,
      licenseStatus: 'free',
      trialActivated: false,
      trialStartDate: null,
    });

    const pendingActivation = useLicenseStore.getState().activateTrial();
    expect(useLicenseStore.getState()).toMatchObject({
      licenseStatus: 'free',
      trialActivated: false,
    });

    activation.resolve({
      success: true,
      activated: true,
      trialStartDate: Date.now(),
    });

    await expect(pendingActivation).resolves.toBe(true);
    expect(useLicenseStore.getState()).toMatchObject({
      licenseStatus: 'trial',
      trialActivated: true,
      migrationResetApplied: true,
      expiredTrialResetApplied: true,
      nextReleaseTrialResetApplied: true,
      trialDurationV2ResetApplied: true,
    });
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalled());
  });

  it('stays Free when the main process cannot commit the trial state', async () => {
    (window as typeof window & { electronAPI: Record<string, unknown> }).electronAPI = {
      activateTrial: vi.fn(async () => ({
        success: false,
        activated: false,
        trialStartDate: null,
        error: 'The local trial state could not be saved.',
      })),
      getSettings: vi.fn(async () => ({})),
      saveSettings: vi.fn(async () => ({ success: true })),
    };

    const { useLicenseStore } = await import('../store/useLicenseStore');
    useLicenseStore.setState({
      initialized: true,
      licenseStatus: 'free',
      trialActivated: false,
      trialStartDate: null,
    });

    await expect(useLicenseStore.getState().activateTrial()).resolves.toBe(false);
    expect(useLicenseStore.getState()).toMatchObject({
      licenseStatus: 'free',
      trialActivated: false,
      licenseMessage: 'The local trial state could not be saved.',
    });
  });

  it('ignores a persisted trial and never calls trial activation in Portable', async () => {
    const activateTrial = vi.fn();
    (window as typeof window & { electronAPI: Record<string, unknown> }).electronAPI = {
      activateTrial,
      getRuntimeInfo: vi.fn(async () => ({
        isPortable: true,
        userDataPath: 'D:\\Portable\\ImageMetaHubData',
        autoUpdateSupported: false,
      })),
      getLicenseStatus: vi.fn(async () => ({
        authorized: false,
        licenseStatus: 'free',
        plan: null,
        licenseEmail: null,
        expiresAt: null,
        refreshAfter: null,
        migrationRequired: false,
        message: null,
      })),
      getSettings: vi.fn(async () => ({})),
      saveSettings: vi.fn(async () => ({ success: true })),
    };

    const { useLicenseStore } = await import('../store/useLicenseStore');
    useLicenseStore.setState({
      initialized: false,
      trialAvailable: true,
      licenseStatus: 'trial',
      trialActivated: true,
      trialStartDate: Date.now(),
    });

    await useLicenseStore.getState().checkLicenseStatus();

    expect(useLicenseStore.getState()).toMatchObject({
      initialized: true,
      trialAvailable: false,
      licenseStatus: 'free',
      trialActivated: false,
      trialStartDate: null,
    });
    await expect(useLicenseStore.getState().activateTrial()).resolves.toBe(false);
    expect(activateTrial).not.toHaveBeenCalled();
  });
});

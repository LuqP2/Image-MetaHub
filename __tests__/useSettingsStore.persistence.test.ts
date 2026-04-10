import { describe, expect, it } from 'vitest';
import { mergeSettingsWithExisting, stripLicenseFromSettings } from '../store/useSettingsStore';

describe('useSettingsStore persistence helpers', () => {
  it('strips license data before hydrating the settings store', () => {
    const next = stripLicenseFromSettings({
      theme: 'dark',
      autoUpdate: true,
      license: {
        licenseStatus: 'pro',
        licenseEmail: 'pro@example.com',
      },
    });

    expect(next).toEqual({
      theme: 'dark',
      autoUpdate: true,
    });
  });

  it('preserves existing license data when saving general settings', () => {
    const next = mergeSettingsWithExisting(
      {
        theme: 'system',
        a1111LastConnectionStatus: 'unknown',
        license: {
          licenseStatus: 'pro',
          licenseEmail: 'pro@example.com',
          licenseKey: 'ABCD-EFGH-IJKL-MNOP',
        },
      },
      {
        theme: 'dark',
        a1111LastConnectionStatus: 'connected',
      },
    );

    expect(next).toEqual({
      theme: 'dark',
      a1111LastConnectionStatus: 'connected',
      license: {
        licenseStatus: 'pro',
        licenseEmail: 'pro@example.com',
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
      },
    });
  });
});

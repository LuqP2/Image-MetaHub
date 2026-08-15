import { describe, expect, it } from 'vitest';
import { resolveLicenseRuntimeConfig } from '../electron/licenseRuntimeConfig.mjs';

const bakedConfig = {
  serverUrl: 'https://licenses.production.example',
  publicKey: 'production-public-key',
};

describe('packaged licensing configuration', () => {
  it('ignores development environment overrides in a packaged app', () => {
    expect(resolveLicenseRuntimeConfig({
      isPackaged: true,
      env: {
        NODE_ENV: 'development',
        IMH_LICENSE_SERVER_URL: 'http://127.0.0.1:8787',
        IMH_LICENSE_PUBLIC_KEY: 'development-public-key',
      },
      bakedConfig,
    })).toEqual(bakedConfig);
  });

  it('allows explicit licensing overrides only when Electron is unpackaged', () => {
    expect(resolveLicenseRuntimeConfig({
      isPackaged: false,
      env: {
        NODE_ENV: 'production',
        IMH_LICENSE_SERVER_URL: 'http://127.0.0.1:8787',
        IMH_LICENSE_PUBLIC_KEY: 'development-public-key',
      },
      bakedConfig,
    })).toEqual({
      serverUrl: 'http://127.0.0.1:8787',
      publicKey: 'development-public-key',
    });
  });
});

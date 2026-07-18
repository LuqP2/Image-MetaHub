import { afterEach, describe, expect, it } from 'vitest';
import { isDevProLicenseOverride } from '../hooks/useFeatureAccess';

// vitest runs with import.meta.env.DEV === true, so the dev-build guard is satisfied here.
afterEach(() => {
  localStorage.removeItem('IMH_DEV_LICENSE');
});

describe('isDevProLicenseOverride', () => {
  it('is false without the localStorage flag', () => {
    expect(isDevProLicenseOverride()).toBe(false);
  });

  it('is true when IMH_DEV_LICENSE is set to pro (the console unlock)', () => {
    localStorage.setItem('IMH_DEV_LICENSE', 'pro');
    expect(isDevProLicenseOverride()).toBe(true);
  });

  it('is false for any other value', () => {
    localStorage.setItem('IMH_DEV_LICENSE', 'free');
    expect(isDevProLicenseOverride()).toBe(false);
  });
});

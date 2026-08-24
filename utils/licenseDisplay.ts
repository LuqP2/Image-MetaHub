import type { LicensePlan } from '../types';

export const licensePlanLabel = (plan: LicensePlan | null): string => {
  if (plan === 'monthly') return 'Monthly';
  if (plan === 'annual') return 'Annual';
  if (plan === 'lifetime') return 'Lifetime';
  return 'Pro';
};

export const formatLicenseValidity = (
  plan: LicensePlan | null,
  expiresAt: string | null,
  locale?: string,
): string | null => {
  if (plan === 'lifetime') return 'No expiration';
  if ((plan !== 'monthly' && plan !== 'annual') || !expiresAt) return null;
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) return null;
  return `Valid through ${new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(new Date(timestamp))}`;
};

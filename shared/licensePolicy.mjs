export const DEFAULT_LICENSE_POLICY = Object.freeze({
  trialDays: 7,
  defaultMaxDevices: 2,
  annual: Object.freeze({
    refreshDays: 7,
    graceDays: 14,
  }),
  lifetime: Object.freeze({
    refreshDays: 30,
    graceDays: 90,
  }),
});

export function daysToMs(days) {
  return days * 24 * 60 * 60 * 1000;
}

export function resolveLicensePolicy(overrides = {}) {
  return {
    trialDays: Number(overrides.trialDays ?? DEFAULT_LICENSE_POLICY.trialDays),
    defaultMaxDevices: Number(overrides.defaultMaxDevices ?? DEFAULT_LICENSE_POLICY.defaultMaxDevices),
    annualRefreshDays: Number(overrides.annualRefreshDays ?? DEFAULT_LICENSE_POLICY.annual.refreshDays),
    annualGraceDays: Number(overrides.annualGraceDays ?? DEFAULT_LICENSE_POLICY.annual.graceDays),
    lifetimeRefreshDays: Number(overrides.lifetimeRefreshDays ?? DEFAULT_LICENSE_POLICY.lifetime.refreshDays),
    lifetimeGraceDays: Number(overrides.lifetimeGraceDays ?? DEFAULT_LICENSE_POLICY.lifetime.graceDays),
  };
}

export const effectiveLicenseStatus = (row) => {
  if (row.admin_status !== 'active') return row.admin_status;
  if (row.source !== 'stripe') return row.admin_status;
  if (row.billing_state === 'active') return 'active';
  if (row.billing_state === 'cancelled') return 'cancelled';
  if (row.billing_state === 'refunded' && row.plan === 'lifetime') return 'revoked';
  return 'expired';
};

export const LEGACY_STATUS_PROJECTION_SQL = `
  CASE
    WHEN admin_status <> 'active' THEN admin_status
    WHEN source <> 'stripe' THEN admin_status
    WHEN COALESCE((
      SELECT e.billing_state FROM stripe_entitlements e
      WHERE e.license_id = licenses.id
    ), 'expired') = 'active' THEN 'active'
    WHEN (
      SELECT e.billing_state FROM stripe_entitlements e
      WHERE e.license_id = licenses.id
    ) = 'cancelled' THEN 'cancelled'
    WHEN (
      SELECT e.billing_state FROM stripe_entitlements e
      WHERE e.license_id = licenses.id
    ) = 'refunded' AND plan = 'lifetime' THEN 'revoked'
    ELSE 'expired'
  END
`;

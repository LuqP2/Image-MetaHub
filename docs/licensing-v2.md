# Licensing v2 architecture

Image MetaHub v0.19+ uses a Cloudflare Worker backed by D1 as the authority for paid entitlements. The desktop application no longer contains an HMAC or license-generation secret.

This repository pass prepares the code and automation only. It does not create or deploy Cloudflare resources, configure production secrets, change Stripe, or import real customers.

## Components and trust boundaries

- `packages/license-server/` contains the Worker, D1 repository, entitlement service, migration, and local tests.
- `electron/licenseManager.mjs` owns activation state in the desktop application. React receives only a summarized status through narrow preload APIs.
- `utils/licenseCertificate.mjs` defines the `IMHC1.<base64url-payload>.<base64url-signature>` Ed25519 certificate format. The exact base64url payload bytes are signed.
- `electron/licenseClientConfig.generated.mjs` contains public client configuration only. Release jobs replace its non-production defaults with the deployed Worker URL and raw Ed25519 public key.

The Worker holds the Ed25519 private key, email lookup pepper, and admin token. The app contains only the public verification key. License keys are random `IMH2-...` values with 160 bits of source entropy; D1 stores only their SHA-256 hashes. Normalized emails are represented by an HMAC lookup value and are not stored in plaintext.

## D1 schema

Migration `migrations/0001_initial.sql` creates:

- `licenses`: hashed key, peppered email lookup, `lifetime | monthly | annual` plan, entitlement status, source, expiry, activation limit, future Stripe identifiers, and a generic external reference.
- `activations`: one row per license and hashed random installation ID, with created/last-seen/deactivated timestamps and optional app version/platform.

`max_activations = NULL` means unlimited. Imported legacy licenses always use `plan = lifetime`, `source = legacy`, `status = active`, no expiry, and unlimited activations.

The activation-limit check and activation upsert are performed in one D1 statement, so retrying the same installation is idempotent without consuming another slot.

## Worker API

Public endpoints:

- `POST /v1/activate`: validates email/key, entitlement state and activation capacity, then issues a bound certificate.
- `POST /v1/refresh`: authenticates the signed certificate, checks current entitlement/activation state, updates `last_seen_at`, and issues a new certificate. It does not require the plaintext key.
- `POST /v1/deactivate`: authenticates the signed certificate and idempotently deactivates that installation.

Administrative endpoints require `Authorization: Bearer <LICENSE_SERVER_ADMIN_TOKEN>`:

- `POST /v1/admin/licenses`
- `POST /v1/admin/licenses/import-legacy`
- `POST /v1/admin/licenses/:id/revoke`
- `PATCH /v1/admin/licenses/:id`

The patch endpoint changes status (including revocation), plan, expiry, activation limit, future Stripe identifiers, or external reference. There is no admin UI.

Public activation failures deliberately avoid confirming whether an email or key exists. Raw emails and keys are not logged by the Worker or migration tooling.

## Desktop persistence and offline behavior

The Electron main process creates a stable random installation UUID in the application user-data directory. It does not inspect motherboard, CPU, network, or other hardware identifiers.

The signed certificate is stored with Electron `safeStorage` when OS encryption is available. If it is unavailable at activation time, the documented fallback stores only the signed certificate in a user-only file; no plaintext license key is retained. Signature and installation-binding validation are always performed before authorization.

- Lifetime certificates have no entitlement expiry. `refreshAfter` is advisory, and transient network/server failures never remove valid cached lifetime access.
- Monthly and annual certificates carry the entitlement expiry, which Electron enforces locally while offline.
- A conclusive online revoked/cancelled/expired response removes local authorization.
- A renderer-written `licenseStatus = pro` is not durable authority. On initialization, Zustand starts unauthorized and asks Electron main for the certificate-derived status.

On first startup with legacy `licenseEmail` and `licenseKey` settings but no valid certificate, Electron automatically calls `/v1/activate`. The raw key is cleared only after a signed activation is verified and stored. Offline or failed migration leaves the legacy values untouched and reports that one connection is required.

## Configuration and later deployment

The later infrastructure phase must perform these steps; none were performed by this repository-only pass:

1. Create a Cloudflare D1 database and replace `REPLACE_DURING_DEPLOYMENT` in `packages/license-server/wrangler.jsonc` with its database ID.
2. Generate an Ed25519 keypair. Encode the PKCS#8 private key and 32-byte raw public key as unpadded base64url.
3. Prepare these Worker production secret values; the protected deployment workflow will send them to Cloudflare:
   - `LICENSE_SIGNING_PRIVATE_KEY`
   - `LICENSE_SERVER_ADMIN_TOKEN`
   - `EMAIL_LOOKUP_PEPPER`
4. Set the public Worker variable `LICENSE_SIGNING_PUBLIC_KEY` to the raw public key.
5. Apply D1 migrations with `npm run d1:migrate:remote` from `packages/license-server/`.
6. Deploy the Worker and verify `/health` plus test-only create/activate/refresh/deactivate flows before customer migration.
7. Configure GitHub repository variables:
   - `LICENSE_SERVER_URL`
   - `LICENSE_SERVER_PUBLIC_KEY`
8. Configure the protected `license-server-production` GitHub environment and its deployment secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `LICENSE_SIGNING_PRIVATE_KEY`
   - `LICENSE_SERVER_ADMIN_TOKEN`
   - `EMAIL_LOOKUP_PEPPER`
9. Keep the existing `IMH_LICENSE_SECRET` GitHub secret only until the controlled historical migration is complete; it is used solely by `license-key-bulk.yml`.
10. Manually dispatch `license-server-deploy.yml`. It applies D1 migrations, deploys the Worker, and configures the three Worker secrets without logging their values.
11. Run a release build. Release workflows execute `scripts/configureLicenseClient.mjs`, which rejects missing, non-HTTPS, placeholder, or malformed public configuration before packaging.
12. After staging verification, manually run `license-key-bulk.yml` with the authoritative historical purchaser email list. Do not upload or commit that list.

For local Worker development, install the package dependencies, use explicit non-production values for all secrets, and run Wrangler/D1 in local mode. A development Electron process can read `IMH_LICENSE_SERVER_URL` and `IMH_LICENSE_PUBLIC_KEY` from its launch environment; packaged applications ignore those runtime overrides and use the configuration baked by the release workflow. Never place production secret values in `wrangler.jsonc`, source, committed `.env` files, or logs.

## License creation and legacy migration

`license-key.yml` preserves the manual owner workflow: enter purchaser email, select the plan (default lifetime), and provide an ISO expiry for monthly/annual. It calls the admin API and stores the plaintext key only in a one-day artifact; the key is not printed.

The existing `license-key-bulk.yml` and `scripts/generateLegacyLicenseMap.mjs` were adapted instead of replaced with a second migration path. The job reconstructs the historical HMAC key inside GitHub Actions, immediately posts each email/key pair to the authenticated legacy-import endpoint, emits only aggregate imported/already-existed/failed counts, and creates no CSV or customer artifact. Re-running it is safe. A mathematically valid historical HMAC key is rejected unless that exact issued license was imported into D1.

## Future Stripe integration

Stripe is not integrated in this pass. A future webhook adapter must call the existing `LicenseService` methods rather than writing independent entitlement logic or treating Stripe as a second authority:

- successful lifetime purchase: create a lifetime entitlement with `source = stripe`;
- new monthly/annual subscription: create a time-bounded entitlement;
- successful renewal: extend `expires_at`;
- cancellation: record that renewal will stop while leaving already-paid time active according to the future business rule;
- terminal payment/subscription state: update status or allow the entitlement to expire according to that explicit rule.

The nullable Stripe identifiers already exist in `licenses`, so adding the webhook adapter does not require a schema redesign.

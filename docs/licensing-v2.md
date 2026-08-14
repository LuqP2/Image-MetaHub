# Licensing v2 architecture

Image MetaHub v0.19+ uses a Cloudflare Worker backed by D1 as the authority for paid entitlements. The desktop application contains only public verification configuration and never contains the license-generation secret, Ed25519 private key, admin token, or email lookup pepper.

This repository prepares code and operator tooling only. It does not create or deploy Cloudflare resources, configure production values, change Stripe, or reissue real customer licenses.

## Components and trust boundaries

- `packages/license-server/` contains the Worker, D1 repository, entitlement service, schema, and tests.
- `electron/licenseManager.mjs` is the desktop authority. It verifies signed certificates, owns scheduling, and sends summarized status changes to renderers.
- `utils/licenseCertificate.mjs` defines signed `IMHC1` Ed25519 activation certificates.
- `electron/licenseClientConfig.generated.mjs` contains public client configuration only.

React state is not durable authorization. On startup and on main-process status notifications, the renderer derives paid access from Electron main. A locally patched open-source client is outside the official-license security boundary.

License keys are random `IMH2-...` values with 160 bits of source entropy. D1 stores their SHA-256 hashes. Normalized emails are stored only as peppered HMAC lookup values.

## Entitlement policy

### Lifetime

Current lifetime licenses have `max_activations = NULL`, no expiration, and unlimited installations. Lifetime certificates remain usable offline indefinitely after legitimate activation. Refresh is advisory and best-effort; transient network failure never converts a valid lifetime activation to Free.

Revocation and deactivation take effect on a client when it reconnects and refreshes. Restoring an older, still correctly signed lifetime certificate can therefore remain locally usable until a later refresh observes the server state. Deactivation is a convenience, not a hard anti-sharing boundary. The design intentionally does not use hardware fingerprinting, TPM binding, invasive identifiers, or commercial DRM.

The schema and repository retain generic activation-limit support for possible future time-bounded products, but the service forces current lifetime entitlements to unlimited.

### Monthly and annual

Monthly and annual certificates carry `expiresAt`. The Electron license manager schedules both refresh and expiration from one authoritative timer. When the timer fires after normal delay, sleep, or wake, it rechecks wall-clock time before deciding. Paid access is removed and propagated to renderer feature gates as soon as the entitlement is expired; leaving the application open cannot extend it.

A transient refresh failure preserves a temporal entitlement only until its signed `expiresAt`. It never makes monthly or annual access indefinite. A persisted `lastKnownGoodTime` provides simple rollback detection for casual clock changes. This is best-effort abuse resistance, not protection against a determined user patching the application.

## Persistence and cache reset

Electron creates a random installation UUID and stores the signed certificate with `safeStorage` when available. The fallback stores only the signed certificate in a user-only file. Plaintext IMH2 keys are not retained.

`preserveLicense = true` cache reset excludes both `license-installation-id` and `license-activation.dat` from deletion and restores the license settings summary. The activation envelope also contains the minimal scheduler metadata (`lastKnownGoodTime`). Restarted Electron can verify the same certificate and refresh it. A reset without preservation deletes both authority files.

## Worker API

Public endpoints:

- `POST /v1/activate`
- `POST /v1/refresh`
- `POST /v1/deactivate`

Only random IMH2 credentials can activate. There is no endpoint that accepts an HMAC-era credential as equivalent authority.

Administrative endpoints require `Authorization: Bearer <LICENSE_SERVER_ADMIN_TOKEN>`:

- `POST /v1/admin/licenses`
- `POST /v1/admin/licenses/reissue-historical`
- `POST /v1/admin/licenses/:id/revoke`
- `PATCH /v1/admin/licenses/:id`

## Current manual issuance

Plaintext customer credentials must not pass through public GitHub Actions logs or artifacts. The old issuance workflow was retired. Until Stripe provisioning exists, an operator runs the local CLI from a trusted workstation:

```bash
IMH_LICENSE_SERVER_URL="https://license-worker.example" \
LICENSE_SERVER_ADMIN_TOKEN="..." \
npm run license:create -- buyer@example.com lifetime
```

For monthly or annual, pass the ISO-8601 expiration as the next argument. The CLI calls the admin API and displays the new key only in the local terminal. It refuses to run in GitHub Actions and writes no credential file.

## Historical customer reissue

The historical HMAC secret appeared in distributed builds and is considered compromised. Possession of an old deterministic key plus purchaser email is not sufficient to obtain a v2 certificate. The desktop preserves detected HMAC-era settings until the customer enters a reissued IMH2 credential, but it never submits them automatically.

Before or around the v0.19 cutover, verified historical purchasers must receive fresh IMH2 lifetime credentials. Use the authoritative purchaser-list file locally:

```bash
IMH_LICENSE_SERVER_URL="https://license-worker.example" \
LICENSE_SERVER_ADMIN_TOKEN="..." \
npm run license:reissue-historical -- ./verified-purchasers.txt
```

The tool:

- generates one fresh random IMH2 key per normalized purchaser email;
- persists the pending mapping before the network request so retries reuse the same key;
- creates `source = legacy_reissue`, lifetime, unlimited, non-expiring entitlements;
- writes the purchaser-to-key mapping under `.license-reissues/` by default;
- refuses to run in GitHub Actions and uploads no artifact.

`.license-reissues/` is gitignored. Treat the output as private delivery material and back it up securely. If a request fails after local key creation, rerun the same command with the same output file; the server and tool reject conflicting replacement keys instead of silently creating duplicates. The real purchaser list and real reissue must not be run as part of repository validation.

The historical HMAC secret is no longer needed by the Worker, desktop, reissue tool, build, or release workflows.

## Later production deployment

`packages/license-server/wrangler.jsonc` intentionally remains a non-deployable template with placeholders. Operators supply production configuration through the protected `license-server-production` GitHub environment:

Create the production D1 database first from `packages/license-server/`:

```bash
npx wrangler d1 create image-metahub-licenses
```

Store the canonical UUID returned by Wrangler as `LICENSE_D1_DATABASE_ID` before preparing the production configuration.

Repository/environment variables (public configuration):

- `LICENSE_D1_DATABASE_ID`
- `LICENSE_SERVER_URL`
- `LICENSE_SERVER_PUBLIC_KEY` (passed to the Worker as `LICENSE_SIGNING_PUBLIC_KEY` and to release packaging as `IMH_LICENSE_PUBLIC_KEY`)

Protected secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `LICENSE_SIGNING_PRIVATE_KEY`
- `LICENSE_SERVER_ADMIN_TOKEN`
- `EMAIL_LOOKUP_PEPPER`

The deployment workflow generates the ignored `wrangler.production.generated.json`, rejects missing/placeholding values, validates the D1 ID, validates the production HTTPS URL, verifies that the Ed25519 public/private keys match, performs a Wrangler dry run, configures all Worker secrets, optionally applies D1 migrations, and deploys with the generated D1/public-key configuration. It then runs a mandatory create → activate → refresh → deactivate smoke test and revokes the test entitlement.

No operator should manually edit committed Wrangler configuration with production IDs. The workflow must fail before deployment if any required production input is missing or a placeholder remains.

Release packaging separately runs `scripts/configureLicenseClient.mjs`, which rejects missing, placeholder, non-HTTPS, or malformed public client values. Packaged Electron ignores licensing URL/public-key environment overrides even if external `NODE_ENV=development` is present; overrides are accepted only when `app.isPackaged === false`.

## Package verification

`npm run verify:license-package` performs a TypeScript/Vite build, creates an unpacked Electron package, opens its actual `app.asar`, verifies every Electron licensing runtime module, and scans package contents for sensitive licensing identifiers and any configured secret values. A Vite-only build is not sufficient release validation.

## Future Stripe integration

Stripe is intentionally not implemented here. The D1 schema retains nullable customer, subscription, price, and checkout-session identifiers. Future Stripe webhooks should call the existing `LicenseService` entitlement methods rather than create a second authority:

- lifetime purchase: create an unlimited lifetime entitlement with `source = stripe`;
- monthly/annual purchase or renewal: create or extend `expires_at`;
- cancellation or terminal billing state: update the existing entitlement according to the explicit billing policy.

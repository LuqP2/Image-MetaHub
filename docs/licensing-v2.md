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

- `CLOUDFLARE_ACCOUNT_ID`
- `LICENSE_D1_DATABASE_ID`
- `LICENSE_SERVER_URL`
- `LICENSE_SERVER_PUBLIC_KEY` (passed to the Worker as `LICENSE_SIGNING_PUBLIC_KEY` and to release packaging as `IMH_LICENSE_PUBLIC_KEY`)

Protected secrets:

- `CLOUDFLARE_API_TOKEN`
- `LICENSE_SIGNING_PRIVATE_KEY`
- `LICENSE_SERVER_ADMIN_TOKEN`
- `EMAIL_LOOKUP_PEPPER`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_RESTRICTED_API_KEY`
- `LICENSE_DELIVERY_ENCRYPTION_KEY` (32 random bytes, base64url encoded)
- `RESEND_API_KEY` (sending-only and restricted to the verified sending domain)

Stripe/email variables:

- `STRIPE_ACCOUNT_ID`
- `STRIPE_SUBSCRIPTION_PRODUCT_ID`
- `STRIPE_MONTHLY_PRICE_ID`
- `STRIPE_ANNUAL_PRICE_ID`
- `STRIPE_MONTHLY_HISTORICAL_PRICE_IDS` (optional, comma-separated renewal allowlist)
- `STRIPE_ANNUAL_HISTORICAL_PRICE_IDS` (optional, comma-separated renewal allowlist)
- `STRIPE_LIFETIME_PRICE_ID`
- `LICENSE_EMAIL_FROM`
- `LICENSE_EMAIL_REPLY_TO` (optional)

Production Stripe variable values:

- `STRIPE_ACCOUNT_ID=acct_1ThKSaB04OXmIQu6`
- `STRIPE_SUBSCRIPTION_PRODUCT_ID=prod_V81gqqBbpZ0ccz`
- `STRIPE_MONTHLY_PRICE_ID=price_1U7ld7B04OXmIQu6wmn1uk4R`
- `STRIPE_ANNUAL_PRICE_ID=price_1U7ldDB04OXmIQu6Dx18wNvf`
- `STRIPE_LIFETIME_PRICE_ID=price_1ThKqfB04OXmIQu6mFJPOkyc`

Before replacing a Monthly or Annual Price, append its previous ID to the
corresponding historical allowlist. Historical IDs are accepted for paid
subscription invoices and retain their Monthly or Annual plan mapping; the
current Price variables remain the canonical IDs for new checkouts.

The live-mode Stripe restricted key needs read-only access to Checkout Sessions, Customers,
Subscriptions, Invoices, Charges, PaymentIntents, and Refunds. It must never be
embedded in the desktop application. Stripe Tax remains disabled; this integration
does not set `automatic_tax` or modify any Stripe account setting.

The deployment workflow generates the ignored `wrangler.production.generated.json`, rejects missing/placeholding values, validates the D1 ID, validates the production HTTPS URL, verifies that the Ed25519 public/private keys match, performs a Wrangler dry run, configures all Worker secrets, optionally applies D1 migrations, and deploys with the generated D1/public-key configuration. It then runs a mandatory create → activate → refresh → deactivate smoke test and revokes the test entitlement.

No operator should manually edit committed Wrangler configuration with production IDs. The workflow must fail before deployment if any required production input is missing or a placeholder remains.

Release packaging separately runs `scripts/configureLicenseClient.mjs`, which rejects missing, placeholder, non-HTTPS, or malformed public client values. Packaged Electron ignores licensing URL/public-key environment overrides even if external `NODE_ENV=development` is present; overrides are accepted only when `app.isPackaged === false`.

## Package verification

`npm run verify:license-package` performs a TypeScript/Vite build, creates an unpacked Electron package, opens its actual `app.asar`, verifies every Electron licensing runtime module, and scans package contents for sensitive licensing identifiers and any configured secret values. A Vite-only build is not sufficient release validation.

## Stripe billing integration

`POST /v1/stripe/webhook` verifies the raw request body using the endpoint signing
secret before accepting an event. The handler stores only the event ID, type,
object ID, livemode flag, and timestamps in D1. It never persists the Stripe event
payload. A one-minute scheduled handler drains the event inbox and email outbox;
`waitUntil()` starts the same work opportunistically after a new webhook is safely
persisted.

The endpoint supports:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `invoice.finalization_failed`
- `refund.created`
- `refund.updated`
- `refund.failed`
- `charge.refunded`

The schema separates operator intent from Stripe billing. Migration `0002` adds
`licenses.admin_status` without removing the legacy `status` column, and keeps the
legacy column synchronized with the effective entitlement for rollback safety.
A projection revision distinguishes reducer writes from administrative writes by
the old Worker, so billing changes never overwrite `admin_status`. Removing
`status` and its compatibility trigger is a later contract migration. `admin_status` is
changed only by authenticated administrative operations. Stripe commands write
idempotent subscription, invoice, payment, and refund facts, then rebuild
`stripe_entitlements` inside the same D1 batch. Activation maps the administrative
status and billing projection back to the existing public `status` contract.
An inactive administrative status always wins, even while paid-through and Stripe
audit facts continue to advance.

For recurring products, `invoice.paid` is the only provisioning and renewal
authority. The service selects one non-proration subscription line for an
allowlisted Monthly or Annual Price and uses that line's `period.end` as the paid
through date. The reducer chooses the greatest non-refunded paid period and
compares its paid-event timestamp with the greatest deletion timestamp. Deletion
wins ties; a later paid invoice reactivates access. `past_due`, payment failure,
and `cancel_at_period_end` do not shorten an already-paid period.

Lifetime Checkout is provisioned only after the Session is paid, including delayed
payment confirmation through `checkout.session.async_payment_succeeded`. The
Checkout Session uniqueness constraint deduplicates the immediate and delayed
paths.

Full successful refunds revoke Lifetime. For recurring licenses, a full refund
removes only the matching paid period; it cannot override a later paid invoice.
Refund facts are stored by PaymentIntent and Charge even if the payment webhook
has not arrived, so later facts converge without depending on webhook order.
`refund.updated` and `charge.refunded` cover delayed and aggregate refund
completion. Partial and failed refunds remain audit-only.

New customer keys exist in plaintext only in Worker memory. Before the D1 batch is
committed, the key and recipient are encrypted together using AES-256-GCM and the
delivery payload is inserted atomically with the hashed license. Delivery ownership
uses a compare-and-set lease. The durable transition from `leased` to
`authorized` is the point of no return: cancellation can stop un-authorized work,
but cannot pretend that an external request was unsent after authorization.
Resend receives `license-delivery/<outbox-id>` as its stable idempotency key.
Automatic retries finish within 23 hours. Any uncertain result beyond that window
moves to `manual_review`; the normal retry endpoint returns
`manual_review_required` instead of risking a duplicate email. Successful or
cancelled rows delete the ciphertext, while manual-review rows retain it for
explicit operator recovery.

Unexpected Worker, D1, network, Stripe 429, and Stripe 5xx failures are retryable
by default. Only explicitly classified domain/configuration errors dead-letter
immediately. If even the reschedule write fails, the existing lease expires and
the row becomes claimable again.

Administrative recovery endpoints:

- `POST /v1/admin/stripe/events/:eventId/retry`
- `POST /v1/admin/license-deliveries/:deliveryId/retry`

Production activation still requires a separate, explicit operation: apply
`0002_stripe_billing.sql`, configure the secrets and variables above, deploy the
Worker/Cron Trigger, verify the Resend sender, then register the Stripe webhook at
API version `2026-07-29.dahlia` with exactly the fourteen events listed above. None
of those external actions are performed by repository tests or this deployment
preparation code.

# DRM and Licensing Plan

## Context

The current licensing model is easy to bypass because it is fully client-side:

- Trial state is stored locally in the renderer store.
- Pro activation is validated with a secret embedded in the shipped app.
- Feature access can be bypassed in development via `localStorage`.
- The renderer currently owns too much authority over entitlement decisions.

This document proposes a practical hardening path that also supports annual licenses.

## Current Weak Points

### 1. Offline key validation is not defensible

Current implementation:

- [`utils/licenseKey.ts`](/D:/invokeai-local-image-search/utils/licenseKey.ts)
- [`scripts/generateLicenseKey.mjs`](/D:/invokeai-local-image-search/scripts/generateLicenseKey.mjs)

Problem:

- The same secret used to generate keys is embedded in the client build.
- Anyone who extracts the app secret can generate valid licenses forever.

### 2. Trial is local-only and mutable

Current implementation:

- [`store/useLicenseStore.ts`](/D:/invokeai-local-image-search/store/useLicenseStore.ts)

Problem:

- Trial start date and activation state are stored locally.
- Users can reset storage, edit settings, or patch checks.
- Clock rollback detection is useful but insufficient.

### 3. Renderer controls Pro gating

Current implementation:

- [`hooks/useFeatureAccess.ts`](/D:/invokeai-local-image-search/hooks/useFeatureAccess.ts)

Problem:

- Entitlement logic runs in the renderer, which is the easiest layer to tamper with.
- The `IMH_DEV_LICENSE` bypass is convenient for development but dangerous if it leaks into production assumptions.

### 4. Public debug flows document bypasses

Current implementation:

- [`scripts/debug-license.js`](/D:/invokeai-local-image-search/scripts/debug-license.js)
- [`scripts/debug-license-electron.js`](/D:/invokeai-local-image-search/scripts/debug-license-electron.js)
- [`scripts/DEBUG-LICENSE.md`](/D:/invokeai-local-image-search/scripts/DEBUG-LICENSE.md)

Problem:

- These are fine for local development, but the production architecture must assume that state injection is trivial.

## Important Constraint

There is no such thing as unbreakable DRM in a desktop app controlled by the user.

The real objective is:

- make casual bypass much harder,
- make long-term bypass expensive to maintain,
- preserve a reasonable offline experience,
- support revocation, renewal, and annual expiration cleanly.

## Target Architecture

### Core Principle

Move license authority out of the renderer and out of static secrets embedded in the distributed client.

### New Model

1. A small license backend becomes the source of truth.
2. The app activates against that backend.
3. The backend returns a signed entitlement token.
4. The Electron main process validates and stores that entitlement.
5. The renderer receives only a derived entitlement snapshot through IPC.
6. The app periodically refreshes the entitlement while allowing a bounded offline grace period.

## Product Model

Support three product types:

- `trial`
- `annual`
- `lifetime`

Suggested normalized entitlement shape:

```ts
type LicensePlan = 'trial' | 'annual' | 'lifetime';
type EntitlementStatus = 'active' | 'grace' | 'expired' | 'revoked';

interface EntitlementSnapshot {
  licenseId: string;
  customerEmail: string;
  plan: LicensePlan;
  status: EntitlementStatus;
  featureSet: 'free' | 'pro';
  issuedAt: string;
  expiresAt: string | null;
  graceEndsAt: string | null;
  offlineValidUntil: string | null;
  activationId: string;
  deviceId: string;
  signature: string;
}
```

## Annual License Rules

Recommended behavior for annual licenses:

- License is active until `expiresAt`.
- App can continue working offline until `offlineValidUntil`.
- After subscription expiration, app enters grace or expired state depending on backend policy.
- Renewals do not require a new activation UX; only entitlement refresh.
- Lifetime licenses use `expiresAt = null`.

Suggested commercial rules:

- Annual plan duration: 365 days from purchase or renewal.
- Offline grace while active: 7 to 14 days.
- Renewal grace after expiration: 3 to 7 days.
- Optional device limit: 2 to 3 active devices per license.

## Recommended Security Changes

### Phase 1. Remove trust from the renderer

Changes:

- Move license validation and persistence into Electron main process.
- Expose only `getEntitlement()`, `activateLicense()`, `refreshEntitlement()`, and `startTrial()` via preload.
- Stop letting the renderer directly determine authority from raw persisted fields.

Expected files:

- [`electron.mjs`](/D:/invokeai-local-image-search/electron.mjs)
- [`preload.js`](/D:/invokeai-local-image-search/preload.js)
- [`store/useLicenseStore.ts`](/D:/invokeai-local-image-search/store/useLicenseStore.ts)
- [`hooks/useFeatureAccess.ts`](/D:/invokeai-local-image-search/hooks/useFeatureAccess.ts)

### Phase 2. Replace embedded secret licensing with signed entitlements

Changes:

- Remove HMAC license generation from the distributed app.
- Keep private signing key only on the backend.
- Ship only the public verification key in the client.
- Prefer asymmetric signatures like Ed25519 over shared-secret HMAC.

Why:

- A public verification key can be embedded safely.
- The client can verify authenticity without being able to mint licenses.

### Phase 3. Harden trial issuance

Changes:

- Trial starts only after backend issuance.
- Backend records one trial per customer or device fingerprint, depending on policy.
- Store a signed trial entitlement locally with an offline validity window.

Notes:

- If you want a no-login trial, device-based trial issuance is acceptable.
- If you want stronger control, require email verification before starting trial.

### Phase 4. Add activation records and device binding

Changes:

- Generate a stable app-scoped device ID on first run.
- Include device ID in activation and refresh requests.
- Backend tracks activations and allows revocation/deactivation.

Do not overreach:

- Hardware fingerprinting should be minimal and privacy-aware.
- Avoid aggressive fingerprinting that looks hostile or breaks legitimate users.

### Phase 5. Use secure local storage

Changes:

- Store entitlement and activation metadata in Electron main process.
- Prefer OS-protected storage where possible:
  - Windows Credential Locker / DPAPI
  - macOS Keychain
  - Linux secret service if available
- Fall back to encrypted local storage only if necessary.

### Phase 6. Production-only hardening

Changes:

- Ensure `IMH_DEV_LICENSE` bypass is compiled out or disabled in production.
- Gate debug scripts behind development checks.
- Fail builds if development bypass code is enabled in production artifacts.

## Backend Scope

A minimal licensing service only needs:

- `POST /trial/start`
- `POST /licenses/activate`
- `POST /licenses/refresh`
- `POST /licenses/deactivate`
- `GET /licenses/:id`

Suggested backend responsibilities:

- store customers, licenses, plans, renewals, activations,
- issue signed entitlement payloads,
- enforce annual expiration,
- enforce activation limits,
- support manual revocation/refunds.

This can be a small Node service with SQLite/Postgres to start.

## Client Data Model Changes

Replace the current local store shape with something closer to:

```ts
type LicenseStatus =
  | 'free'
  | 'trial'
  | 'pro_annual'
  | 'pro_lifetime'
  | 'grace'
  | 'expired'
  | 'revoked';

interface LicenseState {
  initialized: boolean;
  status: LicenseStatus;
  plan: 'trial' | 'annual' | 'lifetime' | null;
  featureSet: 'free' | 'pro';
  customerEmail: string | null;
  licenseId: string | null;
  activationId: string | null;
  expiresAt: string | null;
  offlineValidUntil: string | null;
  lastValidatedAt: string | null;
  nextRefreshAt: string | null;
}
```

## Migration Plan

### Milestone A. Short-term hardening without backend

This does not solve the root problem, but reduces trivial bypass:

- remove production renderer bypasses,
- move checks into main process,
- sign local entitlements with a key pair where only public key ships,
- obfuscate less-important UI hints instead of treating them as security.

Limitation:

- Without a backend, annual licensing and revocation remain weak.

### Milestone B. Introduce backend authority

- Stand up license service.
- Add activation and refresh flows.
- Add signed entitlement verification in app.
- Migrate new sales to backend-issued licenses.

### Milestone C. Migrate existing offline Pro users

Options:

- honor existing lifetime keys by converting them to backend licenses,
- issue grandfathered lifetime entitlements,
- email migration instructions with one-click claim flow.

## UX Requirements

The licensing UX should remain simple:

- Free mode works immediately.
- Trial start is one click.
- Activation supports copy/paste license code or signed login link.
- Offline users see clear messaging about grace windows and next validation date.
- Expired annual licenses degrade cleanly back to Free without corrupting data.

## Feature Gating Guidance

Do not rely on UI hiding alone. Sensitive actions should verify entitlements at the execution boundary too.

Examples:

- A1111 generation
- ComfyUI generation
- batch export
- bulk tagging
- full clustering
- analytics views

That means checking entitlements both:

- in the renderer for UX,
- and again in the process or action handler that actually performs the work.

## Testing Plan

Add tests for:

- active annual license,
- annual renewal,
- annual expiration,
- offline grace window,
- revoked entitlement,
- trial issuance and reuse prevention,
- clock skew handling,
- migration from existing local `pro` and `trial` states.

## Recommended Delivery Order

1. Remove production bypasses and move authority to Electron main.
2. Define entitlement schema and signed-token verification.
3. Implement license backend with annual and lifetime plans.
4. Integrate activation, refresh, offline grace, and revocation.
5. Migrate current users and update Settings UI.

## Branch Scope For This Work

This branch is for planning and architecture only.

Implementation should be split into follow-up branches:

- `codex/license-main-process-foundation`
- `codex/license-backend-entitlements`
- `codex/license-annual-plan-ui`
- `codex/license-migration-existing-users`

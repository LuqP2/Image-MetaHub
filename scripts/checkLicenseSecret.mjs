#!/usr/bin/env node

/**
 * Fails the build if IMH_LICENSE_SECRET is missing or still the placeholder.
 * This prevents shipping binaries that cannot validate paid licenses.
 */

const PLACEHOLDER = 'CHANGE-ME-BEFORE-RELEASE';
const secret = process.env.IMH_LICENSE_SECRET;

if (!secret) {
  console.error('[IMH] IMH_LICENSE_SECRET is not set. Set it in the environment before building (e.g., IMH_LICENSE_SECRET="your-secret" npm run build).');
  process.exit(1);
}

if (secret === PLACEHOLDER) {
  console.error('[IMH] IMH_LICENSE_SECRET is still the placeholder. Replace it with your real secret before building.');
  process.exit(1);
}

console.log('[IMH] License secret detected for build (value hidden).');

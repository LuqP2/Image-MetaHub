#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

const outputPath = path.resolve('build', 'license-runtime-config.mjs');
const appStage =
  process.env.IMH_APP_STAGE ||
  (process.env.NODE_ENV === 'production' ? 'production' : 'development');

const serverUrl = (process.env.IMH_LICENSE_SERVER_URL || '').trim();
const publicKey = (process.env.IMH_LICENSE_PUBLIC_KEY || '').trim();

if (appStage === 'production') {
  if (!serverUrl) {
    console.error('[IMH] IMH_LICENSE_SERVER_URL is required for production builds.');
    process.exit(1);
  }

  if (!publicKey) {
    console.error('[IMH] IMH_LICENSE_PUBLIC_KEY is required for production builds.');
    process.exit(1);
  }
}

const contents = `export const LICENSE_RUNTIME_CONFIG = ${JSON.stringify(
  {
    appStage,
    serverUrl,
    publicKey,
  },
  null,
  2
)};\n`;

await fs.writeFile(outputPath, contents, 'utf8');
console.log(`[IMH] License runtime config written to ${outputPath}`);

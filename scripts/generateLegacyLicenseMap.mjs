import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateRandomLicenseKey } from '../packages/license-server/src/cryptoHelpers.js';

const OUTPUT_VERSION = 1;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const normalizeHistoricalEmail = (email) => String(email || '').trim().toLowerCase();

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;

async function atomicWriteJson(outputPath, value) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryPath, outputPath);
}

async function loadOutput(outputPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    if (parsed?.version !== OUTPUT_VERSION || !Array.isArray(parsed.entries)) {
      throw new Error('Historical reissue output has an unsupported format.');
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: OUTPUT_VERSION, entries: [] };
    throw error;
  }
}

export async function reissueHistoricalLicenses({
  emailsInput,
  outputPath,
  serverUrl,
  adminToken,
  fetchImpl = fetch,
  generateKey = () => generateRandomLicenseKey(globalThis.crypto),
}) {
  if (!outputPath || !serverUrl || !adminToken) {
    throw new Error('Output path, license server URL and admin token are required.');
  }

  const candidates = Array.from(new Set(
    String(emailsInput || '')
      .split(/[\r\n,;]+/)
      .map(normalizeHistoricalEmail)
      .filter(Boolean),
  ));
  if (candidates.length === 0) throw new Error('No historical purchaser emails were provided.');

  const absoluteOutputPath = path.resolve(outputPath);
  const relativeToRepository = path.relative(repositoryRoot, absoluteOutputPath);
  if (!relativeToRepository.startsWith('..') && !path.isAbsolute(relativeToRepository)) {
    const [topLevelDirectory] = relativeToRepository.split(path.sep);
    if (topLevelDirectory !== '.license-reissues') {
      throw new Error('Historical reissue output inside the repository must be under the gitignored .license-reissues directory.');
    }
  }
  const output = await loadOutput(absoluteOutputPath);
  const entriesByEmail = new Map(output.entries.map((entry) => [normalizeHistoricalEmail(entry.email), entry]));
  const summary = { reissued: 0, alreadyConfirmed: 0, failed: 0 };

  for (const email of candidates) {
    if (!isValidEmail(email)) {
      summary.failed += 1;
      continue;
    }

    let entry = entriesByEmail.get(email);
    if (entry?.status === 'confirmed') {
      summary.alreadyConfirmed += 1;
      continue;
    }
    if (!entry) {
      entry = { email, licenseKey: generateKey(), status: 'pending', licenseId: null };
      output.entries.push(entry);
      entriesByEmail.set(email, entry);
      // Persist before the request so a retry submits the same random key.
      await atomicWriteJson(absoluteOutputPath, output);
    }

    try {
      const response = await fetchImpl(`${serverUrl.replace(/\/$/, '')}/v1/admin/licenses/reissue-historical`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ email, licenseKey: entry.licenseKey }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.license?.id) {
        summary.failed += 1;
        continue;
      }
      entry.status = 'confirmed';
      entry.licenseId = data.license.id;
      await atomicWriteJson(absoluteOutputPath, output);
      summary.reissued += 1;
    } catch {
      summary.failed += 1;
    }
  }

  return { summary, outputPath: absoluteOutputPath };
}

async function main() {
  if (process.env.GITHUB_ACTIONS === 'true') {
    throw new Error('Historical reissue is local-only and must not run in GitHub Actions.');
  }
  const inputPath = process.argv[2] || process.env.IMH_HISTORICAL_PURCHASERS_PATH;
  const outputPath = process.argv[3]
    || process.env.IMH_HISTORICAL_REISSUE_OUTPUT
    || path.join('.license-reissues', 'historical-imh2-reissues.json');
  if (!inputPath) throw new Error('Provide the verified purchaser-list path as the first argument.');
  const emailsInput = await fs.readFile(path.resolve(inputPath), 'utf8');
  const result = await reissueHistoricalLicenses({
    emailsInput,
    outputPath,
    serverUrl: process.env.IMH_LICENSE_SERVER_URL,
    adminToken: process.env.LICENSE_SERVER_ADMIN_TOKEN,
  });
  const { reissued, alreadyConfirmed, failed } = result.summary;
  console.log(`Historical reissue complete: ${reissued} confirmed; ${alreadyConfirmed} already confirmed; ${failed} failed.`);
  console.log(`Private purchaser-to-key mapping: ${result.outputPath}`);
  if (failed > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error?.message || 'Historical reissue failed.');
    process.exit(1);
  });
}

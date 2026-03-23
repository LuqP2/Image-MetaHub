import {
  closeDb,
  createLicenseRecord,
  ensureKeypair,
  findLicensesByEmail,
  generateLegacyLicenseKeyFromEmail,
  listLicenses,
  parseArgs,
  paths,
  upsertImportedLifetimeLicense,
} from './lib.mjs';
import fs from 'fs/promises';

const rawArgs = process.argv.slice(2).filter((value) => value !== '--');
const knownCommands = new Set([
  'generate-keypair',
  'create-license',
  'list-licenses',
  'find-license',
  'import-gumroad-lifetime',
  'apply-license-map',
  'extract-gumroad-emails',
]);

let command = rawArgs.find((value) => knownCommands.has(value)) || null;
let rest = rawArgs;

if (command) {
  const commandIndex = rawArgs.indexOf(command);
  rest = rawArgs.slice(0, commandIndex).concat(rawArgs.slice(commandIndex + 1));
}

if (!command) {
  // When called through `npm run license-server:create-license -- ...`,
  // npm can invoke this script without preserving the logical subcommand.
  // In that case, infer the command from the provided flags.
  command = rest.some((value) => value.startsWith('--email')) ? 'create-license' : null;
}

const args = parseArgs(rest);

const getArg = (name) => {
  if (args[name] !== undefined) {
    return args[name];
  }

  const envKey = `npm_config_${name.toLowerCase()}`;
  if (process.env[envKey] !== undefined) {
    return process.env[envKey];
  }

  if (name === 'maxDevices' && process.env.npm_config_maxdevices !== undefined) {
    return process.env.npm_config_maxdevices;
  }

  return undefined;
};

const TRUTHY_CSV_VALUES = new Set(['1', 'true', 'yes', 'y']);

function isTruthyCsvValue(value) {
  return TRUTHY_CSV_VALUES.has(String(value || '').trim().toLowerCase());
}

function parseCsv(content) {
  const rows = [];
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if (char === '\n' && !inQuotes) {
      row.push(current);
      rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  const [headers = [], ...dataRows] = rows;
  return dataRows
    .filter((values) => values.some((value) => String(value || '').trim() !== ''))
    .map((values) => {
      const entry = {};
      headers.forEach((header, index) => {
        entry[header] = values[index] ?? '';
      });
      return entry;
    });
}

const isLikelyEmail = (value) =>
  typeof value === 'string' &&
  value !== 'true' &&
  value !== 'false' &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

if (command === 'generate-keypair') {
  const { publicKeyPem } = await ensureKeypair();
  console.log(`Private key: ${paths.privateKeyPath}`);
  console.log(`Public key: ${paths.publicKeyPath}`);
  console.log('');
  console.log(publicKeyPem);
  closeDb();
  process.exit(0);
}

if (command === 'create-license') {
  const email = String(getArg('email') || '').trim();
  const plan = String(getArg('plan') || 'annual').trim();
  const days = Number(getArg('days') || 365);
  const maxDevices = Number(getArg('maxDevices') || 2);

  if (!isLikelyEmail(email)) {
    console.error('Missing or invalid --email');
    process.exit(1);
  }

  const license = await createLicenseRecord({ email, plan, days, maxDevices });
  console.log(JSON.stringify(license, null, 2));
  closeDb();
  process.exit(0);
}

if (command === 'list-licenses') {
  const licenses = await listLicenses();
  console.log(JSON.stringify(licenses, null, 2));
  closeDb();
  process.exit(0);
}

if (command === 'find-license') {
  const email = String(getArg('email') || '').trim();

  if (!isLikelyEmail(email)) {
    console.error('Missing or invalid --email');
    process.exit(1);
  }

  const licenses = await findLicensesByEmail(email);
  console.log(JSON.stringify(licenses, null, 2));
  closeDb();
  process.exit(0);
}

if (command === 'import-gumroad-lifetime') {
  const filePath = String(getArg('file') || '').trim();
  const productId = String(getArg('productId') || '').trim();
  const maxDevices = Number(getArg('maxDevices') || 2);

  if (!filePath) {
    console.error('Missing --file');
    process.exit(1);
  }

  const rawCsv = await fs.readFile(filePath, 'utf8');
  const rows = parseCsv(rawCsv);
  let imported = 0;
  let skippedExisting = 0;
  let skippedFlagged = 0;
  let skippedProduct = 0;
  let skippedInvalid = 0;

  for (const row of rows) {
    const email = String(row['Purchase Email'] || '').trim();
    const currentProductId = String(row['Product ID'] || '').trim();
    const isFlagged =
      isTruthyCsvValue(row['Refunded?']) ||
      isTruthyCsvValue(row['Fully Refunded?']) ||
      isTruthyCsvValue(row['Disputed?']) ||
      isTruthyCsvValue(row['Access Revoked?']);

    if (!isLikelyEmail(email)) {
      skippedInvalid += 1;
      continue;
    }

    if (productId && currentProductId !== productId) {
      skippedProduct += 1;
      continue;
    }

    if (isFlagged) {
      skippedFlagged += 1;
      continue;
    }

    const legacyLicenseKey = generateLegacyLicenseKeyFromEmail(email);
    const result = await upsertImportedLifetimeLicense({ email, maxDevices, licenseKey: legacyLicenseKey });
    if (result.created) {
      imported += 1;
    } else {
      skippedExisting += 1;
    }
  }

  console.log(JSON.stringify({
    success: true,
    filePath,
    imported,
    skippedExisting,
    skippedFlagged,
    skippedProduct,
    skippedInvalid,
    totalRows: rows.length,
  }, null, 2));
  closeDb();
  process.exit(0);
}

if (command === 'extract-gumroad-emails') {
  const filePath = String(getArg('file') || '').trim();
  const productIdsRaw = String(getArg('productIds') || '').trim();
  const productIds = new Set(
    productIdsRaw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );

  if (!filePath) {
    console.error('Missing --file');
    process.exit(1);
  }

  const rawCsv = await fs.readFile(filePath, 'utf8');
  const rows = parseCsv(rawCsv);
  const emails = [];
  const seen = new Set();

  for (const row of rows) {
    const email = String(row['Purchase Email'] || '').trim().toLowerCase();
    const currentProductId = String(row['Product ID'] || '').trim();
    const isFlagged =
      isTruthyCsvValue(row['Refunded?']) ||
      isTruthyCsvValue(row['Fully Refunded?']) ||
      isTruthyCsvValue(row['Disputed?']) ||
      isTruthyCsvValue(row['Access Revoked?']);

    if (!isLikelyEmail(email)) continue;
    if (productIds.size > 0 && !productIds.has(currentProductId)) continue;
    if (isFlagged) continue;
    if (seen.has(email)) continue;

    seen.add(email);
    emails.push(email);
  }

  console.log(emails.join('\n'));
  closeDb();
  process.exit(0);
}

if (command === 'apply-license-map') {
  const filePath = String(getArg('file') || '').trim();
  const maxDevices = Number(getArg('maxDevices') || 2);

  if (!filePath) {
    console.error('Missing --file');
    process.exit(1);
  }

  const rawCsv = await fs.readFile(filePath, 'utf8');
  const rows = parseCsv(rawCsv);
  let applied = 0;
  let skippedInvalid = 0;

  for (const row of rows) {
    const email = String(row.email || row.Email || row['Purchase Email'] || '').trim();
    const licenseKey = String(row.licenseKey || row.License || row['License Key'] || '').trim();

    if (!isLikelyEmail(email) || !licenseKey) {
      skippedInvalid += 1;
      continue;
    }

    await upsertImportedLifetimeLicense({ email, maxDevices, licenseKey });
    applied += 1;
  }

  console.log(JSON.stringify({
    success: true,
    filePath,
    applied,
    skippedInvalid,
    totalRows: rows.length,
  }, null, 2));
  closeDb();
  process.exit(0);
}

console.log('Usage:');
console.log('  node cli.mjs generate-keypair');
console.log('  node cli.mjs create-license --email you@example.com --plan annual --days 365 --maxDevices 2');
console.log('  node cli.mjs list-licenses');
console.log('  node cli.mjs find-license --email you@example.com');
console.log('  node cli.mjs import-gumroad-lifetime --file C:\\path\\to\\Sales.csv --productId qmjima --maxDevices 2');
console.log('  node cli.mjs extract-gumroad-emails --file C:\\path\\to\\Sales.csv --productIds qmjima,hczgm');
console.log('  node cli.mjs apply-license-map --file C:\\path\\to\\legacy-license-map.csv --maxDevices 2');
process.exit(1);

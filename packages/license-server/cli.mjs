import {
  closeDb,
  createLicenseRecord,
  ensureKeypair,
  listLicenses,
  parseArgs,
  paths,
} from './lib.mjs';

const rawArgs = process.argv.slice(2).filter((value) => value !== '--');
const knownCommands = new Set(['generate-keypair', 'create-license', 'list-licenses']);

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

console.log('Usage:');
console.log('  node cli.mjs generate-keypair');
console.log('  node cli.mjs create-license --email you@example.com --plan annual --days 365 --maxDevices 2');
console.log('  node cli.mjs list-licenses');
process.exit(1);

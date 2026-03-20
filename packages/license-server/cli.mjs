import {
  createLicenseRecord,
  ensureKeypair,
  loadDb,
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

if (command === 'generate-keypair') {
  const { publicKeyPem } = await ensureKeypair();
  console.log(`Private key: ${paths.privateKeyPath}`);
  console.log(`Public key: ${paths.publicKeyPath}`);
  console.log('');
  console.log(publicKeyPem);
  process.exit(0);
}

if (command === 'create-license') {
  const email = String(args.email || '').trim();
  const plan = String(args.plan || 'annual').trim();
  const days = Number(args.days || 365);
  const maxDevices = Number(args.maxDevices || 2);

  if (!email) {
    console.error('Missing --email');
    process.exit(1);
  }

  const license = await createLicenseRecord({ email, plan, days, maxDevices });
  console.log(JSON.stringify(license, null, 2));
  process.exit(0);
}

if (command === 'list-licenses') {
  const db = await loadDb();
  console.log(JSON.stringify(db.licenses, null, 2));
  process.exit(0);
}

console.log('Usage:');
console.log('  node cli.mjs generate-keypair');
console.log('  node cli.mjs create-license --email you@example.com --plan annual --days 365 --maxDevices 2');
console.log('  node cli.mjs list-licenses');
process.exit(1);

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadOperatorLicenseConfig, operatorConfigPath } from './licenseOperatorConfig.mjs';

const serverUrl = 'https://image-metahub-license-server.image-metahub.workers.dev';
const githubRepository = 'LuqP2/Image-MetaHub';
const githubEnvironment = 'license-server-production';
const workerName = 'image-metahub-license-server';
const wranglerVersion = '4.28.1';

const runCliCommand = ({ command, args, input, label, platform = process.platform }) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    shell: platform === 'win32' && command === 'npx',
  });
  let settled = false;
  const fail = (error) => {
    if (settled) return;
    settled = true;
    reject(error);
  };
  child.once('error', (error) => fail(new Error(`${label}: ${error.message}`)));
  child.once('exit', (code) => {
    if (settled) return;
    settled = true;
    if (code === 0) resolve();
    else reject(new Error(`${label} failed with exit code ${code ?? 'unknown'}.`));
  });
  if (input !== undefined) {
    child.stdin.once('error', fail);
    child.stdin.end(input);
  }
});

const writeOperatorConfig = (adminToken) => {
  fs.writeFileSync(operatorConfigPath, [
    '# Local operator credentials. Never commit or share this file.',
    `IMH_LICENSE_SERVER_URL=${serverUrl}`,
    `LICENSE_SERVER_ADMIN_TOKEN=${adminToken}`,
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o600 });
};

export async function setupLicenseOperator({
  env = process.env,
  existingConfig = fs.existsSync(operatorConfigPath) ? loadOperatorLicenseConfig() : null,
  createAdminToken = () => crypto.randomBytes(48).toString('base64url'),
  persistOperatorConfig = writeOperatorConfig,
  runCommand = runCliCommand,
  platform = process.platform,
} = {}) {
  if (env.GITHUB_ACTIONS === 'true') {
    throw new Error('License operator setup is local-only and must not run in GitHub Actions.');
  }

  const reusingExistingToken = existingConfig !== null;
  if (reusingExistingToken
    && (!existingConfig.IMH_LICENSE_SERVER_URL || !existingConfig.LICENSE_SERVER_ADMIN_TOKEN)) {
    throw new Error('Saved operator configuration is incomplete. Restore or deliberately replace it before setup.');
  }
  const configuredServerUrl = reusingExistingToken
    ? String(existingConfig.IMH_LICENSE_SERVER_URL).trim().replace(/\/$/, '')
    : serverUrl;
  const adminToken = reusingExistingToken
    ? String(existingConfig.LICENSE_SERVER_ADMIN_TOKEN).trim()
    : String(createAdminToken()).trim();
  if (configuredServerUrl !== serverUrl || adminToken.length < 32) {
    throw new Error('Existing operator configuration is invalid. Restore or deliberately replace it before setup.');
  }

  await runCommand({
    command: 'gh',
    args: ['auth', 'status'],
    label: 'GitHub authentication preflight',
    platform,
  });
  await runCommand({
    command: 'npx',
    args: ['--yes', `wrangler@${wranglerVersion}`, 'whoami'],
    label: 'Cloudflare authentication preflight',
    platform,
  });

  if (!reusingExistingToken) persistOperatorConfig(adminToken);

  const secretInput = `${adminToken}\n`;
  await runCommand({
    command: 'gh',
    args: [
      'secret', 'set', 'LICENSE_SERVER_ADMIN_TOKEN',
      '--repo', githubRepository,
      '--env', githubEnvironment,
    ],
    input: secretInput,
    label: 'GitHub deployment secret synchronization',
    platform,
  });
  await runCommand({
    command: 'npx',
    args: [
      '--yes', `wrangler@${wranglerVersion}`,
      'secret', 'put', 'LICENSE_SERVER_ADMIN_TOKEN',
      '--name', workerName,
    ],
    input: secretInput,
    label: 'Cloudflare Worker secret synchronization',
    platform,
  });

  return { reusingExistingToken };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await setupLicenseOperator();
    console.log(result.reusingExistingToken
      ? `Existing operator token synchronized with GitHub and Cloudflare: ${operatorConfigPath}`
      : `Operator configuration created and synchronized: ${operatorConfigPath}`);
    console.log('Future issuance: npm run license:create -- buyer@example.com lifetime');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('Fix the reported preflight or synchronization failure, then rerun this command. Any existing local operator token was retained.');
    process.exitCode = 1;
  }
}

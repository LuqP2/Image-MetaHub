import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { operatorConfigPath } from './licenseOperatorConfig.mjs';

const serverUrl = 'https://image-metahub-license-server.image-metahub.workers.dev';
const wranglerConfig = 'packages/license-server/wrangler.production.generated.json';

if (fs.existsSync(operatorConfigPath)) {
  console.error(`Operator configuration already exists at ${operatorConfigPath}. Delete it first only if you intend to rotate the admin token.`);
  process.exit(1);
}

const adminToken = crypto.randomBytes(48).toString('base64url');
const child = spawn('npx', ['--yes', 'wrangler@4.28.1', 'secret', 'put', 'LICENSE_SERVER_ADMIN_TOKEN', '--config', wranglerConfig], {
  stdio: ['pipe', 'inherit', 'inherit'],
  shell: process.platform === 'win32',
});

child.stdin.write(`${adminToken}\n`);
child.stdin.end();

child.on('error', (error) => {
  console.error(`Unable to run Wrangler: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code) => {
  if (code !== 0) process.exit(code || 1);

  fs.writeFileSync(operatorConfigPath, [
    '# Local operator credentials. Never commit or share this file.',
    `IMH_LICENSE_SERVER_URL=${serverUrl}`,
    `LICENSE_SERVER_ADMIN_TOKEN=${adminToken}`,
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o600 });
  console.log(`Operator configuration saved locally: ${operatorConfigPath}`);
  console.log('Future issuance: npm run license:create -- buyer@example.com lifetime');
});

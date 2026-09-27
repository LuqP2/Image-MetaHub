import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!executablePath) throw new Error('Usage: node scripts/runPackagedAutoTagSmoke.mjs <packaged exe>');
await fs.access(executablePath);

const temporaryRoot = path.join(os.tmpdir(), `imh-autotag-smoke-${crypto.randomUUID()}`);
const imagePath = path.join(temporaryRoot, 'synthetic.png');
const profilePath = path.join(temporaryRoot, 'synthetic-profile');
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
await fs.mkdir(temporaryRoot, { recursive: true });
await fs.writeFile(imagePath, pngBytes);

try {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(executablePath, [`--user-data-dir=${profilePath}`, '--enable-logging=stderr'], {
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        IMH_PACKAGED_DETACHED_VIEWER_SMOKE_IMAGE: imagePath,
        IMH_PACKAGED_AUTOTAG_SMOKE: '1',
        IMH_DISABLE_GPU: '1',
        ELECTRON_ENABLE_LOGGING: 'true',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let text = '';
    const collect = (chunk) => { text += chunk; };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Packaged Auto-Tag smoke timed out.\n${text}`));
    }, 90_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve({ code, text });
    });
  });

  const required = [
    '[packaged-detached-viewer-smoke] renderer-ready',
    '[packaged-detached-viewer-smoke] auto-tag-worker-ready',
    '[packaged-detached-viewer-smoke] auto-tag-ipc-round-trip',
  ];
  if (output.code !== 0 || required.some(marker => !output.text.includes(marker))) {
    throw new Error(`Packaged Auto-Tag smoke failed with exit ${output.code}.\n${output.text}`);
  }
  console.log(required.join('\n'));
} finally {
  const relative = path.relative(os.tmpdir(), temporaryRoot);
  if (!relative.startsWith('..') && !path.isAbsolute(relative) && relative.startsWith('imh-autotag-smoke-')) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

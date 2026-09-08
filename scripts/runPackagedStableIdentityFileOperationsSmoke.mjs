import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

function fail(message) {
  throw new Error(`Packaged provenance smoke runner: ${message}`);
}

async function runExecutable(executablePath, args, env, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out after ${timeoutMs}ms.\n${stdout}\n${stderr}`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

const [inputExecutable, mode = 'installed'] = process.argv.slice(2);
if (!inputExecutable || !['installed', 'portable'].includes(mode)) {
  fail('usage: node scripts/runPackagedStableIdentityFileOperationsSmoke.mjs <exe> <installed|portable>');
}

const sourceExecutable = path.resolve(inputExecutable);
await fs.access(sourceExecutable);
const temporaryRoot = path.join(os.tmpdir(), `Image MetaHub smoke com espaço e acento ç ${crypto.randomUUID()}`);
await fs.mkdir(temporaryRoot, { recursive: true });

let primaryError = null;
try {
  const executablePath = mode === 'portable'
    ? path.join(temporaryRoot, 'Image MetaHub Portable ç.exe')
    : sourceExecutable;
  if (mode === 'portable') await fs.copyFile(sourceExecutable, executablePath);
  const resultPath = path.join(temporaryRoot, 'smoke-result.json');
  const syntheticRoot = path.join(temporaryRoot, 'Biblioteca sintética ç');
  const installedProfile = path.join(temporaryRoot, 'Perfil instalado ç');
  const args = ['--enable-logging=stderr'];
  if (mode === 'installed') args.push(`--user-data-dir=${installedProfile}`);
  const env = {
    ...process.env,
    IMH_ENABLE_PROVENANCE_INDEXING: '1',
    IMH_PACKAGED_PROVENANCE_FILE_OPERATIONS_SMOKE: '1',
    IMH_PACKAGED_PROVENANCE_FILE_OPERATIONS_SMOKE_ROOT: syntheticRoot,
    IMH_PACKAGED_PROVENANCE_FILE_OPERATIONS_SMOKE_RESULT: resultPath,
    IMH_DISABLE_GPU: '1',
    ELECTRON_ENABLE_LOGGING: 'true',
  };
  const execution = await runExecutable(executablePath, args, env);
  if (execution.code !== 0) fail(`process exited with ${execution.code}.\n${execution.stdout}\n${execution.stderr}`);
  const result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
  if (
    !result.success
    || result.pendingOperations !== 0
    || result.schemaVersion !== 5
    || result.userData?.authority !== 'sqlite'
    || result.userData?.legacyScanComplete !== true
    || result.userData?.copiedRating !== 2
    || result.userData?.copiedShadowSeed !== 0
    || result.userData?.reopened !== true
  ) fail('invalid result payload');
  if (!path.resolve(result.paths.syntheticRoot).startsWith(path.resolve(temporaryRoot))) fail('synthetic data escaped the temporary root');
  if (mode === 'portable') {
    const expectedUserData = path.join(temporaryRoot, 'ImageMetaHubData');
    if (path.resolve(result.paths.userDataPath) !== path.resolve(expectedUserData)) fail('portable userData did not use ImageMetaHubData beside the launcher');
    if (!result.paths.portableExecutableDir || path.resolve(result.paths.portableExecutableDir) !== path.resolve(temporaryRoot)) {
      fail('portable launcher directory was not propagated');
    }
    if (path.resolve(result.paths.userDataPath).startsWith(path.resolve(result.paths.resourcesPath))) {
      fail('portable userData was placed inside the extraction/resources directory');
    }
  } else if (path.resolve(result.paths.userDataPath) !== path.resolve(installedProfile)) {
    fail('installed-equivalent launch ignored the temporary user-data profile');
  }
  process.stdout.write(`${JSON.stringify({ mode, ...result }, null, 2)}\n`);
} catch (error) {
  primaryError = error;
} finally {
  try {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError;
    else process.stderr.write(`Smoke cleanup warning: ${cleanupError?.message || cleanupError}\n`);
  }
}

if (primaryError) throw primaryError;

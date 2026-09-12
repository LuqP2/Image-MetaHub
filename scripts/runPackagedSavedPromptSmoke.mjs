import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function fail(message) {
  throw new Error(`Packaged saved-prompt smoke runner: ${message}`);
}

function runExecutable(executablePath, args, env, timeoutMs = 120_000) {
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

const [inputExecutable] = process.argv.slice(2);
if (!inputExecutable) fail('usage: node scripts/runPackagedSavedPromptSmoke.mjs <exe>');

const executablePath = path.resolve(inputExecutable);
await fs.access(executablePath);
const temporaryRoot = path.join(os.tmpdir(), `Image MetaHub prompt smoke ç ${crypto.randomUUID()}`);
await fs.mkdir(temporaryRoot, { recursive: true });

let primaryError = null;
try {
  const results = [];
  for (const indexingEnabled of [false, true]) {
    const variant = indexingEnabled ? 'on' : 'off';
    const resultPath = path.join(temporaryRoot, `saved-prompt-${variant}.json`);
    const profilePath = path.join(temporaryRoot, `Perfil sintético flag ${variant} ç`);
    const execution = await runExecutable(
      executablePath,
      [`--user-data-dir=${profilePath}`, '--enable-logging=stderr'],
      {
        ...process.env,
        IMH_ENABLE_PROVENANCE_INDEXING: indexingEnabled ? '1' : '0',
        IMH_PACKAGED_SAVED_PROMPT_SMOKE: '1',
        IMH_PACKAGED_SAVED_PROMPT_SMOKE_RESULT: resultPath,
        IMH_DISABLE_GPU: '1',
        ELECTRON_ENABLE_LOGGING: 'true',
      },
    );
    if (execution.code !== 0) fail(`flag ${variant} exited with ${execution.code}.\n${execution.stdout}\n${execution.stderr}`);
    const result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
    if (
      !result.success
      || result.indexingEnabled !== indexingEnabled
      || result.schemaVersion !== 7
      || result.authority !== 'sqlite'
      || result.reopened !== true
      || result.duplicatePreservedIdentity !== true
      || result.literalTextPreserved !== true
      || result.sourceCreatedAtPreserved !== true
      || result.idempotentRemove !== true
    ) fail(`flag ${variant} returned an invalid result payload`);
    results.push(result);
  }
  process.stdout.write(`${JSON.stringify({ success: true, results }, null, 2)}\n`);
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

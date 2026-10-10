import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PROVENANCE_SCHEMA_VERSION } from '../electron/provenanceRepository.mjs';

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

const [inputExecutable, mode] = process.argv.slice(2);
if (!inputExecutable || (mode && mode !== '--node-runtime')) fail('usage: node scripts/runPackagedSavedPromptSmoke.mjs <exe> [--node-runtime]');
const nodeRuntimeOnly = mode === '--node-runtime';

const executablePath = path.resolve(inputExecutable);
await fs.access(executablePath);
const temporaryRoot = path.join(os.tmpdir(), `Image MetaHub prompt smoke ç ${crypto.randomUUID()}`);
await fs.mkdir(temporaryRoot, { recursive: true });

let primaryError = null;
try {
  const results = [];
  const runtimeScript = path.join(temporaryRoot, 'runtime-smoke.cjs');
  if (nodeRuntimeOnly) {
    // Exercise the actual Electron Node runtime and packaged ASAR, without claiming
    // this covers the main-process bootstrap, renderer, or visual acceptance.
    await fs.writeFile(runtimeScript, `
      const fs = require('node:fs'), path = require('node:path');
      const { pathToFileURL } = require('node:url');
      let lifecycle;
      (async () => {
        try {
          const archive = path.join(path.dirname(process.execPath), 'resources', 'app.asar');
          const { ProvenanceRepositoryLifecycle } = await import(pathToFileURL(path.join(archive, 'electron/provenanceRepository.mjs')));
          const { runSavedPromptPackagedSmoke } = await import(pathToFileURL(path.join(archive, 'electron/savedPromptPackagedSmoke.mjs')));
          const userDataPath = process.env.IMH_PROMPT_SMOKE_PROFILE;
          lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath }); lifecycle.initialize();
          const result = runSavedPromptPackagedSmoke({ userDataPath, repositoryLifecycle: lifecycle, indexingEnabled: process.env.IMH_ENABLE_PROVENANCE_INDEXING === '1' });
          fs.writeFileSync(process.env.IMH_PACKAGED_SAVED_PROMPT_SMOKE_RESULT, JSON.stringify(result));
        } catch (error) { console.error(error); process.exitCode = 1; }
        finally { lifecycle?.close(); }
      })();
    `, 'utf8');
  }
  for (const indexingEnabled of [false, true]) {
    const variant = indexingEnabled ? 'on' : 'off';
    const resultPath = path.join(temporaryRoot, `saved-prompt-${variant}.json`);
    const profilePath = path.join(temporaryRoot, `Perfil sintético flag ${variant} ç`);
    const execution = await runExecutable(
      executablePath,
      nodeRuntimeOnly ? [runtimeScript] : [`--user-data-dir=${profilePath}`, '--enable-logging=stderr'],
      {
        ...process.env,
        IMH_ENABLE_PROVENANCE_INDEXING: indexingEnabled ? '1' : '0',
        IMH_PACKAGED_SAVED_PROMPT_SMOKE: '1',
        IMH_PACKAGED_SAVED_PROMPT_SMOKE_RESULT: resultPath,
        IMH_DISABLE_GPU: '1',
        ELECTRON_ENABLE_LOGGING: 'true',
        ELECTRON_RUN_AS_NODE: nodeRuntimeOnly ? '1' : '',
        IMH_PROMPT_SMOKE_PROFILE: profilePath,
        // Bootstrap isolates Windows profile paths before importing main-process services.
        ...(process.platform === 'win32' ? { PORTABLE_EXECUTABLE_DIR: profilePath, PORTABLE_EXECUTABLE_FILE: executablePath } : {}),
      },
    );
    if (execution.code !== 0) fail(`flag ${variant} exited with ${execution.code}.\n${execution.stdout}\n${execution.stderr}`);
    const result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
    if (
      !result.success
      || result.indexingEnabled !== indexingEnabled
      || result.schemaVersion !== PROVENANCE_SCHEMA_VERSION
      || result.authority !== 'sqlite'
      || result.reopened !== true
      || result.duplicatePreservedIdentity !== true
      || result.literalTextPreserved !== true
      || result.sourceCreatedAtPreserved !== true
      || result.idempotentRemove !== true
      || result.blockSnapshotsPreserved !== true
    ) fail(`flag ${variant} returned an invalid result payload`);
    results.push(result);
  }
  process.stdout.write(`${JSON.stringify({ success: true, coverage: nodeRuntimeOnly ? 'packaged-node-runtime-and-sqlite' : 'packaged-main-process', results }, null, 2)}\n`);
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

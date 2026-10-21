import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { gunzipSync } from 'node:zlib';
import { EXR_RUNTIME_VERSION, EXR_PROTOCOL_VERSION, EXR_RUNTIME_PACKAGES } from './exrRuntimePolicy.generated.mjs';
import { EXR_DEFAULT_SETTINGS, EXR_BUILTINS, validateExrProfile, resolveExrProfile } from './exrProfiles.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const errorText = error => error instanceof Error ? error.message : String(error);
const fail = (message, code = 'EXR_ERROR') => Object.assign(new Error(message), { code });
const inside = (root, target) => { const rel = path.relative(root, target); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };

// These files are a tiny, explicitly described package, not an arbitrary archive.
// Each release asset is gzip-compressed separately; no extractor/dependency is
// loaded into the main app and there are no symlinks or archive traversal paths.
export function validateRuntimeFile(file) {
  if (!file || !/^[a-zA-Z0-9_.-]+$/.test(file.name) || file.name === '.' || file.name === '..' || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 512 * 1024 * 1024 || !Number.isSafeInteger(file.downloadSize) || file.downloadSize <= 0 || !/^[a-f0-9]{64}$/.test(file.downloadSha256)) throw fail('Invalid trusted EXR package');
  return file;
}

export function createExrRuntime({ userDataPath, cacheRoot, isPathAllowed, changed = () => {}, fetchImpl = fetch, spawnImpl = spawn, platform = `${process.platform}-${process.arch}`, packages = EXR_RUNTIME_PACKAGES }) {
  const root = path.join(userDataPath, 'components', 'exr-ocio');
  const versionRoot = path.join(root, EXR_RUNTIME_VERSION);
  const settingsPath = path.join(userDataPath, 'exr-settings.json');
  const policy = packages[platform];
  let settings;
  let settingsLoading;
  let child;
  let starting;
  let active;
  let pumping = false;
  let installController;
  let idleTimer;
  let counter = 0;
  let generation = 0;
  let configBusy = Promise.resolve();
  const configs = new Set();
  const queue = [];
  const pending = new Map();
  const previewFiles = new Map();
  const dependencyWatches = new Set();
  const cancelledOwners = new Set();
  let progress;

  async function getSettings() {
    if (settings) return structuredClone(settings);
    if (!settingsLoading) settingsLoading = (async () => {
      let stored;
      try { stored = JSON.parse(await fs.readFile(settingsPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      settings = stored ? { enabled: stored.enabled === true, global: validateExrProfile(stored.global), folders: stored.folders ?? {}, revision: Number.isSafeInteger(stored.revision) ? stored.revision : 0 } : structuredClone(EXR_DEFAULT_SETTINGS);
      for (const profile of Object.values(settings.folders)) validateExrProfile(profile);
      return settings;
    })().finally(() => { settingsLoading = null; });
    await settingsLoading;
    return structuredClone(settings);
  }
  async function installed() {
    if (!policy) return false;
    try { return (await fs.readFile(path.join(versionRoot, 'verified.json'), 'utf8')) === JSON.stringify(policy); } catch { return false; }
  }
  async function status() {
    const saved = await getSettings();
    return { installed: await installed(), enabled: saved.enabled, available: Boolean(policy), version: EXR_RUNTIME_VERSION, platform, downloadBytes: policy?.files.reduce((sum, f) => sum + f.downloadSize, 0) ?? 0, ...progress };
  }
  function stop(reason = 'EXR processing cancelled') {
    generation++;
    clearTimeout(idleTimer);
    const process = child; child = null;
    process?.kill();
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(fail(reason, 'CANCELLED')); }
    pending.clear();
  }
  function clearDependencyWatches() {
    for (const file of dependencyWatches) fsSync.unwatchFile(file);
    dependencyWatches.clear();
  }
  function cancel(owner, requestId) {
    const key = `${owner}:${requestId}`;
    cancelledOwners.add(key);
    if (cancelledOwners.size > 2048) cancelledOwners.delete(cancelledOwners.values().next().value);
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].key === key) queue.splice(i, 1)[0].reject(fail('Cancelled', 'CANCELLED'));
    if (active?.key === key) stop();
  }
  async function verifyFiles(base) {
    for (const file of policy.files) {
      validateRuntimeFile(file);
      const bytes = await fs.readFile(path.join(base, file.name));
      if (bytes.length !== file.size || hash(bytes) !== file.sha256) throw fail('EXR component integrity check failed', 'INTEGRITY');
    }
  }
  function call(process, command, timeout = 60000) {
    const id = String(++counter);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(fail('EXR processing timed out', 'TIMEOUT')); stop(); }, timeout);
      pending.set(id, { resolve, reject, timer, process });
      process.stdin.write(`${JSON.stringify({ ...command, id })}\n`, error => {
        if (error) { const entry = pending.get(id); pending.delete(id); clearTimeout(timer); entry?.reject(error); }
      });
    });
  }
  function launch(base) {
    const executable = path.join(base, policy.executable);
    const process = spawnImpl(executable, [], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: base, env: { ...globalThis.process.env, OCIO: '', OIIO_LIBRARY_PATH: '', OIIO_OPTIONS: 'threads=2' } });
    const lines = createInterface({ input: process.stdout });
    lines.on('line', line => {
      if (line.length > 8 * 1024 * 1024) { process.kill(); return; }
      try {
        const response = JSON.parse(line);
        const entry = pending.get(response.id);
        if (!entry) return;
        pending.delete(response.id); clearTimeout(entry.timer);
        response.success ? entry.resolve(response.value) : entry.reject(fail(response.error || 'EXR processing failed', response.code));
      } catch { process.kill(); }
    });
    process.stderr.on('data', () => {});
    const closed = error => {
      if (child === process) child = null;
      for (const [id, entry] of pending) if (entry.process === process) { clearTimeout(entry.timer); entry.reject(fail(errorText(error || 'EXR helper exited'), 'RUNTIME_EXIT')); pending.delete(id); }
    };
    process.on('error', closed); process.on('exit', () => closed());
    return process;
  }
  async function start() {
    clearTimeout(idleTimer);
    if (child) return child;
    if (starting) return starting;
    const epoch = generation;
    starting = (async () => {
      if (!(await getSettings()).enabled || !await installed()) throw fail('EXR support not installed or disabled', 'UNAVAILABLE');
      await verifyFiles(versionRoot);
      if (epoch !== generation) throw fail('Cancelled', 'CANCELLED');
      child = launch(versionRoot);
      const hello = await call(child, { op: 'hello' }, 15000);
      if (hello.protocol !== EXR_PROTOCOL_VERSION) { stop(); throw fail('Incompatible EXR component'); }
      return child;
    })().finally(() => { starting = null; });
    return starting;
  }
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        queue.sort((a, b) => a.priority - b.priority);
        active = queue.shift();
        try {
          const value = await call(await start(), active.command);
          if (cancelledOwners.delete(active.key)) active.reject(fail('Cancelled', 'CANCELLED')); else active.resolve(value);
        } catch (error) { cancelledOwners.delete(active.key); active.reject(error); }
        active = null;
      }
    } finally {
      pumping = false;
      idleTimer = setTimeout(() => stop('EXR runtime idle'), 30000); idleTimer.unref?.();
    }
  }
  function job(command, owner = 0, requestId = crypto.randomUUID(), priority = 1) {
    if (cancelledOwners.delete(`${owner}:${requestId}`)) return Promise.reject(fail('Cancelled', 'CANCELLED'));
    return new Promise((resolve, reject) => { queue.push({ command, key: `${owner}:${requestId}`, priority, resolve, reject }); void pump(); });
  }
  async function assertFile(filePath) {
    if (typeof filePath !== 'string' || path.extname(filePath).toLowerCase() !== '.exr') throw fail('Invalid EXR path');
    const real = await fs.realpath(filePath);
    if (!isPathAllowed(real)) throw fail('EXR path is outside authorized directories', 'ACCESS_DENIED');
    return real;
  }
  async function config(configId) {
    if (typeof configId !== 'string') throw fail('Invalid OCIO configuration');
    if (!EXR_BUILTINS.has(configId) && !configs.has(configId)) {
      const saved = await getSettings();
      const approved = [saved.global, ...Object.values(saved.folders)].some(p => p.config === configId);
      if (!approved) throw fail('Select this OCIO configuration through the file dialog first', 'ACCESS_DENIED');
    }
    const result = await job({ op: 'config', config: configId });
    for (const dependency of result.dependencies ?? []) {
      if (typeof dependency !== 'string' || !path.isAbsolute(dependency) || dependencyWatches.has(dependency)) continue;
      dependencyWatches.add(dependency);
      fsSync.watchFile(dependency, { persistent: false, interval: 2000 }, (current, previous) => {
        if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size || current.ino !== previous.ino) {
          stop('OCIO configuration changed'); previewFiles.clear(); changed();
        }
      });
    }
    return result;
  }
  async function saveSettings(incoming) {
    const saved = await getSettings();
    const global = validateExrProfile(incoming.global);
    const folders = {};
    for (const [folder, value] of Object.entries(incoming.folders ?? {})) {
      if (!path.isAbsolute(folder) || !isPathAllowed(folder)) throw fail('Folder is outside authorized directories');
      folders[path.resolve(folder)] = validateExrProfile(value);
    }
    for (const profile of [global, ...Object.values(folders)]) if (!EXR_BUILTINS.has(profile.config) && !configs.has(profile.config) && ![saved.global, ...Object.values(saved.folders)].some(p => p.config === profile.config)) throw fail('Unapproved OCIO configuration');
    settings = { enabled: incoming.enabled === true, global, folders, revision: saved.revision + 1 };
    try {
      await fs.mkdir(userDataPath, { recursive: true });
      await fs.writeFile(`${settingsPath}.part`, JSON.stringify(settings)); await fs.rename(`${settingsPath}.part`, settingsPath);
    } catch (error) { settings = saved; throw error; }
    stop('EXR settings changed');
    clearDependencyWatches();
    for (const entry of queue.splice(0)) entry.reject(fail('EXR settings changed', 'CANCELLED'));
    previewFiles.clear(); changed();
    return structuredClone(settings);
  }
  async function install() {
    if (!policy) throw fail('EXR runtime has not been published for this platform', 'UNAVAILABLE');
    if (installController) throw fail('EXR installation already running');
    installController = new AbortController();
    const signal = installController.signal;
    const staging = path.join(root, `.staging-${crypto.randomUUID()}`);
    try {
      await fs.mkdir(staging, { recursive: true });
      let receivedBytes = 0;
      for (const file of policy.files) {
        validateRuntimeFile(file);
        const url = new URL(file.url);
        if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.toLowerCase().startsWith('/luqp2/image-metahub/releases/download/')) throw fail('Invalid trusted EXR origin');
        progress = { phase: 'downloading', receivedBytes }; changed(await status());
        const response = await fetchImpl(url, { signal });
        if (!response.ok) throw fail(`EXR download failed: HTTP ${response.status}`);
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length; receivedBytes += chunk.length;
          if (size > file.downloadSize) throw fail('EXR download exceeds trusted size');
          chunks.push(chunk); progress = { phase: 'downloading', receivedBytes }; changed(await status());
        }
        const compressed = Buffer.concat(chunks);
        if (size !== file.downloadSize || hash(compressed) !== file.downloadSha256) throw fail('EXR download integrity check failed', 'INTEGRITY');
        signal.throwIfAborted();
        progress = { phase: 'verifying', receivedBytes }; changed(await status());
        const bytes = gunzipSync(compressed, { maxOutputLength: file.size });
        if (bytes.length !== file.size || hash(bytes) !== file.sha256) throw fail('EXR component integrity check failed', 'INTEGRITY');
        await fs.writeFile(path.join(staging, file.name), bytes, { mode: file.name === policy.executable ? 0o755 : 0o644 });
      }
      signal.throwIfAborted(); progress = { phase: 'installing', receivedBytes }; changed(await status());
      stop();
      const test = launch(staging);
      try {
        const result = await call(test, { op: 'self-test' }, 30000);
        if (result.protocol !== EXR_PROTOCOL_VERSION || result.ok !== true) throw fail('EXR runtime self-test failed');
      } finally { test.kill(); }
      signal.throwIfAborted();
      await fs.writeFile(path.join(staging, 'verified.json'), JSON.stringify(policy));
      const backup = `${versionRoot}.previous`;
      await fs.rm(backup, { recursive: true, force: true });
      let moved = false;
      try { await fs.rename(versionRoot, backup); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await fs.rename(staging, versionRoot); } catch (error) { if (moved) await fs.rename(backup, versionRoot); throw error; }
      await fs.rm(backup, { recursive: true, force: true });
      progress = { phase: 'ready', receivedBytes };
      await saveSettings({ ...await getSettings(), enabled: true });
      return status();
    } catch (error) { progress = signal.aborted ? undefined : { phase: 'error', error: errorText(error) }; changed(await status()); throw error; }
    finally { installController = null; await fs.rm(staging, { recursive: true, force: true }); }
  }
  async function inspect(filePath) {
    const real = await assertFile(filePath);
    return { ...await job({ op: 'inspect', filePath: real }), profile: resolveExrProfile(real, await getSettings()) };
  }
  async function preview(request, owner = 0) {
    const requestKey = `${owner}:${request.requestId}`;
    if (cancelledOwners.delete(requestKey)) throw fail('Cancelled', 'CANCELLED');
    const filePath = await assertFile(request.filePath);
    const saved = await getSettings();
    if (!saved.enabled || !await installed()) throw fail('EXR support not installed or disabled', 'UNAVAILABLE');
    const profile = validateExrProfile(request.profile ?? resolveExrProfile(filePath, saved));
    // Serialize config dependency checks: the native helper reports a content hash
    // of the config and resolved LUTs, not just the config's path or mtime.
    const explicitData = ['scalar', 'normal', 'id'].includes(request.mode) || (request.mode !== 'color' && request.channels?.length === 1);
    const info = explicitData ? { fingerprint: 'diagnostic-data' } : await config(profile.config);
    if (cancelledOwners.delete(requestKey)) throw fail('Cancelled', 'CANCELLED');
    const stat = await fs.stat(filePath);
    const isThumb = request.purpose === 'thumbnail';
    const maxEdge = isThumb ? 320 : Math.max(64, Math.min(4096, Number(request.maxEdge) || 2048));
    const exposure = isThumb ? 0 : Number(request.exposure ?? 0);
    if (!Number.isFinite(exposure) || Math.abs(exposure) > 10) throw fail('Invalid exposure');
    const part = request.part;
    if (part !== undefined && (!Number.isInteger(part) || part < 0)) throw fail('Invalid EXR part');
    const channels = request.channels;
    if (channels !== undefined && (!Array.isArray(channels) || channels.length < 1 || channels.length > 4 || channels.some(c => typeof c !== 'string' || c.length > 512))) throw fail('Invalid EXR channels');
    const mode = request.mode ?? 'auto';
    if (!['auto', 'color', 'scalar', 'normal', 'id'].includes(mode)) throw fail('Invalid EXR visualization mode');
    if (request.range && (!Array.isArray(request.range) || request.range.length !== 2 || !request.range.every(Number.isFinite) || request.range[0] >= request.range[1])) throw fail('Invalid scalar range');
    if (request.region && ['x','y','width','height'].some(k => !Number.isSafeInteger(request.region[k]) || (['width','height'].includes(k) && request.region[k] <= 0))) throw fail('Invalid EXR region');
    const command = { op: 'render', filePath, profile, part, channels, mode, exposure, maxEdge, range: request.range, region: request.region };
    const key = hash(JSON.stringify({ command, modified: stat.mtimeMs, size: stat.size, config: info.fingerprint, version: EXR_RUNTIME_VERSION }));
    const cache = path.join(await cacheRoot(), isThumb ? 'exr-thumbnails' : 'exr-previews');
    await fs.mkdir(cache, { recursive: true });
    const output = path.join(cache, `${key}.png`);
    const side = `${output}.info`;
    let result;
    try { result = JSON.parse(await fs.readFile(side, 'utf8')); await fs.access(output); }
    catch {
      const temp = `${output}.${crypto.randomUUID()}.part`;
      try {
        result = await job({ ...command, output: temp }, owner, request.requestId, isThumb ? 2 : 0);
        await fs.rename(temp, output); await fs.writeFile(side, JSON.stringify(result));
      } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    }
    previewFiles.set(key, output);
    if (!isThumb) {
      const entries = await fs.readdir(cache, { withFileTypes: true });
      const files = await Promise.all(entries.filter(e => e.name.endsWith('.png')).map(async e => ({ file: path.join(cache, e.name), stat: await fs.stat(path.join(cache, e.name)).catch(() => null) })));
      files.sort((a,b) => (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0));
      for (const old of files.slice(24)) { if (old.file !== output) { await fs.rm(old.file, { force: true }); await fs.rm(`${old.file}.info`, { force: true }); } }
    }
    return { ...result, url: `imh-exr://local/${key}` };
  }
  return {
    status, install, settings: getSettings, inspect, preview, config, cancel,
    saveSettings: incoming => { const work = configBusy.then(() => saveSettings(incoming)); configBusy = work.catch(() => {}); return work; },
    authorizeConfig: configId => { configs.add(configId); },
    async resolvePreview(url) {
      const key = new URL(url).pathname.slice(1);
      if (!/^[a-f0-9]{64}$/.test(key)) throw fail('Invalid EXR preview URL');
      const file = previewFiles.get(key);
      if (!file) throw fail('Unknown EXR preview');
      const real = await fs.realpath(file);
      if (!inside(await cacheRoot(), real)) throw fail('Invalid EXR preview path');
      return real;
    },
    cancelInstall: () => { installController?.abort(); return null; },
    async remove() {
      if (installController) throw fail('Cancel installation before removing EXR support');
      await saveSettings({ ...await getSettings(), enabled: false });
      await fs.rm(versionRoot, { recursive: true, force: true }); progress = undefined; changed(); return null;
    },
    dispose: () => { installController?.abort(); clearDependencyWatches(); stop(); for (const entry of queue.splice(0)) entry.reject(fail('Cancelled', 'CANCELLED')); },
  };
}

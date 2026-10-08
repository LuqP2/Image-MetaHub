import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { isModelLibraryPathWithinRoots, normalizeModelLibraryPath } from './modelLibrarySecurity.mjs';

const fingerprint = (stats) => ({ size: stats.size, modifiedAt: stats.mtimeMs, dev: String(stats.dev), ino: String(stats.ino) });
const sameFingerprint = (a, b) => ['size', 'modifiedAt', 'dev', 'ino'].every((key) => a[key] === b[key]);
const physicalId = (stats) => stats.ino ? `${stats.dev}:${stats.ino}` : undefined;
const validHash = (value) => typeof value === 'string' && /^[a-f\d]{64}$/i.test(value) ? value.toLowerCase() : undefined;

/** Main-process authority. Renderer supplies catalog IDs, never deletion paths. */
export function createModelStorageController({ getState, getRoots, trashItem, confirm, onRemoved, isBusy = () => false, filesystem = fs, platform = process.platform, now = Date.now }) {
  const paths = platform === 'win32' ? path.win32 : path;
  const normalize = (value) => normalizeModelLibraryPath(value, platform);
  const plans = new Map();
  const canonicalPaths = new Map();
  let activeJobs = 0;
  let removing = false;
  const signature = () => JSON.stringify({ roots: [...getRoots()].map(normalize).sort(), sources: getState()?.sources?.map(({ id, path }) => [id, normalize(path)]), locations: getState()?.catalog?.locations?.map(({ id, sourceId, absolutePath, size, modifiedAt, sha256 }) => [id, sourceId, normalize(absolutePath), size, modifiedAt, sha256]) });
  const assertIdle = () => {
    const progress = getState()?.progress;
    if (removing || activeJobs || isBusy() || (progress && progress.kind !== 'removal')) throw new Error('Wait for the current model job to finish before removing files.');
  };
  async function runJob(callback) {
    if (removing) throw new Error('Model file removal is in progress.');
    activeJobs++;
    try { return await callback(); } finally { activeJobs--; }
  }
  async function noLinks(absolutePath) {
    let current = paths.parse(absolutePath).root;
    for (const part of paths.relative(current, absolutePath).split(paths.sep).filter(Boolean)) {
      current = paths.join(current, part);
      if ((await filesystem.lstat(current)).isSymbolicLink()) throw new Error('Symbolic links and junctions cannot be removed from Models.');
    }
  }
  async function inspect(location) {
    const source = getState()?.sources?.find((entry) => entry.id === location.sourceId);
    if (!source || ![...getRoots()].some((root) => normalize(root) === normalize(source.path))) throw new Error('This source is no longer authorized.');
    const absolutePath = paths.resolve(location.absolutePath);
    const rootPath = paths.resolve(source.path);
    if (paths.extname(absolutePath).toLowerCase() !== '.safetensors' || !isModelLibraryPathWithinRoots(absolutePath, [rootPath], platform) || normalize(absolutePath) === normalize(rootPath)) throw new Error('This file is outside its authorized model source.');
    await noLinks(absolutePath);
    const root = await filesystem.realpath(rootPath);
    const realPath = await filesystem.realpath(absolutePath);
    if (!isModelLibraryPathWithinRoots(realPath, [root], platform)) throw new Error('The model path escapes its authorized source.');
    const stats = await filesystem.lstat(realPath);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('This location is not a regular model file.');
    return { path: realPath, key: normalize(realPath), fingerprint: fingerprint(stats), physicalId: physicalId(stats), linkCount: stats.nlink, root: normalize(root) };
  }
  async function overview() {
    return runJob(async () => {
      const state = getState();
      const stamp = signature();
      const byId = new Map((state?.catalog?.locations ?? []).map((location) => [location.id, location]));
      const grouped = new Map();
      for (const location of state?.catalog?.locations ?? []) {
        const key = normalize(location.absolutePath);
        const entry = grouped.get(key) ?? { key, path: location.absolutePath, locationIds: [], size: location.size, modifiedAt: location.modifiedAt, stale: false };
        entry.sha256 ??= validHash(location.sha256);
        entry.locationIds.push(location.id);
        grouped.set(key, entry);
      }
      for (const file of grouped.values()) {
        try {
          const location = byId.get(file.locationIds[0]);
          const inspected = await inspect(location);
          Object.assign(file, { key: inspected.key, path: inspected.path, physicalId: inspected.physicalId, linkCount: inspected.linkCount });
          for (const id of file.locationIds) canonicalPaths.set(id, { key: inspected.key, stamp });
          file.stale = inspected.fingerprint.size !== file.size || inspected.fingerprint.modifiedAt !== file.modifiedAt;
          if (file.stale) file.sha256 = undefined;
        } catch (error) { file.stale = true; file.error = error.message; file.sha256 = undefined; }
      }
      const sources = [];
      for (const source of state?.sources ?? []) {
        try {
          const stats = await filesystem.statfs(source.path);
          sources.push({ sourceId: source.id, totalBytes: Number(stats.blocks) * Number(stats.bsize), availableBytes: Number(stats.bavail) * Number(stats.bsize) });
        } catch (error) { sources.push({ sourceId: source.id, error: error.message }); }
      }
      const canonical = new Map();
      for (const file of grouped.values()) {
        const existing = canonical.get(file.key);
        if (existing) { existing.locationIds.push(...file.locationIds); existing.sha256 ??= file.sha256; existing.stale ||= file.stale; }
        else canonical.set(file.key, file);
      }
      return { files: [...canonical.values()], sources, checkedAt: now() };
    });
  }
  async function prepare({ locationIds } = {}) {
    assertIdle();
    return runJob(async () => {
      if (!Array.isArray(locationIds) || !locationIds.length || locationIds.some((id) => typeof id !== 'string')) throw new Error('Choose at least one catalog file.');
      const stamp = signature();
      const state = getState();
      const byId = new Map(state?.catalog?.locations?.map((entry) => [entry.id, entry]) ?? []);
      const aliasesByPath = new Map();
      for (const location of byId.values()) {
        const key = normalize(location.absolutePath);
        const aliases = aliasesByPath.get(key) ?? [];
        aliases.push(location); aliasesByPath.set(key, aliases);
      }
      const files = new Map();
      for (const id of new Set(locationIds)) {
        const location = byId.get(id);
        if (!location) throw new Error('Unknown model catalog location.');
        if (files.has(normalize(location.absolutePath))) continue;
        const inspected = await inspect(location);
        if (inspected.fingerprint.size !== location.size || inspected.fingerprint.modifiedAt !== location.modifiedAt) throw new Error('A selected file changed. Refresh the file list before removing it.');
        const aliases = [...aliasesByPath.get(normalize(location.absolutePath))];
        for (const alias of byId.values()) {
          const cached = canonicalPaths.get(alias.id);
          if (cached?.stamp === stamp && cached.key === inspected.key && !aliases.some((entry) => entry.id === alias.id)) {
            try { if ((await inspect(alias)).key === inspected.key) aliases.push(alias); } catch { /* A changed alias is not part of this physical path. */ }
          }
        }
        files.set(inspected.key, { ...inspected, sha256: aliases.map((entry) => validHash(entry.sha256)).find(Boolean), locationIds: aliases.map((entry) => entry.id) });
      }
      if (stamp !== signature()) throw new Error('The catalog changed. Prepare removal again.');
      const selected = new Set(files.keys());
      const physical = new Map();
      for (const file of files.values()) physical.set(file.physicalId ?? file.key, file.fingerprint.size);
      const remainingCopies = [];
      for (const file of files.values()) {
        const remaining = new Set();
        for (const location of byId.values()) {
          const key = normalize(location.absolutePath);
          if (selected.has(key)) continue;
          const sameHash = file.sha256 && validHash(location.sha256) === file.sha256;
          if (sameHash || file.linkCount > 1 && location.size === file.fingerprint.size) {
            try {
              const current = await inspect(location);
              if (selected.has(current.key)) continue;
              if (current.fingerprint.size === location.size && current.fingerprint.modifiedAt === location.modifiedAt && (sameHash || current.physicalId === file.physicalId)) remaining.add(current.key);
            } catch { /* An unavailable copy is not a surviving physical file. */ }
          }
        }
        remainingCopies.push({ path: file.path, count: remaining.size });
      }
      const planId = crypto.randomUUID();
      const plan = { planId, expiresAt: now() + 5 * 60_000, files: [...files.values()], totalBytes: [...physical.values()].reduce((sum, size) => sum + size, 0), remainingCopies, signature: stamp };
      for (const [id, prior] of plans) if (prior.expiresAt <= now()) plans.delete(id);
      plans.set(planId, plan);
      return { planId, expiresAt: plan.expiresAt, files: plan.files.map(({ path, locationIds, fingerprint }) => ({ path, locationIds, size: fingerprint.size })), totalBytes: plan.totalBytes, remainingCopies };
    });
  }
  async function execute({ planId } = {}) {
    assertIdle();
    const plan = plans.get(planId);
    plans.delete(planId);
    if (!plan || plan.expiresAt <= now() || plan.signature !== signature()) throw new Error('This removal plan expired or the catalog changed. Prepare removal again.');
    removing = true;
    const removedLocationIds = [];
    const failures = [];
    try {
      if (!await confirm(plan)) return { removedLocationIds, failures, cancelled: true };
      if (plan.expiresAt <= now() || plan.signature !== signature()) throw new Error('The catalog changed while confirming removal. Prepare removal again.');
      for (const file of plan.files) {
        try {
          const location = getState().catalog.locations.find((entry) => entry.id === file.locationIds[0]);
          if (!location) throw new Error('This catalog location no longer exists.');
          const current = await inspect(location);
          if (current.key !== file.key || current.root !== file.root || !sameFingerprint(current.fingerprint, file.fingerprint)) throw new Error('This file changed after removal was prepared.');
          await trashItem(file.path);
          removedLocationIds.push(...file.locationIds);
          await onRemoved(file.locationIds);
        } catch (error) { failures.push({ path: file.path, locationIds: file.locationIds, error: error.message }); }
      }
      return { removedLocationIds, failures };
    } finally { removing = false; }
  }
  return { overview, prepare, execute, runJob, isRemoving: () => removing, invalidate: () => { plans.clear(); canonicalPaths.clear(); } };
}

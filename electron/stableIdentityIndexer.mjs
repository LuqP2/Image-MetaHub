import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeRelativeCatalogPath } from '../utils/provenancePath.mjs';

export { normalizeRelativeCatalogPath } from '../utils/provenancePath.mjs';

const DEFAULT_BATCH_SIZE = 128;

export function normalizeLibraryRootPath(rootPath, platform = process.platform) {
  if (typeof rootPath !== 'string' || !rootPath.trim()) throw new Error('Library root path is required.');
  const absolutePath = path.resolve(rootPath);
  const parsed = path.parse(absolutePath);
  const displayPath = absolutePath === parsed.root ? absolutePath : absolutePath.replace(/[\\/]+$/, '');
  return {
    absolutePath: displayPath,
    pathKey: platform === 'win32' ? displayPath.toLocaleLowerCase('en-US') : displayPath,
  };
}

function normalizedTimestamp(value) {
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

function sameFileSignature(stat, expected) {
  return stat.isFile()
    && stat.size === expected.byteSize
    && normalizedTimestamp(stat.mtimeMs) === expected.contentModifiedMs;
}

async function sha256File(filePath, { createReadStream = fs.createReadStream, signal } = {}) {
  const hash = crypto.createHash('sha256');
  const stream = createReadStream(filePath, { signal });
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

export class StableIdentityIndexer {
  constructor({
    repositoryLifecycle,
    enabled = false,
    platform = process.platform,
    batchSize = DEFAULT_BATCH_SIZE,
    stat = fs.promises.stat,
    createReadStream = fs.createReadStream,
    logger = console,
  }) {
    this.repositoryLifecycle = repositoryLifecycle;
    this.enabled = enabled;
    this.platform = platform;
    this.batchSize = Math.max(1, Math.trunc(batchSize));
    this.stat = stat;
    this.createReadStream = createReadStream;
    this.logger = logger;
    this.paused = false;
    this.pauseWaiters = [];
    this.stopped = false;
    this.hashQueue = [];
    this.queuedRevisionIds = new Set();
    this.hashDrainPromise = null;
    this.abortController = new AbortController();
    this.scanGenerationByRootKey = new Map();
  }

  pause() {
    this.paused = true;
    return { paused: true };
  }

  resume() {
    this.paused = false;
    for (const resolve of this.pauseWaiters.splice(0)) resolve();
    void this.#drainHashes();
    return { paused: false };
  }

  stop() {
    this.stopped = true;
    this.abortController.abort();
    this.resume();
    this.hashQueue.length = 0;
    this.queuedRevisionIds.clear();
  }

  async indexScan({ rootPath, scanPath = rootPath, files, scanComplete, recursive, onBatch = () => {} }) {
    if (!this.enabled || this.stopped) return { enabled: false, assigned: 0, reconciled: false };
    const root = normalizeLibraryRootPath(rootPath, this.platform);
    const normalizedScan = normalizeLibraryRootPath(scanPath, this.platform);
    const scanGeneration = (this.scanGenerationByRootKey.get(root.pathKey) ?? 0) + 1;
    this.scanGenerationByRootKey.set(root.pathKey, scanGeneration);
    const isLatestGeneration = () => this.scanGenerationByRootKey.get(root.pathKey) === scanGeneration;
    const isCurrentScan = () => !this.stopped && isLatestGeneration();
    const rootRecord = this.repositoryLifecycle.run((repository) => repository.ensureLibraryRoot(root));
    const seenPathKeys = new Set();
    let assigned = 0;

    for (let offset = 0; offset < files.length; offset += this.batchSize) {
      await this.#waitWhilePaused();
      if (this.stopped) {
        return { enabled: true, assigned, reconciled: false, cancelled: true, rootId: rootRecord.rootId };
      }
      if (!isLatestGeneration()) {
        return { enabled: true, assigned, reconciled: false, stale: true, rootId: rootRecord.rootId };
      }
      const mappings = [];
      for (const file of files.slice(offset, offset + this.batchSize)) {
        const absoluteFilePath = path.resolve(normalizedScan.absolutePath, ...String(file.name).replace(/\\/g, '/').split('/'));
        const rootRelativePath = path.relative(root.absolutePath, absoluteFilePath).replace(/\\/g, '/');
        const normalizedPath = normalizeRelativeCatalogPath(rootRelativePath, this.platform);
        const contentModifiedMs = normalizedTimestamp(file.contentModifiedMs ?? file.lastModified);
        const identity = this.repositoryLifecycle.run((repository) => repository.assignIndexedFile({
          rootId: rootRecord.rootId,
          ...normalizedPath,
          byteSize: Number(file.size),
          mimeType: file.type ?? null,
          contentModifiedMs,
        }));
        seenPathKeys.add(normalizedPath.relativePathKey);
        const mapping = { ...normalizedPath, ...identity };
        mappings.push(mapping);
        assigned += 1;
        if (identity.needsHash) {
          this.#enqueueHash({
            revisionId: identity.revisionId,
            filePath: absoluteFilePath,
            byteSize: Number(file.size),
            contentModifiedMs,
          });
        }
      }
      onBatch({ rootId: rootRecord.rootId, rootPath: root.absolutePath, mappings });
      await new Promise((resolve) => setImmediate(resolve));
    }

    const canReconcile = Boolean(
      scanComplete
      && recursive
      && normalizedScan.pathKey === root.pathKey
      && isCurrentScan()
    );
    if (canReconcile) {
      this.repositoryLifecycle.run((repository) => repository.reconcileRootLocations(rootRecord.rootId, seenPathKeys));
    }
    void this.#drainHashes();
    return {
      enabled: true,
      assigned,
      reconciled: canReconcile,
      stale: !isLatestGeneration(),
      rootId: rootRecord.rootId,
    };
  }

  async waitForIdle() {
    await this.hashDrainPromise;
  }

  #enqueueHash(task) {
    if (this.queuedRevisionIds.has(task.revisionId)) return;
    this.queuedRevisionIds.add(task.revisionId);
    this.hashQueue.push(task);
  }

  async #waitWhilePaused() {
    if (!this.paused || this.stopped) return;
    await new Promise((resolve) => this.pauseWaiters.push(resolve));
  }

  #drainHashes() {
    if (this.hashDrainPromise || this.paused || this.stopped || this.hashQueue.length === 0) {
      return this.hashDrainPromise;
    }
    this.hashDrainPromise = (async () => {
      while (this.hashQueue.length > 0 && !this.stopped) {
        await this.#waitWhilePaused();
        if (this.stopped) break;
        const task = this.hashQueue.shift();
        try {
          const before = await this.stat(task.filePath);
          if (!sameFileSignature(before, task)) continue;
          const sha256 = await sha256File(task.filePath, {
            createReadStream: this.createReadStream,
            signal: this.abortController.signal,
          });
          const after = await this.stat(task.filePath);
          if (!sameFileSignature(after, task)) continue;
          this.repositoryLifecycle.run((repository) => repository.completeRevisionHashIfUnchanged(task.revisionId, {
            sha256,
            byteSize: task.byteSize,
            contentModifiedMs: task.contentModifiedMs,
          }));
        } catch (error) {
          if (!this.stopped) this.logger.warn('Could not hash provenance revision; it remains pending for a later scan.', error);
        } finally {
          this.queuedRevisionIds.delete(task.revisionId);
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    })().finally(() => {
      this.hashDrainPromise = null;
      if (!this.paused && !this.stopped && this.hashQueue.length > 0) void this.#drainHashes();
    });
    return this.hashDrainPromise;
  }
}

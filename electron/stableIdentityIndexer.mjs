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
    this.replacementHashTasksByRevision = new Map();
    this.hashDrainPromise = null;
    this.abortController = new AbortController();
    this.scanGenerationByRootKey = new Map();
    this.pathVersionByCatalogKey = new Map();
    this.blockedCatalogPathKeys = new Set();
  }

  beginScan(rootPath) {
    const root = normalizeLibraryRootPath(rootPath, this.platform);
    const generation = (this.scanGenerationByRootKey.get(root.pathKey) ?? 0) + 1;
    this.scanGenerationByRootKey.set(root.pathKey, generation);
    return { rootPathKey: root.pathKey, generation };
  }

  invalidateRoot(rootPath) {
    return this.beginScan(rootPath);
  }

  invalidateCatalogPath(rootPath, relativePath) {
    const catalogPathKey = this.#catalogPathKey(rootPath, relativePath);
    const version = (this.pathVersionByCatalogKey.get(catalogPathKey) ?? 0) + 1;
    this.pathVersionByCatalogKey.set(catalogPathKey, version);
    this.hashQueue = this.hashQueue.filter((task) => {
      if (task.catalogPathKey !== catalogPathKey) return true;
      this.queuedRevisionIds.delete(task.revisionId);
      this.replacementHashTasksByRevision.delete(task.revisionId);
      return false;
    });
    return version;
  }

  blockCatalogPath(rootPath, relativePath) {
    const key = this.#catalogPathKey(rootPath, relativePath);
    this.blockedCatalogPathKeys.add(key);
    this.invalidateCatalogPath(rootPath, relativePath);
  }

  unblockCatalogPath(rootPath, relativePath) {
    this.blockedCatalogPathKeys.delete(this.#catalogPathKey(rootPath, relativePath));
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
    this.replacementHashTasksByRevision.clear();
  }

  async indexScan({ rootPath, scanPath = rootPath, files, scanComplete, recursive, scanToken = null, onBatch = () => {} }) {
    if (!this.enabled || this.stopped) return { enabled: false, assigned: 0, reconciled: false };
    const root = normalizeLibraryRootPath(rootPath, this.platform);
    const normalizedScan = normalizeLibraryRootPath(scanPath, this.platform);
    const effectiveScanToken = scanToken ?? this.beginScan(rootPath);
    const scanGeneration = effectiveScanToken.generation;
    if (effectiveScanToken.rootPathKey !== root.pathKey) {
      throw new Error('Scan token does not belong to the requested provenance root.');
    }
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
      const mappings = this.#assignObservedFiles({
        root,
        rootRecord,
        scanPath: normalizedScan,
        files: files.slice(offset, offset + this.batchSize),
        requiredScanGeneration: scanGeneration,
      });
      for (const mapping of mappings) seenPathKeys.add(mapping.relativePathKey);
      assigned += mappings.length;
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

  async observeFiles({ rootPath, scanPath = rootPath, files, onBatch = () => {} }) {
    if (!this.enabled || this.stopped) return { enabled: false, assigned: 0 };
    const root = normalizeLibraryRootPath(rootPath, this.platform);
    const normalizedScan = normalizeLibraryRootPath(scanPath, this.platform);
    const rootRecord = this.repositoryLifecycle.run((repository) => repository.ensureLibraryRoot(root));
    const mappings = this.#assignObservedFiles({ root, rootRecord, scanPath: normalizedScan, files });
    if (mappings.length > 0) onBatch({ rootId: rootRecord.rootId, rootPath: root.absolutePath, mappings });
    void this.#drainHashes();
    return { enabled: true, assigned: mappings.length, rootId: rootRecord.rootId, mappings };
  }

  markExternalMissing({ rootPath, relativePath }) {
    if (!this.enabled || this.stopped) return null;
    const root = normalizeLibraryRootPath(rootPath, this.platform);
    const normalizedPath = normalizeRelativeCatalogPath(relativePath, this.platform);
    const catalogPathKey = `${root.pathKey}\0${normalizedPath.relativePathKey}`;
    if (this.blockedCatalogPathKeys.has(catalogPathKey)) return null;
    this.invalidateCatalogPath(rootPath, relativePath);
    const rootRecord = this.repositoryLifecycle.run((repository) => repository.ensureLibraryRoot(root));
    return this.repositoryLifecycle.run((repository) => (
      repository.markLocationMissingByRootPath(rootRecord.rootId, normalizedPath.relativePathKey)
    ));
  }

  async waitForIdle() {
    await this.hashDrainPromise;
  }

  #enqueueHash(task) {
    if (this.queuedRevisionIds.has(task.revisionId)) {
      this.replacementHashTasksByRevision.set(task.revisionId, task);
      return;
    }
    this.queuedRevisionIds.add(task.revisionId);
    this.hashQueue.push(task);
  }

  #catalogPathKey(rootPath, relativePath) {
    const root = normalizeLibraryRootPath(rootPath, this.platform);
    const normalizedPath = normalizeRelativeCatalogPath(relativePath, this.platform);
    return `${root.pathKey}\0${normalizedPath.relativePathKey}`;
  }

  #assignObservedFiles({ root, rootRecord, scanPath, files, requiredScanGeneration = null }) {
    const mappings = [];
    for (const file of files) {
      if (
        requiredScanGeneration !== null
        && this.scanGenerationByRootKey.get(root.pathKey) !== requiredScanGeneration
      ) break;
      const absoluteFilePath = path.resolve(scanPath.absolutePath, ...String(file.name).replace(/\\/g, '/').split('/'));
      const rootRelativePath = path.relative(root.absolutePath, absoluteFilePath).replace(/\\/g, '/');
      const normalizedPath = normalizeRelativeCatalogPath(rootRelativePath, this.platform);
      const catalogPathKey = `${root.pathKey}\0${normalizedPath.relativePathKey}`;
      if (this.blockedCatalogPathKeys.has(catalogPathKey)) continue;
      const pathVersion = this.pathVersionByCatalogKey.get(catalogPathKey) ?? 0;
      const contentModifiedMs = normalizedTimestamp(file.contentModifiedMs ?? file.lastModified);
      const identity = this.repositoryLifecycle.run((repository) => repository.assignIndexedFile({
        rootId: rootRecord.rootId,
        ...normalizedPath,
        byteSize: Number(file.size),
        mimeType: file.type ?? null,
        contentModifiedMs,
      }));
      if ((this.pathVersionByCatalogKey.get(catalogPathKey) ?? 0) !== pathVersion) continue;
      const mapping = { ...normalizedPath, ...identity, observationVersion: pathVersion };
      mappings.push(mapping);
      if (identity.needsHash) {
        this.#enqueueHash({
          revisionId: identity.revisionId,
          filePath: absoluteFilePath,
          byteSize: Number(file.size),
          contentModifiedMs,
          catalogPathKey,
          pathVersion,
        });
      }
    }
    return mappings;
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
          if (this.blockedCatalogPathKeys.has(task.catalogPathKey)) continue;
          if ((this.pathVersionByCatalogKey.get(task.catalogPathKey) ?? 0) !== task.pathVersion) continue;
          this.repositoryLifecycle.run((repository) => repository.completeRevisionHashIfUnchanged(task.revisionId, {
            sha256,
            byteSize: task.byteSize,
            contentModifiedMs: task.contentModifiedMs,
          }));
        } catch (error) {
          const stillCurrent = (this.pathVersionByCatalogKey.get(task.catalogPathKey) ?? 0) === task.pathVersion;
          if (!this.stopped && stillCurrent && !this.blockedCatalogPathKeys.has(task.catalogPathKey)) {
            this.logger.warn('Could not hash provenance revision; it remains pending for a later scan.', error);
          }
        } finally {
          this.queuedRevisionIds.delete(task.revisionId);
          const replacement = this.replacementHashTasksByRevision.get(task.revisionId);
          if (replacement) {
            this.replacementHashTasksByRevision.delete(task.revisionId);
            this.#enqueueHash(replacement);
          }
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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeLibraryRootPath } from './stableIdentityIndexer.mjs';
import { normalizeRelativeCatalogPath } from '../utils/provenancePath.mjs';
import { isRelativePathInsideRoot, pathApiForPlatform } from '../utils/pathContainment.mjs';
import { inferMimeTypeFromName } from '../utils/mediaTypes.js';

function normalizedTimestamp(value) {
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

function signatureFromStat(stat) {
  return stat ? {
    byteSize: Number(stat.size),
    contentModifiedMs: normalizedTimestamp(stat.mtimeMs),
    device: Number.isFinite(stat.dev) ? Number(stat.dev) : null,
    inode: Number.isFinite(stat.ino) ? Number(stat.ino) : null,
  } : null;
}

export class StableIdentityFileOperationCoordinator {
  constructor({
    repositoryLifecycle,
    indexer,
    enabled = false,
    platform = process.platform,
    fileSystem = fs.promises,
    createReadStream = fs.createReadStream,
    randomUUID = () => crypto.randomUUID(),
    publishMappings = () => {},
    logger = console,
  }) {
    this.repositoryLifecycle = repositoryLifecycle;
    this.indexer = indexer;
    this.enabled = enabled;
    this.platform = platform;
    this.fileSystem = fileSystem;
    this.createReadStream = createReadStream;
    this.randomUUID = randomUUID;
    this.publishMappings = publishMappings;
    this.logger = logger;
    this.activePathLocks = new Map();
    this.recoveryBlockedPaths = new Set();
    this.deferredWatcherObservations = new Map();
  }

  async initializeRecovery() {
    if (!this.#isAvailable()) {
      return { enabled: this.enabled, available: false, recovered: 0, pending: 0 };
    }
    const operations = this.repositoryLifecycle.run((repository) => repository.listPendingFileOperations());
    for (const operation of operations) this.#blockOperationPaths(operation.payload);
    let recovered = 0;
    for (const operation of operations) {
      try {
        const result = await this.#recoverOperation(operation);
        if (result === 'completed' || result === 'aborted') recovered += 1;
      } catch (error) {
        this.logger.warn(
          `Provenance operation ${operation.operationId} could not be recovered and remains pending.`,
          error,
        );
      }
    }
    const pending = this.repositoryLifecycle.run((repository) => repository.listPendingFileOperations()).length;
    return { enabled: true, recovered, pending };
  }

  async executeKnownOperation({ kind, sourcePath = null, destinationPath = null, expectedOutputSha256 = null, perform }) {
    if (!this.enabled) {
      return { value: await perform(), provenance: { enabled: false, available: false } };
    }
    if (!this.#isAvailable()) {
      const status = this.repositoryLifecycle?.getStatus?.();
      return {
        value: await perform(),
        provenance: {
          enabled: true,
          available: false,
          error: status?.error?.message || status?.error || 'The provenance catalog is unavailable.',
        },
      };
    }
    const absolutePaths = [sourcePath, destinationPath].filter(Boolean).map((value) => path.resolve(value));
    return this.#withPathLocks(absolutePaths, async () => {
      const blockedPath = absolutePaths.find((value) => this.recoveryBlockedPaths.has(this.#absolutePathKey(value)));
      if (blockedPath) {
        throw new Error(`A pending provenance recovery blocks another operation on ${blockedPath}.`);
      }
      let sourceStat;
      try {
        sourceStat = sourcePath ? await this.#statOrNull(path.resolve(sourcePath)) : null;
      } catch (error) {
        this.logger.error('Provenance source evidence is unavailable; continuing the authorized file operation.', error);
        return {
          value: await perform(),
          provenance: { enabled: true, available: false, error: error?.message || String(error) },
        };
      }
      if (['rename', 'move'].includes(kind) && sourceStat?.isDirectory?.()) {
        return {
          value: await perform(),
          provenance: {
            enabled: true,
            available: true,
            tracked: false,
            reason: 'directory_operation_not_supported',
          },
        };
      }
      if (sourcePath && ['rename', 'move', 'delete'].includes(kind) && !sourceStat) {
        return {
          value: await perform(),
          provenance: {
            enabled: true,
            available: true,
            tracked: false,
            reason: 'source_missing_before_operation',
          },
        };
      }
      let intent;
      try {
        const destinationStat = destinationPath
          ? await this.#statOrNull(path.resolve(destinationPath))
          : null;
        const beforeEvidence = {
          sourceSignature: signatureFromStat(sourceStat),
          destinationSignature: signatureFromStat(destinationStat),
          sameFilePathAlias: await this.#isSameFilePathAlias({
            kind,
            sourcePath,
            destinationPath,
            sourceStat,
            destinationStat,
          }),
        };
        intent = this.#createIntent({ kind, sourcePath, destinationPath, expectedOutputSha256, beforeEvidence });
      } catch (error) {
        this.logger.error('Provenance intent could not be persisted; continuing the authorized file operation.', error);
        return {
          value: await perform(),
          provenance: { enabled: true, available: false, error: error?.message || String(error) },
        };
      }

      if (!intent.operationId) {
        this.#blockOperationPaths(intent.payload);
        try {
          const value = await perform();
          this.#unblockOperationPaths(intent.payload);
          try {
            await this.#observeCompletedDestination(intent.payload);
            await this.#flushDeferredForOperation(intent.payload);
          } catch (error) {
            this.logger.warn('Untracked file operation completed, but provenance observation is unavailable.', error);
          }
          return { value, provenance: { enabled: true, available: true, tracked: false } };
        } catch (error) {
          this.#unblockOperationPaths(intent.payload);
          throw error;
        }
      }

      this.#blockOperationPaths(intent.payload);
      let value;
      try {
        value = await perform();
      } catch (error) {
        try {
          const confirmsPrimaryDelete = intent.kind === 'delete' && error?.primaryDeleted === true;
          const outcome = await this.#inspectOutcome(intent, { verifyExpectedOutput: !confirmsPrimaryDelete });
          await this.#applyOperationOutcome(intent, outcome, { operationError: error });
        } catch { /* preserve the filesystem error */ }
        throw error;
      }

      const outcome = await this.#inspectOutcome(intent, { verifyExpectedOutput: false });
      const transition = await this.#applyOperationOutcome(intent, outcome);
      if (transition.state === 'completed') {
        return { value, provenance: { enabled: true, available: true, operation: transition.operation } };
      }
      return {
        value,
        provenance: {
          enabled: true,
          available: true,
          pending: transition.state === 'pending_recovery',
          error: transition.error,
        },
      };
    });
  }

  async continuePendingDelete({ operationId, sourcePath, perform }) {
    if (!operationId || !this.#isAvailable()) {
      return this.executeKnownOperation({ kind: 'delete', sourcePath, perform });
    }
    const absoluteSourcePath = path.resolve(sourcePath);
    return this.#withPathLocks([absoluteSourcePath], async () => {
      const operation = this.repositoryLifecycle.run((repository) => repository.getFileOperation(operationId));
      if (
        !operation
        || operation.kind !== 'delete'
        || !['intended', 'fs_applied', 'pending_recovery'].includes(operation.state)
        || typeof operation.payload?.sourceAbsolutePath !== 'string'
        || this.#absolutePathKey(operation.payload?.sourceAbsolutePath) !== this.#absolutePathKey(absoluteSourcePath)
      ) {
        throw new Error('The pending provenance delete does not match this permanent-delete grant.');
      }

      const value = await perform();
      const sourceStat = await this.#statOrNull(absoluteSourcePath);
      if (sourceStat) {
        return {
          value,
          provenance: { enabled: true, available: true, pending: true, operationId },
        };
      }

      let completed;
      try {
        this.repositoryLifecycle.run((repository) => repository.markFileOperationFileSystemApplied(operationId));
        completed = this.repositoryLifecycle.run((repository) => repository.completeFileOperation(operationId));
      } catch (error) {
        try {
          this.repositoryLifecycle.run((repository) => repository.markFileOperationPending(operationId, error));
        } catch { /* the durable intent is already enough for startup recovery */ }
        this.logger.error('Permanent deletion completed but provenance reconciliation remains pending.', error);
        return {
          value,
          provenance: {
            enabled: true,
            available: true,
            pending: true,
            operationId,
            error: error?.message || String(error),
          },
        };
      }

      this.#unblockOperationPaths(operation.payload);
      try {
        await this.#flushDeferredForOperation(operation.payload);
      } catch (error) {
        this.logger.warn('Completed permanent deletion could not flush deferred observations.', error);
      }
      return { value, provenance: { enabled: true, available: true, operation: completed } };
    });
  }

  async observeWatcherFiles({ rootPath, files, bytesChanged = true }) {
    if (!this.#isAvailable() || !Array.isArray(files) || files.length === 0) return;
    const ready = [];
    for (const file of files) {
      const relativePath = file.relativePath || file.name;
      const key = this.#absolutePathKey(path.resolve(rootPath, relativePath));
      if (this.activePathLocks.has(key) || this.recoveryBlockedPaths.has(key)) {
        this.deferredWatcherObservations.set(key, {
          kind: 'observed',
          rootPath,
          relativePath,
          bytesChanged: bytesChanged && file.provenanceBytesChanged !== false,
        });
      } else {
        ready.push({
          ...file,
          name: relativePath,
          provenanceBytesChanged: bytesChanged && file.provenanceBytesChanged !== false,
        });
      }
    }
    if (ready.length === 0) return;
    await this.#applyObservedFiles(rootPath, ready);
  }

  async observeWatcherRemovals({ rootPath, files = [], folders = [] }) {
    if (!this.#isAvailable()) return;
    const relativePaths = files.map((file) => file.relativePath ?? file.name);
    const rootKey = normalizeLibraryRootPath(rootPath, this.platform).pathKey;
    const root = this.repositoryLifecycle.run((repository) => (
      repository.listLibraryRoots().find((entry) => entry.pathKey === rootKey)
    ));
    for (const folder of folders) {
      const prefix = String(folder.relativePath ?? folder.name ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
      const folderPath = prefix ? path.resolve(rootPath, prefix) : path.resolve(rootPath);
      const folderStat = await this.#statOrNull(folderPath);
      if (folderStat) continue;
      this.indexer.invalidateRoot(rootPath);
      if (!root) continue;
      const locations = prefix
        ? this.repositoryLifecycle.run((repository) => {
            const prefixKey = normalizeRelativeCatalogPath(prefix, this.platform).relativePathKey;
            return repository.listPresentLocationsUnderPath(root.rootId, prefixKey);
          })
        : this.repositoryLifecycle.run((repository) => repository.listPresentLocations(root.rootId));
      relativePaths.push(...locations.map((location) => location.relativePath));
    }
    for (const relativePath of relativePaths) {
      const key = this.#absolutePathKey(path.resolve(rootPath, relativePath));
      if (this.activePathLocks.has(key) || this.recoveryBlockedPaths.has(key)) {
        this.deferredWatcherObservations.set(key, { kind: 'missing', rootPath, relativePath });
      } else {
        await this.#applyMissingObservation({ rootPath, relativePath });
      }
    }
  }

  #isAvailable() {
    return Boolean(this.enabled && this.repositoryLifecycle?.getStatus?.().available && this.indexer?.enabled);
  }

  #createIntent({ kind, sourcePath, destinationPath, expectedOutputSha256, beforeEvidence }) {
    return this.repositoryLifecycle.run((repository) => {
      const roots = repository.listLibraryRoots();
      const source = sourcePath ? this.#resolveCatalogPath(sourcePath, roots) : null;
      const destination = destinationPath ? this.#resolveCatalogPath(destinationPath, roots) : null;
      if (source) {
        const location = repository.getLocationByRootPath(source.rootId, source.relativePathKey);
        Object.assign(source, location ? {
          locationId: location.locationId,
          assetId: location.assetId,
          revisionId: location.revisionId,
        } : {});
      }
      if (destination) {
        const location = repository.getLocationByRootPath(destination.rootId, destination.relativePathKey);
        Object.assign(destination, location ? {
          existingLocationId: location.locationId,
          existingAssetId: location.assetId,
          existingRevisionId: location.revisionId,
        } : {});
      }
      const payload = {
        source,
        destination,
        sourceAbsolutePath: sourcePath ? path.resolve(sourcePath) : null,
        destinationAbsolutePath: destinationPath ? path.resolve(destinationPath) : null,
        samePathKey: Boolean(sourcePath && destinationPath
          && this.#absolutePathKey(sourcePath) === this.#absolutePathKey(destinationPath)),
        beforeEvidence,
        expectedOutputSha256,
        reserved: {
          assetId: destination && !destination.existingAssetId ? this.randomUUID() : null,
          revisionId: destination && !['rename', 'move', 'delete'].includes(kind) ? this.randomUUID() : null,
          locationId: destination && !destination.existingLocationId ? this.randomUUID() : null,
        },
      };
      if (!source && !destination) {
        return { operationId: null, kind, state: 'out_of_scope', payload };
      }
      if (['rename', 'move', 'delete'].includes(kind) && !source?.locationId) {
        return { operationId: null, kind, state: 'untracked', payload };
      }
      return repository.createFileOperationIntent({ operationId: this.randomUUID(), kind, payload });
    });
  }

  #resolveCatalogPath(absolutePath, roots) {
    const resolved = path.resolve(absolutePath);
    const pathApi = pathApiForPlatform(this.platform);
    for (const root of roots) {
      const relative = pathApi.relative(root.absolutePath, resolved);
      const inside = isRelativePathInsideRoot(relative, this.platform);
      if (!inside || relative === '') continue;
      const normalized = normalizeRelativeCatalogPath(relative, this.platform);
      return { rootId: root.rootId, rootPath: root.absolutePath, ...normalized };
    }
    return null;
  }

  async #inspectOutcome(operation, { verifyExpectedOutput = true } = {}) {
    const { source, destination, expectedOutputSha256, beforeEvidence = {} } = operation.payload;
    const sourceStat = source ? await this.#statOrNull(path.resolve(source.rootPath, source.relativePath)) : null;
    const destinationStat = destination ? await this.#statOrNull(path.resolve(destination.rootPath, destination.relativePath)) : null;
    if (operation.kind === 'delete') {
      if (sourceStat) return { state: 'aborted', reason: 'The source path still exists.' };
      if (verifyExpectedOutput && operation.state !== 'fs_applied') {
        return { state: 'pending_recovery', reason: 'The path is absent, but the journal does not prove explicit deletion completed.' };
      }
      return { state: 'completed', observation: null };
    }
    if (operation.kind === 'rename' || operation.kind === 'move') {
      if ((operation.payload.samePathKey || beforeEvidence.sameFilePathAlias) && destinationStat) {
        if (verifyExpectedOutput && operation.state !== 'fs_applied') {
          const actualPath = await this.#realPathOrNull(operation.payload.destinationAbsolutePath);
          if (!actualPath) {
            return { state: 'pending_recovery', reason: 'Case-only rename spelling could not be verified.' };
          }
          const actualRelative = path.relative(destination.rootPath, actualPath).replace(/\\/g, '/');
          if (actualRelative === source.relativePath) {
            return { state: 'aborted', reason: 'Case-only rename was not applied.' };
          }
          if (actualRelative !== destination.relativePath) {
            return { state: 'pending_recovery', reason: 'Case-only rename spelling is ambiguous.' };
          }
        }
        return { state: 'completed', observation: this.#observation(destination, destinationStat) };
      }
      if (!sourceStat && (destination ? destinationStat : true)) {
        if (
          verifyExpectedOutput
          && operation.state !== 'fs_applied'
          && destinationStat
          && !this.#matchesRecordedMove(destinationStat, beforeEvidence)
        ) {
          return { state: 'pending_recovery', reason: 'Destination evidence does not match the recorded move source.' };
        }
        return { state: 'completed', observation: destinationStat ? this.#observation(destination, destinationStat) : null };
      }
      if (sourceStat && !destinationStat) return { state: 'aborted', reason: 'Filesystem mutation was not applied.' };
      return { state: 'pending_recovery', reason: 'Move outcome is ambiguous; no destructive recovery was attempted.' };
    }
    if (!destination) return { state: 'completed', observation: null };
    if (!destinationStat) return { state: 'aborted', reason: 'Destination output was not created.' };
    if (expectedOutputSha256 && verifyExpectedOutput) {
      const actual = await this.#hashFile(path.resolve(destination.rootPath, destination.relativePath));
      if (actual !== expectedOutputSha256) {
        return { state: 'pending_recovery', reason: 'Destination bytes do not match the recorded output evidence.' };
      }
    } else if (
      verifyExpectedOutput
      && operation.state !== 'fs_applied'
      && operation.kind === 'copy'
      && !this.#matchesRecordedCopy(destinationStat, beforeEvidence)
    ) {
      return { state: 'pending_recovery', reason: 'Destination evidence does not match the recorded copy source.' };
    }
    return { state: 'completed', observation: this.#observation(destination, destinationStat) };
  }

  #observation(destination, stat) {
    return {
      ...signatureFromStat(stat),
      mimeType: inferMimeTypeFromName(destination.relativePath, null),
    };
  }

  #matchesRecordedSource(stat, recorded) {
    if (!stat || !recorded) return false;
    const current = signatureFromStat(stat);
    const sameInode = recorded.device !== null && recorded.inode !== null
      && current.device === recorded.device && current.inode === recorded.inode;
    return sameInode || (
      current.byteSize === recorded.byteSize
      && current.contentModifiedMs === recorded.contentModifiedMs
    );
  }

  #matchesRecordedMove(stat, beforeEvidence) {
    const source = beforeEvidence?.sourceSignature;
    const destination = beforeEvidence?.destinationSignature;
    if (!destination) return this.#matchesRecordedSource(stat, source);
    const current = signatureFromStat(stat);
    return source?.device !== null && source?.inode !== null
      && current.device === source.device && current.inode === source.inode;
  }

  #matchesRecordedCopy(stat, beforeEvidence) {
    if (beforeEvidence?.destinationSignature) return false;
    return this.#matchesRecordedSource(stat, beforeEvidence?.sourceSignature);
  }

  async #applyOperationOutcome(operation, outcome, { operationError = null } = {}) {
    if (outcome.state === 'aborted') {
      this.repositoryLifecycle.run((repository) => repository.abortFileOperation(
        operation.operationId,
        operationError ?? outcome.reason,
      ));
      this.#unblockOperationPaths(operation.payload);
      try {
        await this.#flushDeferredForOperation(operation.payload);
      } catch (error) {
        this.logger.warn('Aborted provenance operation could not flush deferred observations.', error);
      }
      return { state: 'aborted' };
    }

    if (outcome.state === 'pending_recovery') {
      if (operationError && typeof operationError === 'object') {
        operationError.provenanceOperationId = operation.operationId;
      }
      this.repositoryLifecycle.run((repository) => repository.markFileOperationPending(
        operation.operationId,
        operationError ?? outcome.reason,
      ));
      return { state: 'pending_recovery' };
    }

    let completed;
    try {
      this.repositoryLifecycle.run((repository) => repository.markFileOperationFileSystemApplied(operation.operationId));
      completed = this.repositoryLifecycle.run((repository) => repository.completeFileOperation(operation.operationId, {
        observation: outcome.observation,
      }));
    } catch (error) {
      if (operationError && typeof operationError === 'object') {
        operationError.provenanceOperationId = operation.operationId;
      }
      try {
        this.repositoryLifecycle.run((repository) => repository.markFileOperationPending(operation.operationId, error));
      } catch { /* the durable intent is already enough for startup recovery */ }
      this.logger.error('Filesystem operation completed but provenance reconciliation remains pending.', error);
      return { state: 'pending_recovery', error: error?.message || String(error) };
    }

    this.#unblockOperationPaths(operation.payload);
    try {
      await this.#observeCompletedDestination(operation.payload);
      await this.#flushDeferredForOperation(operation.payload);
    } catch (error) {
      this.logger.warn('Provenance operation committed, but post-operation observation will retry later.', error);
    }
    return { state: 'completed', operation: completed };
  }

  async #recoverOperation(operation) {
    const paths = this.#operationAbsolutePaths(operation.payload);
    return this.#withPathLocks(paths, async () => {
      const outcome = await this.#inspectOutcome(operation);
      if (outcome.state === 'completed') {
        try {
          this.repositoryLifecycle.run((repository) => repository.completeFileOperation(operation.operationId, {
            observation: outcome.observation,
          }));
        } catch (error) {
          this.repositoryLifecycle.run((repository) => repository.markFileOperationPending(operation.operationId, error));
          return 'pending_recovery';
        }
        this.#unblockOperationPaths(operation.payload);
        try {
          await this.#observeCompletedDestination(operation.payload);
          await this.#flushDeferredForOperation(operation.payload);
        } catch (error) {
          this.logger.warn('Recovered provenance operation committed, but post-operation observation will retry later.', error);
        }
        return 'completed';
      }
      if (outcome.state === 'aborted' && operation.state !== 'fs_applied') {
        this.repositoryLifecycle.run((repository) => repository.abortFileOperation(operation.operationId, outcome.reason));
        this.#unblockOperationPaths(operation.payload);
        return 'aborted';
      }
      this.repositoryLifecycle.run((repository) => repository.markFileOperationPending(operation.operationId, outcome.reason));
      return 'pending_recovery';
    });
  }

  async #observeCompletedDestination(payload) {
    const destination = payload.destination;
    if (!destination?.rootId) return;
    const absolutePath = path.resolve(destination.rootPath, destination.relativePath);
    const stat = await this.#statOrNull(absolutePath);
    if (!stat) return;
    await this.indexer.observeFiles({
      rootPath: destination.rootPath,
      files: [{
        name: destination.relativePath,
        size: stat.size,
        lastModified: stat.mtimeMs,
        contentModifiedMs: stat.mtimeMs,
        type: inferMimeTypeFromName(destination.relativePath, null),
      }],
      onBatch: this.publishMappings,
    });
  }

  #blockOperationPaths(payload) {
    for (const entry of [payload.source, payload.destination]) {
      if (!entry?.rootPath || !entry.relativePath) continue;
      const absolute = path.resolve(entry.rootPath, entry.relativePath);
      this.recoveryBlockedPaths.add(this.#absolutePathKey(absolute));
      this.indexer.invalidateRoot(entry.rootPath);
      this.indexer.blockCatalogPath(entry.rootPath, entry.relativePath);
    }
  }

  #unblockOperationPaths(payload) {
    for (const entry of [payload.source, payload.destination]) {
      if (!entry?.rootPath || !entry.relativePath) continue;
      const absolute = path.resolve(entry.rootPath, entry.relativePath);
      this.recoveryBlockedPaths.delete(this.#absolutePathKey(absolute));
      this.indexer.unblockCatalogPath(entry.rootPath, entry.relativePath);
    }
  }

  async #flushDeferredForOperation(payload) {
    for (const absolutePath of this.#operationAbsolutePaths(payload)) {
      const key = this.#absolutePathKey(absolutePath);
      const observation = this.deferredWatcherObservations.get(key);
      if (!observation || this.recoveryBlockedPaths.has(key)) continue;
      this.deferredWatcherObservations.delete(key);
      if (observation.kind === 'missing') {
        await this.#applyMissingObservation(observation, absolutePath);
      } else {
        const stat = await this.#statOrNull(absolutePath);
        if (stat) {
          await this.#applyObservedFiles(observation.rootPath, [{
            name: observation.relativePath,
            size: stat.size,
            lastModified: stat.mtimeMs,
            contentModifiedMs: stat.mtimeMs,
            type: inferMimeTypeFromName(observation.relativePath, null),
            provenanceBytesChanged: observation.bytesChanged,
          }]);
        }
      }
    }
  }

  async #applyObservedFiles(rootPath, files) {
    for (const file of files) {
      if (file.provenanceBytesChanged !== false) {
        this.indexer.invalidateCatalogPath(rootPath, file.name);
      }
    }
    this.indexer.invalidateRoot(rootPath);
    await this.indexer.observeFiles({ rootPath, files, onBatch: this.publishMappings });
  }

  async #applyMissingObservation(observation, absolutePath = null) {
    const resolvedPath = absolutePath ?? path.resolve(observation.rootPath, observation.relativePath);
    const stat = await this.#statOrNull(resolvedPath);
    if (stat) return false;
    this.indexer.invalidateRoot(observation.rootPath);
    this.indexer.markExternalMissing(observation);
    return true;
  }

  #operationAbsolutePaths(payload) {
    return [payload.source, payload.destination]
      .filter((entry) => entry?.rootPath && entry.relativePath)
      .map((entry) => path.resolve(entry.rootPath, entry.relativePath));
  }

  async #withPathLocks(absolutePaths, operation) {
    const keys = [...new Set(absolutePaths.map((value) => this.#absolutePathKey(value)))].sort();
    while (true) {
      const blockers = keys.map((key) => this.activePathLocks.get(key)).filter(Boolean);
      if (blockers.length === 0) break;
      await Promise.race(blockers);
    }
    let release;
    const released = new Promise((resolve) => { release = resolve; });
    for (const key of keys) this.activePathLocks.set(key, released);
    try {
      return await operation();
    } finally {
      for (const key of keys) {
        if (this.activePathLocks.get(key) === released) this.activePathLocks.delete(key);
      }
      release();
    }
  }

  #absolutePathKey(value) {
    const normalized = path.resolve(value);
    return this.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
  }

  async #isSameFilePathAlias({ kind, sourcePath, destinationPath, sourceStat, destinationStat }) {
    if (kind !== 'rename' || !sourcePath || !destinationPath || !sourceStat || !destinationStat) {
      return false;
    }
    const sourceAbsolutePath = path.resolve(sourcePath);
    const destinationAbsolutePath = path.resolve(destinationPath);
    if (
      sourceAbsolutePath === destinationAbsolutePath
      || sourceAbsolutePath.toLocaleLowerCase('en-US') !== destinationAbsolutePath.toLocaleLowerCase('en-US')
    ) {
      return false;
    }
    const sourceSignature = signatureFromStat(sourceStat);
    const destinationSignature = signatureFromStat(destinationStat);
    if (
      sourceSignature.device === null
      || sourceSignature.inode === null
      || sourceSignature.device !== destinationSignature.device
      || sourceSignature.inode !== destinationSignature.inode
    ) {
      return false;
    }
    const [sourceRealPath, destinationRealPath] = await Promise.all([
      this.#realPathOrNull(sourceAbsolutePath),
      this.#realPathOrNull(destinationAbsolutePath),
    ]);
    return Boolean(
      sourceRealPath
      && destinationRealPath
      && path.resolve(sourceRealPath) === path.resolve(destinationRealPath)
    );
  }

  async #statOrNull(filePath) {
    try { return await this.fileSystem.stat(filePath); } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async #realPathOrNull(filePath) {
    if (!filePath || typeof this.fileSystem.realpath !== 'function') return null;
    try { return await this.fileSystem.realpath(filePath); } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async #hashFile(filePath) {
    const hash = crypto.createHash('sha256');
    const stream = this.createReadStream(filePath);
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest('hex');
  }
}

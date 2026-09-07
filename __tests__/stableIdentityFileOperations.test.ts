import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { ProvenanceRepositoryLifecycle, resolveProvenanceCatalogPath } from '../electron/provenanceRepository.mjs';
import { StableIdentityIndexer } from '../electron/stableIdentityIndexer.mjs';
import { StableIdentityFileOperationCoordinator } from '../electron/stableIdentityFileOperationCoordinator.mjs';
import { runStableIdentityFileOperationsSmoke } from '../electron/stableIdentityFileOperationsSmoke.mjs';

const temporaryDirectories: string[] = [];

async function workspace() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-stable-file-ops-'));
  temporaryDirectories.push(base);
  const userDataPath = path.join(base, 'profile');
  const rootA = path.join(base, 'Library A');
  const rootB = path.join(base, 'Library B');
  await Promise.all([fs.mkdir(userDataPath), fs.mkdir(rootA), fs.mkdir(rootB)]);
  return { base, userDataPath, rootA, rootB };
}

async function record(rootPath: string, relativePath: string) {
  const stat = await fs.stat(path.join(rootPath, relativePath));
  return {
    name: relativePath,
    size: stat.size,
    lastModified: stat.mtimeMs,
    contentModifiedMs: stat.mtimeMs,
    type: 'application/octet-stream',
  };
}

function createRuntime(userDataPath: string, options: Record<string, unknown> = {}) {
  const lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
  lifecycle.initialize();
  const indexer = new StableIdentityIndexer({ repositoryLifecycle: lifecycle, enabled: true, ...(options.indexer as object) });
  const mappings: any[] = [];
  const coordinator = new StableIdentityFileOperationCoordinator({
    repositoryLifecycle: lifecycle,
    indexer,
    enabled: true,
    publishMappings: ({ mappings: batch }: any) => mappings.push(...batch),
    ...(options.coordinator as object),
  });
  return { lifecycle, indexer, coordinator, mappings };
}

async function registerRoot(indexer: StableIdentityIndexer, rootPath: string, relativePaths: string[] = []) {
  const mappings: any[] = [];
  await indexer.indexScan({
    rootPath,
    files: await Promise.all(relativePaths.map((relativePath) => record(rootPath, relativePath))),
    recursive: true,
    scanComplete: true,
    onBatch: ({ mappings: batch }: any) => mappings.push(...batch),
  });
  return mappings;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('stable identity file-operation coordination', () => {
  it('preserves identity across rename, case-only rename, cross-root move, and restart', async () => {
    const { userDataPath, rootA, rootB } = await workspace();
    await fs.writeFile(path.join(rootA, 'original.bin'), 'stable bytes');
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [original] = await registerRoot(indexer, rootA, ['original.bin']);
    await registerRoot(indexer, rootB);

    await coordinator.executeKnownOperation({
      kind: 'rename',
      sourcePath: path.join(rootA, 'original.bin'),
      destinationPath: path.join(rootA, 'Renamed.bin'),
      perform: () => fs.rename(path.join(rootA, 'original.bin'), path.join(rootA, 'Renamed.bin')),
    });
    await coordinator.executeKnownOperation({
      kind: 'rename',
      sourcePath: path.join(rootA, 'Renamed.bin'),
      destinationPath: path.join(rootA, 'RENAMED.bin'),
      perform: () => fs.rename(path.join(rootA, 'Renamed.bin'), path.join(rootA, 'RENAMED.bin')),
    });
    await coordinator.executeKnownOperation({
      kind: 'move',
      sourcePath: path.join(rootA, 'RENAMED.bin'),
      destinationPath: path.join(rootB, 'moved.bin'),
      perform: () => fs.rename(path.join(rootA, 'RENAMED.bin'), path.join(rootB, 'moved.bin')),
    });

    const movedRoot = lifecycle.run((repository) => repository.listLibraryRoots().find((root) => root.absolutePath === rootB));
    const moved = lifecycle.run((repository) => repository.getLocationByRootPath(movedRoot!.rootId, 'moved.bin'));
    expect(moved).toMatchObject({
      assetId: original.assetId,
      revisionId: original.revisionId,
      locationId: original.locationId,
      state: 'present',
    });
    indexer.stop();
    lifecycle.close();

    const reopened = new ProvenanceRepositoryLifecycle({ userDataPath });
    reopened.initialize();
    expect(reopened.run((repository) => repository.getAsset(original.assetId))).toMatchObject({
      assetId: original.assetId,
      locations: [{ rootId: movedRoot!.rootId, relativePath: 'moved.bin', locationId: original.locationId }],
    });
    reopened.close();
  });

  it('creates distinct copy and Save As assets, but advances an overwritten destination even with the same signature', async () => {
    const { userDataPath, rootA, rootB } = await workspace();
    const sourcePath = path.join(rootA, 'source.bin');
    await fs.writeFile(sourcePath, 'AAAA');
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [source] = await registerRoot(indexer, rootA, ['source.bin']);
    await registerRoot(indexer, rootB);

    const copyPath = path.join(rootB, 'copy.bin');
    await coordinator.executeKnownOperation({
      kind: 'copy', sourcePath, destinationPath: copyPath, perform: () => fs.copyFile(sourcePath, copyPath),
    });
    const saveAsPath = path.join(rootB, 'save-as.bin');
    const savedBytes = Buffer.from('AAAA');
    await coordinator.executeKnownOperation({
      kind: 'save_as',
      destinationPath: saveAsPath,
      expectedOutputSha256: crypto.createHash('sha256').update(savedBytes).digest('hex'),
      perform: () => fs.writeFile(saveAsPath, savedBytes),
    });

    const root = lifecycle.run((repository) => repository.listLibraryRoots().find((entry) => entry.absolutePath === rootB));
    const copy = lifecycle.run((repository) => repository.getLocationByRootPath(root!.rootId, 'copy.bin'))!;
    const saveAs = lifecycle.run((repository) => repository.getLocationByRootPath(root!.rootId, 'save-as.bin'))!;
    expect(new Set([source.assetId, copy.assetId, saveAs.assetId]).size).toBe(3);

    const before = await fs.stat(copyPath);
    await coordinator.executeKnownOperation({
      kind: 'overwrite',
      destinationPath: copyPath,
      expectedOutputSha256: crypto.createHash('sha256').update('BBBB').digest('hex'),
      perform: async () => {
        await fs.writeFile(copyPath, 'BBBB');
        await fs.utimes(copyPath, before.atime, before.mtime);
      },
    });
    const overwritten = lifecycle.run((repository) => repository.getLocationByRootPath(root!.rootId, 'copy.bin'))!;
    expect(overwritten.assetId).toBe(copy.assetId);
    expect(overwritten.revisionId).not.toBe(copy.revisionId);
    expect(lifecycle.run((repository) => repository.getAsset(copy.assetId))?.revisions).toHaveLength(2);
    indexer.stop();
    lifecycle.close();
  });

  it('uses overwrite semantics for copy and move onto an existing tracked destination', async () => {
    const { userDataPath, rootA, rootB } = await workspace();
    const copySourcePath = path.join(rootA, 'copy-source.bin');
    const moveSourcePath = path.join(rootA, 'move-source.bin');
    const copyDestinationPath = path.join(rootB, 'copy-destination.bin');
    const moveDestinationPath = path.join(rootB, 'move-destination.bin');
    await Promise.all([
      fs.writeFile(copySourcePath, 'copy source'),
      fs.writeFile(moveSourcePath, 'move source'),
      fs.writeFile(copyDestinationPath, 'old copy destination'),
      fs.writeFile(moveDestinationPath, 'old move destination'),
    ]);
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [copySource, moveSource] = await registerRoot(indexer, rootA, ['copy-source.bin', 'move-source.bin']);
    const [copyDestination, moveDestination] = await registerRoot(indexer, rootB, ['copy-destination.bin', 'move-destination.bin']);

    await coordinator.executeKnownOperation({
      kind: 'copy',
      sourcePath: copySourcePath,
      destinationPath: copyDestinationPath,
      perform: () => fs.copyFile(copySourcePath, copyDestinationPath),
    });
    await coordinator.executeKnownOperation({
      kind: 'move',
      sourcePath: moveSourcePath,
      destinationPath: moveDestinationPath,
      perform: async () => {
        await fs.unlink(moveDestinationPath);
        await fs.rename(moveSourcePath, moveDestinationPath);
      },
    });

    const root = lifecycle.run((repository) => repository.listLibraryRoots().find((entry) => entry.absolutePath === rootB))!;
    const copied = lifecycle.run((repository) => repository.getLocationByRootPath(root.rootId, 'copy-destination.bin'))!;
    const moved = lifecycle.run((repository) => repository.getLocationByRootPath(root.rootId, 'move-destination.bin'))!;
    expect(copied.assetId).toBe(copyDestination.assetId);
    expect(copied.revisionId).not.toBe(copyDestination.revisionId);
    expect(copied.assetId).not.toBe(copySource.assetId);
    expect(moved).toMatchObject({ assetId: moveSource.assetId, revisionId: moveSource.revisionId });
    expect(lifecycle.run((repository) => repository.getAsset(moveDestination.assetId))?.state).toBe('deleted');
    indexer.stop();
    lifecycle.close();
  });

  it('does not register destinations outside known roots', async () => {
    const { base, userDataPath, rootA } = await workspace();
    const outside = path.join(base, 'Outside');
    await fs.mkdir(outside);
    const moveSourcePath = path.join(rootA, 'move.bin');
    const copySourcePath = path.join(rootA, 'copy.bin');
    await Promise.all([fs.writeFile(moveSourcePath, 'move'), fs.writeFile(copySourcePath, 'copy')]);
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [moveSource, copySource] = await registerRoot(indexer, rootA, ['move.bin', 'copy.bin']);

    await coordinator.executeKnownOperation({
      kind: 'move',
      sourcePath: moveSourcePath,
      destinationPath: path.join(outside, 'moved.bin'),
      perform: () => fs.rename(moveSourcePath, path.join(outside, 'moved.bin')),
    });
    await coordinator.executeKnownOperation({
      kind: 'copy',
      sourcePath: copySourcePath,
      destinationPath: path.join(outside, 'copied.bin'),
      perform: () => fs.copyFile(copySourcePath, path.join(outside, 'copied.bin')),
    });

    expect(lifecycle.run((repository) => repository.listLibraryRoots())).toHaveLength(1);
    expect(lifecycle.run((repository) => repository.getAsset(moveSource.assetId))?.state).toBe('missing');
    expect(lifecycle.run((repository) => repository.getAsset(copySource.assetId))?.state).toBe('active');
    await expect(fs.stat(path.join(outside, 'moved.bin'))).resolves.toBeDefined();
    await expect(fs.stat(path.join(outside, 'copied.bin'))).resolves.toBeDefined();
    indexer.stop();
    lifecycle.close();
  });

  it('does not record cancelled or failed deletion and preserves successful batch members', async () => {
    const { userDataPath, rootA } = await workspace();
    await fs.writeFile(path.join(rootA, 'keep.bin'), 'keep');
    await fs.writeFile(path.join(rootA, 'delete.bin'), 'delete');
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [keep, deleted] = await registerRoot(indexer, rootA, ['keep.bin', 'delete.bin']);

    await expect(coordinator.executeKnownOperation({
      kind: 'delete',
      sourcePath: path.join(rootA, 'keep.bin'),
      perform: async () => { throw new Error('synthetic cancellation'); },
    })).rejects.toThrow('synthetic cancellation');
    await coordinator.executeKnownOperation({
      kind: 'delete',
      sourcePath: path.join(rootA, 'delete.bin'),
      perform: () => fs.unlink(path.join(rootA, 'delete.bin')),
    });

    expect(lifecycle.run((repository) => repository.getAsset(keep.assetId))?.state).toBe('active');
    expect(lifecycle.run((repository) => repository.getAsset(deleted.assetId))?.state).toBe('deleted');
    expect(lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);
    indexer.stop();
    lifecycle.close();
  });

  it.each([
    { kind: 'rename', destinationRoot: 'A' },
    { kind: 'move', destinationRoot: 'B' },
    { kind: 'delete', destinationRoot: null },
  ])('does not journal a tracked $kind whose source was already absent', async ({ kind, destinationRoot }) => {
    const { userDataPath, rootA, rootB } = await workspace();
    const sourcePath = path.join(rootA, 'missing-before-operation.bin');
    const destinationPath = destinationRoot
      ? path.join(destinationRoot === 'A' ? rootA : rootB, 'destination.bin')
      : null;
    await fs.writeFile(sourcePath, 'original');
    const { lifecycle, indexer, coordinator, mappings } = createRuntime(userDataPath);
    const [original] = await registerRoot(indexer, rootA, ['missing-before-operation.bin']);
    await registerRoot(indexer, rootB);
    await indexer.waitForIdle();
    await fs.unlink(sourcePath);

    let performCalls = 0;
    await expect(coordinator.executeKnownOperation({
      kind,
      sourcePath,
      destinationPath,
      perform: async () => {
        performCalls += 1;
        if (kind === 'delete') await fs.unlink(sourcePath);
        else await fs.rename(sourcePath, destinationPath!);
      },
    })).rejects.toMatchObject({ code: 'ENOENT' });

    expect(performCalls).toBe(1);
    expect(lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);

    await fs.writeFile(sourcePath, 'replacement with different bytes');
    await coordinator.observeWatcherFiles({ rootPath: rootA, files: [await record(rootA, 'missing-before-operation.bin')] });
    const root = lifecycle.run((repository) => repository.listLibraryRoots().find((entry) => entry.absolutePath === rootA))!;
    const rediscovered = lifecycle.run((repository) => (
      repository.getLocationByRootPath(root.rootId, 'missing-before-operation.bin')
    ))!;
    expect(rediscovered).toMatchObject({ assetId: original.assetId, state: 'present' });
    expect(rediscovered.revisionId).not.toBe(original.revisionId);
    expect(mappings.at(-1)).toMatchObject({
      relativePath: 'missing-before-operation.bin',
      assetId: original.assetId,
      revisionId: rediscovered.revisionId,
    });
    indexer.stop();
    lifecycle.close();
  });

  it('reuses a pending delete when permanent fallback only needs to remove a sidecar', async () => {
    const { userDataPath, rootA } = await workspace();
    const modelPath = path.join(rootA, 'model.glb');
    const sidecarPath = `${modelPath}.imagemetahub.json`;
    await Promise.all([fs.writeFile(modelPath, 'model'), fs.writeFile(sidecarPath, 'sidecar')]);
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [model] = await registerRoot(indexer, rootA, ['model.glb']);

    let pendingOperationId: string | undefined;
    try {
      await coordinator.executeKnownOperation({
        kind: 'delete',
        sourcePath: modelPath,
        perform: async () => {
          await fs.unlink(modelPath);
          throw new Error('synthetic sidecar trash failure');
        },
      });
    } catch (error: any) {
      pendingOperationId = error.provenanceOperationId;
    }

    expect(pendingOperationId).toBeTruthy();
    expect(lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(1);
    const fallback = await coordinator.continuePendingDelete({
      operationId: pendingOperationId,
      sourcePath: modelPath,
      perform: async () => {
        await fs.unlink(sidecarPath);
        return { primaryDeleted: true, failures: [] };
      },
    });

    expect(fallback.value).toEqual({ primaryDeleted: true, failures: [] });
    expect(lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);
    expect(lifecycle.run((repository) => repository.getAsset(model.assetId))?.state).toBe('deleted');
    await expect(fs.stat(sidecarPath)).rejects.toMatchObject({ code: 'ENOENT' });
    indexer.stop();
    lifecycle.close();
  });

  it('bypasses file identity coordination for directory renames', async () => {
    const { userDataPath, rootA } = await workspace();
    const sourceDirectory = path.join(rootA, 'folder');
    const destinationDirectory = path.join(rootA, 'renamed-folder');
    await fs.mkdir(sourceDirectory);
    await fs.writeFile(path.join(sourceDirectory, 'inside.bin'), 'inside');
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [inside] = await registerRoot(indexer, rootA, ['folder/inside.bin']);
    await indexer.waitForIdle();

    const result = await coordinator.executeKnownOperation({
      kind: 'rename',
      sourcePath: sourceDirectory,
      destinationPath: destinationDirectory,
      perform: () => fs.rename(sourceDirectory, destinationDirectory),
    });

    expect(result.provenance).toMatchObject({
      enabled: true,
      available: true,
      tracked: false,
      reason: 'directory_operation_not_supported',
    });
    expect(lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);
    expect(lifecycle.run((repository) => repository.getAsset(inside.assetId))?.locations[0].relativePath)
      .toBe('folder/inside.bin');
    const root = lifecycle.run((repository) => repository.listLibraryRoots()[0]);
    expect(lifecycle.run((repository) => repository.getLocationByRootPath(root.rootId, 'renamed-folder'))).toBeNull();
    await expect(fs.stat(path.join(destinationDirectory, 'inside.bin'))).resolves.toBeDefined();
    indexer.stop();
    lifecycle.close();
  });

  it('does not claim a failed case-only rename and recovers a committed delete after a catalog failure', async () => {
    const { userDataPath, rootA } = await workspace();
    const renamePath = path.join(rootA, 'MixedCase.bin');
    const deletePath = path.join(rootA, 'delete.bin');
    await Promise.all([fs.writeFile(renamePath, 'rename'), fs.writeFile(deletePath, 'delete')]);
    const runtime = createRuntime(userDataPath, {
      coordinator: { logger: { error: () => {}, warn: () => {} } },
    });
    const [renamed, deleted] = await registerRoot(runtime.indexer, rootA, ['MixedCase.bin', 'delete.bin']);

    await expect(runtime.coordinator.executeKnownOperation({
      kind: 'rename',
      sourcePath: renamePath,
      destinationPath: path.join(rootA, 'MIXEDCASE.bin'),
      perform: async () => { throw new Error('synthetic rename failure'); },
    })).rejects.toThrow('synthetic rename failure');
    expect(runtime.lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);
    expect(runtime.lifecycle.run((repository) => repository.getAsset(renamed.assetId))?.locations[0].relativePath).toBe('MixedCase.bin');

    const repository = (runtime.lifecycle as any).repository;
    const complete = repository.completeFileOperation.bind(repository);
    let failOnce = true;
    repository.completeFileOperation = (...args: unknown[]) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('synthetic delete catalog failure');
      }
      return complete(...args);
    };
    const result = await runtime.coordinator.executeKnownOperation({
      kind: 'delete', sourcePath: deletePath, perform: () => fs.unlink(deletePath),
    });
    expect(result.provenance).toMatchObject({ pending: true });
    expect(runtime.lifecycle.run((repo) => repo.listPendingFileOperations())[0]?.state).toBe('fs_applied');
    repository.completeFileOperation = complete;

    const recovery = new StableIdentityFileOperationCoordinator({
      repositoryLifecycle: runtime.lifecycle,
      indexer: runtime.indexer,
      enabled: true,
    });
    expect(await recovery.initializeRecovery()).toMatchObject({ recovered: 1, pending: 0 });
    expect(runtime.lifecycle.run((repo) => repo.getAsset(deleted.assetId))?.state).toBe('deleted');
    runtime.indexer.stop();
    runtime.lifecycle.close();
  });

  it('limits watcher folder removals to the literal folder path', async () => {
    const { userDataPath, rootA } = await workspace();
    await Promise.all([
      fs.mkdir(path.join(rootA, 'folder_1')),
      fs.mkdir(path.join(rootA, 'folderX1')),
    ]);
    await Promise.all([
      fs.writeFile(path.join(rootA, 'folder_1', 'inside.bin'), 'inside'),
      fs.writeFile(path.join(rootA, 'folderX1', 'outside.bin'), 'outside'),
    ]);
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [inside, outside] = await registerRoot(indexer, rootA, ['folder_1/inside.bin', 'folderX1/outside.bin']);
    await indexer.waitForIdle();
    await fs.unlink(path.join(rootA, 'folder_1', 'inside.bin'));

    await coordinator.observeWatcherRemovals({
      rootPath: rootA,
      folders: [{ relativePath: 'folder_1' }],
    });
    expect(lifecycle.run((repository) => repository.getAsset(inside.assetId))?.state).toBe('missing');
    expect(lifecycle.run((repository) => repository.getAsset(outside.assetId))?.state).toBe('active');
    indexer.stop();
    lifecycle.close();
  });

  it('ignores a stale watcher removal while the file still exists', async () => {
    const { userDataPath, rootA } = await workspace();
    await fs.writeFile(path.join(rootA, 'present.bin'), 'present');
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [present] = await registerRoot(indexer, rootA, ['present.bin']);

    await coordinator.observeWatcherRemovals({
      rootPath: rootA,
      files: [{ relativePath: 'present.bin' }],
    });

    expect(lifecycle.run((repository) => repository.getAsset(present.assetId))?.state).toBe('active');
    indexer.stop();
    lifecycle.close();
  });

  it('keeps a failed cross-volume copy-then-delete move pending without inventing a destination identity', async () => {
    const { userDataPath, rootA, rootB } = await workspace();
    const sourcePath = path.join(rootA, 'source.bin');
    const destinationPath = path.join(rootB, 'destination.bin');
    await fs.writeFile(sourcePath, 'bytes');
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [source] = await registerRoot(indexer, rootA, ['source.bin']);
    await registerRoot(indexer, rootB);

    await expect(coordinator.executeKnownOperation({
      kind: 'move',
      sourcePath,
      destinationPath,
      perform: async () => {
        await fs.copyFile(sourcePath, destinationPath);
        throw new Error('synthetic source delete failure');
      },
    })).rejects.toThrow('synthetic source delete failure');

    const destinationRoot = lifecycle.run((repository) => repository.listLibraryRoots().find((root) => root.absolutePath === rootB));
    expect(lifecycle.run((repository) => repository.getLocationByRootPath(destinationRoot!.rootId, 'destination.bin'))).toBeNull();
    expect(lifecycle.run((repository) => repository.getAsset(source.assetId))?.state).toBe('active');
    expect(lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(1);
    expect(await coordinator.initializeRecovery()).toMatchObject({ pending: 1 });
    expect(await coordinator.initializeRecovery()).toMatchObject({ pending: 1 });
    await expect(fs.stat(sourcePath)).resolves.toBeDefined();
    await expect(fs.stat(destinationPath)).resolves.toBeDefined();
    indexer.stop();
    lifecycle.close();
  });

  it('defers watcher changes during overwrite and rejects a scan enumerated before the mutation', async () => {
    const { userDataPath, rootA } = await workspace();
    const sourcePath = path.join(rootA, 'source.bin');
    await fs.writeFile(sourcePath, 'old');
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [source] = await registerRoot(indexer, rootA, ['source.bin']);
    const staleToken = indexer.beginScan(rootA);
    const staleRecord = await record(rootA, 'source.bin');

    let releaseWrite!: () => void;
    let reportWritten!: () => void;
    const writeReleased = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const written = new Promise<void>((resolve) => { reportWritten = resolve; });
    const overwrite = coordinator.executeKnownOperation({
      kind: 'overwrite',
      destinationPath: sourcePath,
      expectedOutputSha256: crypto.createHash('sha256').update('new').digest('hex'),
      perform: async () => {
        await fs.writeFile(sourcePath, 'new');
        reportWritten();
        await writeReleased;
      },
    });
    await written;
    await coordinator.observeWatcherFiles({ rootPath: rootA, files: [await record(rootA, 'source.bin')] });
    releaseWrite();
    await overwrite;
    await coordinator.observeWatcherFiles({ rootPath: rootA, files: [await record(rootA, 'source.bin')] });

    const staleResult = await indexer.indexScan({
      rootPath: rootA,
      files: [staleRecord],
      recursive: true,
      scanComplete: true,
      scanToken: staleToken,
    });
    expect(staleResult).toMatchObject({ stale: true, assigned: 0, reconciled: false });
    expect(lifecycle.run((repository) => repository.getAsset(source.assetId))?.revisions).toHaveLength(2);
    indexer.stop();
    lifecycle.close();
  });

  it('invalidates only the affected root scan for watcher add and no-byte-change observations', async () => {
    const { userDataPath, rootA, rootB } = await workspace();
    await Promise.all([
      fs.writeFile(path.join(rootA, 'kept.bin'), 'kept'),
      fs.writeFile(path.join(rootB, 'other.bin'), 'other'),
    ]);
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [kept] = await registerRoot(indexer, rootA, ['kept.bin']);
    await registerRoot(indexer, rootB, ['other.bin']);
    const staleSnapshot = [await record(rootA, 'kept.bin')];
    const unaffectedToken = indexer.beginScan(rootB);
    await fs.writeFile(path.join(rootA, 'watcher-added.bin'), 'added');

    let releaseAddReconciliation!: () => void;
    let reportAddReconciliation!: () => void;
    const addReleased = new Promise<void>((resolve) => { releaseAddReconciliation = resolve; });
    const addReached = new Promise<void>((resolve) => { reportAddReconciliation = resolve; });
    const staleAddScan = indexer.indexScan({
      rootPath: rootA,
      files: staleSnapshot,
      recursive: true,
      scanComplete: true,
      beforeReconcile: async () => {
        reportAddReconciliation();
        await addReleased;
      },
    });
    await addReached;
    await coordinator.observeWatcherFiles({
      rootPath: rootA,
      files: [await record(rootA, 'watcher-added.bin')],
    });
    releaseAddReconciliation();
    expect(await staleAddScan).toMatchObject({ stale: true, reconciled: false });

    const rootRecord = lifecycle.run((repository) => (
      repository.listLibraryRoots().find((entry) => entry.absolutePath === rootA)
    ))!;
    const added = lifecycle.run((repository) => (
      repository.getLocationByRootPath(rootRecord.rootId, 'watcher-added.bin')
    ))!;
    expect(added).toMatchObject({ state: 'present' });

    const unaffected = await indexer.indexScan({
      rootPath: rootB,
      files: [await record(rootB, 'other.bin')],
      recursive: true,
      scanComplete: true,
      scanToken: unaffectedToken,
    });
    expect(unaffected).toMatchObject({ stale: false, reconciled: true });

    let releaseChangeReconciliation!: () => void;
    let reportChangeReconciliation!: () => void;
    const changeReleased = new Promise<void>((resolve) => { releaseChangeReconciliation = resolve; });
    const changeReached = new Promise<void>((resolve) => { reportChangeReconciliation = resolve; });
    const currentSnapshot = await Promise.all([
      record(rootA, 'kept.bin'),
      record(rootA, 'watcher-added.bin'),
    ]);
    const staleChangeScan = indexer.indexScan({
      rootPath: rootA,
      files: currentSnapshot,
      recursive: true,
      scanComplete: true,
      beforeReconcile: async () => {
        reportChangeReconciliation();
        await changeReleased;
      },
    });
    await changeReached;
    await coordinator.observeWatcherFiles({
      rootPath: rootA,
      files: [{ ...await record(rootA, 'watcher-added.bin'), provenanceBytesChanged: false }],
    });
    releaseChangeReconciliation();
    expect(await staleChangeScan).toMatchObject({ stale: true, reconciled: false });
    expect(lifecycle.run((repository) => (
      repository.getLocationByRootPath(rootRecord.rootId, 'watcher-added.bin')
    ))).toMatchObject({ assetId: added.assetId, revisionId: added.revisionId, state: 'present' });

    await fs.unlink(path.join(rootA, 'kept.bin'));
    const finalScan = await indexer.indexScan({
      rootPath: rootA,
      files: [await record(rootA, 'watcher-added.bin')],
      recursive: true,
      scanComplete: true,
    });
    expect(finalScan).toMatchObject({ stale: false, reconciled: true });
    expect(lifecycle.run((repository) => repository.getAsset(kept.assetId))?.state).toBe('missing');
    expect(lifecycle.run((repository) => repository.getAsset(added.assetId))?.state).toBe('active');
    indexer.stop();
    lifecycle.close();
  });

  it('keeps dot-prefixed child folders distinct and coordinates files below them', async () => {
    const { userDataPath, rootA } = await workspace();
    await Promise.all([
      fs.mkdir(path.join(rootA, '..archive')),
      fs.mkdir(path.join(rootA, '...')),
    ]);
    await Promise.all([
      fs.writeFile(path.join(rootA, 'image.png'), 'root'),
      fs.writeFile(path.join(rootA, '..archive', 'image.png'), 'archive'),
      fs.writeFile(path.join(rootA, '...', 'image.png'), 'ellipsis'),
    ]);
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const identities = await registerRoot(indexer, rootA, [
      'image.png',
      '..archive/image.png',
      '.../image.png',
    ]);
    expect(new Set(identities.map((identity) => identity.assetId)).size).toBe(3);
    const archived = identities.find((identity) => identity.relativePath === '..archive/image.png')!;

    await coordinator.executeKnownOperation({
      kind: 'rename',
      sourcePath: path.join(rootA, '..archive', 'image.png'),
      destinationPath: path.join(rootA, '..archive', 'renamed.png'),
      perform: () => fs.rename(
        path.join(rootA, '..archive', 'image.png'),
        path.join(rootA, '..archive', 'renamed.png'),
      ),
    });

    const rootRecord = lifecycle.run((repository) => repository.listLibraryRoots()[0]);
    expect(lifecycle.run((repository) => (
      repository.getLocationByRootPath(rootRecord.rootId, '..archive/renamed.png')
    ))).toMatchObject({ assetId: archived.assetId, revisionId: archived.revisionId, state: 'present' });
    indexer.stop();
    lifecycle.close();
  });

  it('rejects an in-flight hash after overwrite and hashes only the reserved replacement revision', async () => {
    const { userDataPath, rootA } = await workspace();
    const filePath = path.join(rootA, 'source.bin');
    await fs.writeFile(filePath, 'old bytes');
    let releaseHash!: () => void;
    let reportHashStarted!: () => void;
    const hashReleased = new Promise<void>((resolve) => { releaseHash = resolve; });
    const hashStarted = new Promise<void>((resolve) => { reportHashStarted = resolve; });
    let firstRead = true;
    const createReadStream = (targetPath: string) => {
      if (!firstRead) return fsSync.createReadStream(targetPath);
      firstRead = false;
      return Readable.from((async function* () {
        const bytes = await fs.readFile(targetPath);
        reportHashStarted();
        await hashReleased;
        yield bytes;
      })());
    };
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath, {
      indexer: { createReadStream },
    });
    const [original] = await registerRoot(indexer, rootA, ['source.bin']);
    await hashStarted;

    const output = Buffer.from('new bytes');
    await coordinator.executeKnownOperation({
      kind: 'overwrite',
      destinationPath: filePath,
      expectedOutputSha256: crypto.createHash('sha256').update(output).digest('hex'),
      perform: () => fs.writeFile(filePath, output),
    });
    releaseHash();
    await indexer.waitForIdle();

    const asset = lifecycle.run((repository) => repository.getAsset(original.assetId))!;
    expect(asset.revisions).toHaveLength(2);
    expect(asset.revisions.find((revision) => revision.revisionId === original.revisionId)?.hashState).toBe('pending');
    expect(asset.revisions.find((revision) => revision.revisionId !== original.revisionId)?.hashState).toBe('available');
    indexer.stop();
    lifecycle.close();
  });

  it('resumes an in-flight pending hash at the renamed path', async () => {
    const { userDataPath, rootA } = await workspace();
    const sourcePath = path.join(rootA, 'source.bin');
    const destinationPath = path.join(rootA, 'renamed.bin');
    await fs.writeFile(sourcePath, 'rename bytes');
    let releaseHash!: () => void;
    let reportHashStarted!: () => void;
    const hashReleased = new Promise<void>((resolve) => { releaseHash = resolve; });
    const hashStarted = new Promise<void>((resolve) => { reportHashStarted = resolve; });
    let firstRead = true;
    const createReadStream = (targetPath: string) => {
      if (!firstRead) return fsSync.createReadStream(targetPath);
      firstRead = false;
      return Readable.from((async function* () {
        const bytes = await fs.readFile(targetPath);
        reportHashStarted();
        await hashReleased;
        yield bytes;
      })());
    };
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath, { indexer: { createReadStream } });
    const [original] = await registerRoot(indexer, rootA, ['source.bin']);
    await hashStarted;

    await coordinator.executeKnownOperation({
      kind: 'rename', sourcePath, destinationPath, perform: () => fs.rename(sourcePath, destinationPath),
    });
    releaseHash();
    await indexer.waitForIdle();

    const revision = lifecycle.run((repository) => repository.getAsset(original.assetId))?.revisions[0];
    expect(revision).toMatchObject({ revisionId: original.revisionId, hashState: 'available' });
    expect(revision?.sha256).toBe(crypto.createHash('sha256').update('rename bytes').digest('hex'));
    indexer.stop();
    lifecycle.close();
  });

  it('does not commit an in-flight hash after confirmed deletion', async () => {
    const { userDataPath, rootA } = await workspace();
    const filePath = path.join(rootA, 'delete.bin');
    await fs.writeFile(filePath, 'delete bytes');
    let releaseHash!: () => void;
    let reportHashStarted!: () => void;
    const hashReleased = new Promise<void>((resolve) => { releaseHash = resolve; });
    const hashStarted = new Promise<void>((resolve) => { reportHashStarted = resolve; });
    const createReadStream = (targetPath: string) => Readable.from((async function* () {
      const bytes = await fs.readFile(targetPath);
      reportHashStarted();
      await hashReleased;
      yield bytes;
    })());
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath, { indexer: { createReadStream } });
    const [original] = await registerRoot(indexer, rootA, ['delete.bin']);
    await hashStarted;

    await coordinator.executeKnownOperation({ kind: 'delete', sourcePath: filePath, perform: () => fs.unlink(filePath) });
    releaseHash();
    await indexer.waitForIdle();

    const asset = lifecycle.run((repository) => repository.getAsset(original.assetId))!;
    expect(asset.state).toBe('deleted');
    expect(asset.revisions[0]).toMatchObject({ revisionId: original.revisionId, hashState: 'pending' });
    indexer.stop();
    lifecycle.close();
  });

  it('serializes conflicting operations on the same path', async () => {
    const { userDataPath, rootA } = await workspace();
    const filePath = path.join(rootA, 'source.bin');
    await fs.writeFile(filePath, 'zero');
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [original] = await registerRoot(indexer, rootA, ['source.bin']);
    let releaseFirst!: () => void;
    let reportFirstStarted!: () => void;
    const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstStarted = new Promise<void>((resolve) => { reportFirstStarted = resolve; });
    let secondStarted = false;
    const first = coordinator.executeKnownOperation({
      kind: 'overwrite',
      destinationPath: filePath,
      perform: async () => {
        reportFirstStarted();
        await firstReleased;
        await fs.writeFile(filePath, 'one');
      },
    });
    await firstStarted;
    const second = coordinator.executeKnownOperation({
      kind: 'overwrite',
      destinationPath: filePath,
      perform: async () => {
        secondStarted = true;
        await fs.writeFile(filePath, 'two');
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(secondStarted).toBe(false);
    releaseFirst();
    await Promise.all([first, second]);
    expect(secondStarted).toBe(true);
    expect(await fs.readFile(filePath, 'utf8')).toBe('two');
    expect(lifecycle.run((repository) => repository.getAsset(original.assetId))?.revisions).toHaveLength(3);
    indexer.stop();
    lifecycle.close();
  });

  it('recovers catalog failure after filesystem success exactly once', async () => {
    const { userDataPath, rootA } = await workspace();
    const filePath = path.join(rootA, 'source.bin');
    await fs.writeFile(filePath, 'old');
    const runtime = createRuntime(userDataPath);
    const [original] = await registerRoot(runtime.indexer, rootA, ['source.bin']);
    const repository = (runtime.lifecycle as any).repository;
    const complete = repository.completeFileOperation.bind(repository);
    let failOnce = true;
    repository.completeFileOperation = (...args: unknown[]) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('synthetic catalog commit failure');
      }
      return complete(...args);
    };
    const output = Buffer.from('new');
    const result = await runtime.coordinator.executeKnownOperation({
      kind: 'overwrite',
      destinationPath: filePath,
      expectedOutputSha256: crypto.createHash('sha256').update(output).digest('hex'),
      perform: () => fs.writeFile(filePath, output),
    });
    expect(result.provenance).toMatchObject({ pending: true });
    expect(await fs.readFile(filePath, 'utf8')).toBe('new');
    expect(runtime.lifecycle.run((repo) => repo.getAsset(original.assetId))?.revisions).toHaveLength(1);

    repository.completeFileOperation = complete;
    const recovery = new StableIdentityFileOperationCoordinator({
      repositoryLifecycle: runtime.lifecycle,
      indexer: runtime.indexer,
      enabled: true,
    });
    expect(await recovery.initializeRecovery()).toMatchObject({ recovered: 1, pending: 0 });
    expect(await recovery.initializeRecovery()).toMatchObject({ recovered: 0, pending: 0 });
    expect(runtime.lifecycle.run((repo) => repo.getAsset(original.assetId))?.revisions).toHaveLength(2);
    runtime.indexer.stop();
    runtime.lifecycle.close();
  });

  it('preserves current filesystem behavior without journal writes when the flag is disabled', async () => {
    const { userDataPath, rootA } = await workspace();
    const sourcePath = path.join(rootA, 'source.bin');
    const destinationPath = path.join(rootA, 'renamed.bin');
    await fs.writeFile(sourcePath, 'bytes');
    const lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
    lifecycle.initialize();
    const indexer = new StableIdentityIndexer({ repositoryLifecycle: lifecycle, enabled: false });
    const coordinator = new StableIdentityFileOperationCoordinator({ repositoryLifecycle: lifecycle, indexer, enabled: false });

    await coordinator.executeKnownOperation({
      kind: 'rename', sourcePath, destinationPath, perform: () => fs.rename(sourcePath, destinationPath),
    });
    await expect(fs.stat(destinationPath)).resolves.toBeDefined();
    expect(lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);
    expect(lifecycle.run((repository) => repository.listLibraryRoots())).toHaveLength(0);
    lifecycle.close();
  });

  it('keeps the filesystem result when intent persistence is unavailable', async () => {
    const { userDataPath, rootA } = await workspace();
    const sourcePath = path.join(rootA, 'source.bin');
    const destinationPath = path.join(rootA, 'renamed.bin');
    await fs.writeFile(sourcePath, 'bytes');
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath, {
      coordinator: { logger: { error: () => {}, warn: () => {} } },
    });
    await registerRoot(indexer, rootA, ['source.bin']);
    const repository = (lifecycle as any).repository;
    repository.createFileOperationIntent = () => { throw new Error('synthetic journal failure'); };

    const result = await coordinator.executeKnownOperation({
      kind: 'rename', sourcePath, destinationPath, perform: () => fs.rename(sourcePath, destinationPath),
    });
    expect(result.provenance).toMatchObject({ enabled: true, available: false, error: 'synthetic journal failure' });
    await expect(fs.stat(destinationPath)).resolves.toBeDefined();
    expect(lifecycle.run((repo) => repo.listPendingFileOperations())).toHaveLength(0);
    indexer.stop();
    lifecycle.close();
  });

  it('reports catalog unavailability distinctly while preserving the file operation', async () => {
    const { rootA } = await workspace();
    const sourcePath = path.join(rootA, 'source.bin');
    const destinationPath = path.join(rootA, 'renamed.bin');
    await fs.writeFile(sourcePath, 'bytes');
    const coordinator = new StableIdentityFileOperationCoordinator({
      repositoryLifecycle: {
        getStatus: () => ({ available: false, error: new Error('synthetic catalog unavailable') }),
      },
      indexer: { enabled: false },
      enabled: true,
    });
    const result = await coordinator.executeKnownOperation({
      kind: 'rename', sourcePath, destinationPath, perform: () => fs.rename(sourcePath, destinationPath),
    });
    expect(result.provenance).toMatchObject({ enabled: true, available: false, error: 'synthetic catalog unavailable' });
    await expect(fs.stat(destinationPath)).resolves.toBeDefined();
  });

  it('stores the recovery journal outside disposable cache paths', async () => {
    const { userDataPath } = await workspace();
    const lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
    lifecycle.initialize();
    expect(resolveProvenanceCatalogPath(userDataPath)).toContain(path.join('provenance', 'catalog.sqlite'));
    expect(lifecycle.run((repository) => repository.getStatus().schemaVersion)).toBe(4);
    lifecycle.close();
  });

  it('runs the packaged-smoke scenario to completion with a synthetic profile', async () => {
    const { userDataPath, rootA } = await workspace();
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const result = await runStableIdentityFileOperationsSmoke({
      rootPath: rootA,
      userDataPath,
      repositoryLifecycle: lifecycle,
      indexer,
      coordinator,
    });
    expect(result).toMatchObject({ success: true, schemaVersion: 4, pendingOperations: 0 });
    indexer.stop();
    lifecycle.close();
  });
});

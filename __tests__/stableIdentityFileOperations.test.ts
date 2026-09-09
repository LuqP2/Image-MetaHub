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
import { StableIdentityUserDataService } from '../electron/stableIdentityUserDataService.mjs';
import { SUPPORTED_MEDIA_EXTENSIONS, inferMimeTypeFromName } from '../utils/mediaTypes.js';

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

  it.runIf(process.platform !== 'win32')('recognizes a case-only rename on a case-insensitive non-Windows volume', async () => {
    const { userDataPath, rootA } = await workspace();
    const sourcePath = path.join(rootA, 'Image.png');
    const destinationPath = path.join(rootA, 'image.png');
    await fs.writeFile(sourcePath, 'stable bytes');
    const runtime = createRuntime(userDataPath);
    const [original] = await registerRoot(runtime.indexer, rootA, ['Image.png']);
    await runtime.indexer.waitForIdle();

    const fileStat = await fs.stat(sourcePath);
    const aliasKey = path.resolve(sourcePath).toLocaleLowerCase('en-US');
    let actualPath = sourcePath;
    const coordinator = new StableIdentityFileOperationCoordinator({
      repositoryLifecycle: runtime.lifecycle,
      indexer: runtime.indexer,
      enabled: true,
      fileSystem: {
        stat: async (filePath: string) => (
          path.resolve(filePath).toLocaleLowerCase('en-US') === aliasKey ? fileStat : fs.stat(filePath)
        ),
        realpath: async (filePath: string) => (
          path.resolve(filePath).toLocaleLowerCase('en-US') === aliasKey ? actualPath : fs.realpath(filePath)
        ),
      },
    });

    const result = await coordinator.executeKnownOperation({
      kind: 'rename',
      sourcePath,
      destinationPath,
      perform: async () => {
        await fs.rename(sourcePath, destinationPath);
        actualPath = destinationPath;
      },
    });

    expect(result.provenance).toMatchObject({ enabled: true, available: true });
    expect(result.provenance.pending).not.toBe(true);
    const root = runtime.lifecycle.run((repository) => repository.listLibraryRoots()[0])!;
    expect(runtime.lifecycle.run((repository) => (
      repository.getLocationByRootPath(root.rootId, 'image.png')
    ))).toMatchObject({
      assetId: original.assetId,
      revisionId: original.revisionId,
      locationId: original.locationId,
      relativePath: 'image.png',
      state: 'present',
    });
    expect(runtime.lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);
    runtime.indexer.stop();
    runtime.lifecycle.close();
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

  it('recovers a copied user-data snapshot after renderer loss without overwriting a later destination edit', async () => {
    const { userDataPath, rootA, rootB } = await workspace();
    const sourcePath = path.join(rootA, 'source-with-user-data.bin');
    const destinationPath = path.join(rootB, 'copied-with-user-data.bin');
    await fs.writeFile(sourcePath, 'copy recovery bytes');
    const runtime = createRuntime(userDataPath, {
      coordinator: { logger: { error: () => {}, warn: () => {} } },
    });
    const [source] = await registerRoot(runtime.indexer, rootA, ['source-with-user-data.bin']);
    await registerRoot(runtime.indexer, rootB);
    runtime.lifecycle.run((repository) => repository.syncLegacyUserDataBatch([
      {
        domain: 'annotation', legacyImageId: 'legacy-source',
        payload: { isFavorite: true, tags: ['copied'], rating: 5, addedAt: 10, updatedAt: 20 },
        sourceVersion: 0,
      },
      {
        domain: 'shadow', legacyImageId: 'legacy-source',
        payload: { prompt: '', resources: [], tags: [], notes: '', updatedAt: 20 },
        sourceVersion: 0,
      },
    ]));

    const repository = (runtime.lifecycle as any).repository;
    const complete = repository.completeFileOperation.bind(repository);
    let failOnce = true;
    repository.completeFileOperation = (...args: unknown[]) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('synthetic lost renderer acknowledgement');
      }
      return complete(...args);
    };
    const copied = await runtime.coordinator.executeKnownOperation({
      kind: 'copy',
      sourcePath,
      destinationPath,
      userDataContext: { legacyImageId: 'legacy-source', copyUserData: true },
      perform: () => fs.copyFile(sourcePath, destinationPath),
    });
    expect(copied.provenance).toMatchObject({ pending: true });
    const [pending] = runtime.lifecycle.run((repo) => repo.listPendingFileOperations());
    expect(pending.payload.userDataSnapshot).toHaveLength(2);
    repository.completeFileOperation = complete;
    runtime.indexer.stop();
    runtime.lifecycle.close();

    const reopened = createRuntime(userDataPath);
    expect(await reopened.coordinator.initializeRecovery()).toMatchObject({ recovered: 1, pending: 0 });
    const destinationRoot = reopened.lifecycle.run((repo) => (
      repo.listLibraryRoots().find((entry) => entry.absolutePath === rootB)
    ))!;
    const destination = reopened.lifecycle.run((repo) => (
      repo.getLocationByRootPath(destinationRoot.rootId, 'copied-with-user-data.bin')
    ))!;
    expect(destination.assetId).not.toBe(source.assetId);
    const destinationReference = {
      assetId: destination.assetId,
      revisionId: destination.revisionId,
      locationId: destination.locationId,
    };
    const [annotation, shadow] = reopened.lifecycle.run((repo) => repo.syncLegacyUserDataBatch([
      { domain: 'annotation', legacyImageId: 'copy-ui-id', reference: destinationReference },
      { domain: 'shadow', legacyImageId: 'copy-ui-id', reference: destinationReference },
    ]));
    expect(annotation.record?.payload).toMatchObject({ isFavorite: true, tags: ['copied'], rating: 5, addedAt: 10 });
    expect(shadow.record?.payload).toMatchObject({ prompt: '', resources: [], tags: [], notes: '' });
    expect(shadow.record?.payload.updatedAt).toBeGreaterThan(20);

    const edited = reopened.lifecycle.run((repo) => repo.mutateAssetUserData({
      domain: 'annotation', legacyImageId: 'copy-ui-id', reference: destinationReference,
      expectedVersion: annotation.record.version,
      patch: { set: { rating: 2, updatedAt: 30 } },
    }));
    reopened.lifecycle.run((repo) => repo.completeFileOperation(pending.operationId));
    const afterRetry = reopened.lifecycle.run((repo) => repo.syncLegacyUserDataBatch([
      { domain: 'annotation', legacyImageId: 'copy-ui-id', reference: destinationReference },
    ]))[0].record;
    expect(afterRetry).toMatchObject({ version: edited.version, payload: { rating: 2 } });
    reopened.indexer.stop();
    reopened.lifecycle.close();
  });

  it('aborts an unchanged failed overwrite and immediately releases the destination', async () => {
    const { userDataPath, rootA } = await workspace();
    const destinationPath = path.join(rootA, 'destination.png');
    await fs.writeFile(destinationPath, 'old bytes');
    const runtime = createRuntime(userDataPath, {
      coordinator: { logger: { error: () => {}, warn: () => {} } },
    });
    const [original] = await registerRoot(runtime.indexer, rootA, ['destination.png']);
    const output = Buffer.from('new bytes');
    const expectedOutputSha256 = crypto.createHash('sha256').update(output).digest('hex');

    await expect(runtime.coordinator.executeKnownOperation({
      kind: 'overwrite',
      destinationPath,
      expectedOutputSha256,
      perform: async () => {
        throw Object.assign(new Error('synthetic access denied'), { code: 'EACCES' });
      },
    })).rejects.toMatchObject({ code: 'EACCES' });

    expect(await fs.readFile(destinationPath, 'utf8')).toBe('old bytes');
    expect(runtime.lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);
    expect(runtime.lifecycle.run((repository) => repository.getAsset(original.assetId))?.revisions).toHaveLength(1);

    await runtime.coordinator.executeKnownOperation({
      kind: 'overwrite',
      destinationPath,
      expectedOutputSha256,
      perform: () => fs.writeFile(destinationPath, output),
    });
    expect(await fs.readFile(destinationPath, 'utf8')).toBe('new bytes');
    expect(runtime.lifecycle.run((repository) => repository.getAsset(original.assetId))?.revisions).toHaveLength(2);
    runtime.indexer.stop();
    runtime.lifecycle.close();
  });

  it('persists the canonical MIME type for every supported media extension', async () => {
    const { userDataPath, rootA } = await workspace();
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    await registerRoot(indexer, rootA);
    const root = lifecycle.run((repository) => repository.listLibraryRoots()[0])!;

    for (const [index, extension] of SUPPORTED_MEDIA_EXTENSIONS.entries()) {
      const relativePath = `synthetic-${index}${extension}`;
      const destinationPath = path.join(rootA, relativePath);
      await coordinator.executeKnownOperation({
        kind: 'save_as',
        destinationPath,
        perform: () => fs.writeFile(destinationPath, `synthetic ${extension}`),
      });
      const location = lifecycle.run((repository) => (
        repository.getLocationByRootPath(root.rootId, relativePath)
      ))!;
      const asset = lifecycle.run((repository) => repository.getAsset(location.assetId))!;
      expect(asset.revisions.find((revision: any) => revision.revisionId === location.revisionId)?.mimeType)
        .toBe(inferMimeTypeFromName(relativePath));
    }

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

  it('completes the primary delete before confirmed permanent fallback removes the sidecar', async () => {
    const { userDataPath, rootA } = await workspace();
    const modelPath = path.join(rootA, 'model.glb');
    const sidecarPath = `${modelPath}.imagemetahub.json`;
    await Promise.all([fs.writeFile(modelPath, 'model'), fs.writeFile(sidecarPath, 'sidecar')]);
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [model] = await registerRoot(indexer, rootA, ['model.glb']);

    let operationError: any;
    try {
      await coordinator.executeKnownOperation({
        kind: 'delete',
        sourcePath: modelPath,
        perform: async () => {
          await fs.unlink(modelPath);
          throw Object.assign(new Error('synthetic sidecar trash failure'), {
            primaryDeleted: true,
            remainingPaths: [sidecarPath],
            trashAttempted: true,
          });
        },
      });
    } catch (error: any) {
      operationError = error;
    }

    expect(operationError).toMatchObject({
      message: 'synthetic sidecar trash failure',
      primaryDeleted: true,
      remainingPaths: [sidecarPath],
    });
    expect(operationError.provenanceOperationId).toBeUndefined();
    expect(lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);
    expect(lifecycle.run((repository) => repository.getAsset(model.assetId))?.state).toBe('deleted');
    await expect(fs.stat(sidecarPath)).resolves.toBeDefined();

    const fallback = await coordinator.continuePendingDelete({
      operationId: operationError.provenanceOperationId,
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

  it('keeps a failed sidecar when permanent fallback is cancelled without blocking the deleted primary', async () => {
    const { userDataPath, rootA } = await workspace();
    const modelPath = path.join(rootA, 'cancelled-model.glb');
    const sidecarPath = `${modelPath}.imagemetahub.json`;
    await Promise.all([fs.writeFile(modelPath, 'model'), fs.writeFile(sidecarPath, 'sidecar')]);
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [model] = await registerRoot(indexer, rootA, ['cancelled-model.glb']);
    lifecycle.run((repository) => repository.syncLegacyUserDataBatch([{
      domain: 'annotation', legacyImageId: 'reused-path-ui-id',
      reference: { assetId: model.assetId, revisionId: model.revisionId, locationId: model.locationId },
      payload: { isFavorite: true, tags: ['historical'], addedAt: 10, updatedAt: 20 },
      sourceVersion: 0,
    }]));

    await expect(coordinator.executeKnownOperation({
      kind: 'delete',
      sourcePath: modelPath,
      perform: async () => {
        await fs.unlink(modelPath);
        throw Object.assign(new Error('synthetic sidecar trash failure'), {
          primaryDeleted: true,
          remainingPaths: [sidecarPath],
          trashAttempted: true,
        });
      },
    })).rejects.toMatchObject({ primaryDeleted: true, remainingPaths: [sidecarPath] });

    expect(lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);
    expect(lifecycle.run((repository) => repository.getAsset(model.assetId))?.state).toBe('deleted');
    await expect(fs.stat(modelPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(sidecarPath, 'utf8')).resolves.toBe('sidecar');

    await fs.writeFile(modelPath, 'replacement');
    await coordinator.observeWatcherFiles({ rootPath: rootA, files: [await record(rootA, 'cancelled-model.glb')] });
    const root = lifecycle.run((repository) => repository.listLibraryRoots()[0]);
    const replacement = lifecycle.run((repository) => (
      repository.getLocationByRootPath(root.rootId, 'cancelled-model.glb')
    ))!;
    expect(replacement).toMatchObject({ state: 'present' });
    expect(replacement.assetId).not.toBe(model.assetId);
    const rebound = lifecycle.run((repository) => repository.syncLegacyUserDataBatch([{
      domain: 'annotation', legacyImageId: 'reused-path-ui-id',
      reference: { assetId: replacement.assetId, revisionId: replacement.revisionId, locationId: replacement.locationId },
    }]))[0];
    expect(rebound).toMatchObject({ status: 'ambiguous', record: null });
    indexer.stop();
    lifecycle.close();
  });

  it('keeps an unconfirmed absent delete pending during runtime and startup recovery', async () => {
    const { userDataPath, rootA } = await workspace();
    const filePath = path.join(rootA, 'ambiguous-delete.bin');
    await fs.writeFile(filePath, 'ambiguous');
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    await registerRoot(indexer, rootA, ['ambiguous-delete.bin']);
    await indexer.waitForIdle();

    let operationError: any;
    try {
      await coordinator.executeKnownOperation({
        kind: 'delete',
        sourcePath: filePath,
        perform: async () => {
          await fs.unlink(filePath);
          throw new Error('synthetic ambiguous delete failure');
        },
      });
    } catch (error: any) {
      operationError = error;
    }

    expect(operationError.provenanceOperationId).toBeTruthy();
    expect(lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(1);
    expect(await coordinator.initializeRecovery()).toMatchObject({ recovered: 0, pending: 1 });
    indexer.stop();
    lifecycle.close();
  });

  it('uses the common transition path for returned aborted and pending outcomes', async () => {
    const { userDataPath, rootA, rootB } = await workspace();
    const abortedSource = path.join(rootA, 'aborted-source.bin');
    const pendingSource = path.join(rootA, 'pending-source.bin');
    const pendingDestination = path.join(rootB, 'pending-destination.bin');
    await Promise.all([
      fs.writeFile(abortedSource, 'aborted'),
      fs.writeFile(pendingSource, 'pending'),
    ]);
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    await registerRoot(indexer, rootA, ['aborted-source.bin', 'pending-source.bin']);
    await registerRoot(indexer, rootB);
    await indexer.waitForIdle();

    const aborted = await coordinator.executeKnownOperation({
      kind: 'rename',
      sourcePath: abortedSource,
      destinationPath: path.join(rootA, 'never-created.bin'),
      perform: async () => undefined,
    });
    expect(aborted.provenance).toMatchObject({ pending: false });
    expect(lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);

    const pending = await coordinator.executeKnownOperation({
      kind: 'move',
      sourcePath: pendingSource,
      destinationPath: pendingDestination,
      perform: () => fs.copyFile(pendingSource, pendingDestination),
    });
    expect(pending.provenance).toMatchObject({ pending: true });
    expect(lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(1);
    indexer.stop();
    lifecycle.close();
  });

  it('preserves descendant identities, revisions, and user data across a nested directory rename', async () => {
    const { userDataPath, rootA } = await workspace();
    const sourceDirectory = path.join(rootA, '..archive ç');
    const destinationDirectory = path.join(rootA, 'renamed folder ç');
    await fs.mkdir(path.join(sourceDirectory, 'nested'), { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(sourceDirectory, 'inside.bin'), 'inside'),
      fs.writeFile(path.join(sourceDirectory, 'nested', 'second.bin'), 'second'),
    ]);
    const { lifecycle, indexer, coordinator, mappings } = createRuntime(userDataPath);
    const originals = await registerRoot(indexer, rootA, ['..archive ç/inside.bin', '..archive ç/nested/second.bin']);
    await indexer.waitForIdle();
    lifecycle.run((repository) => repository.syncLegacyUserDataBatch([
      {
        domain: 'annotation', legacyImageId: 'legacy-inside',
        reference: { assetId: originals[0].assetId, revisionId: originals[0].revisionId, locationId: originals[0].locationId },
        payload: { isFavorite: true, tags: ['kept'], rating: 4, addedAt: 1, updatedAt: 2 }, sourceVersion: 0,
      },
      {
        domain: 'shadow', legacyImageId: 'legacy-inside',
        reference: { assetId: originals[0].assetId, revisionId: originals[0].revisionId, locationId: originals[0].locationId },
        payload: { prompt: '', seed: 0, tags: [], notes: 'kept', updatedAt: 2 }, sourceVersion: 0,
      },
    ]));

    const result = await coordinator.executeKnownOperation({
      kind: 'rename',
      sourcePath: sourceDirectory,
      destinationPath: destinationDirectory,
      perform: () => fs.rename(sourceDirectory, destinationDirectory),
    });

    expect(result.provenance).toMatchObject({ enabled: true, available: true });
    expect(result.provenance.pending).not.toBe(true);
    expect(lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);
    const root = lifecycle.run((repository) => repository.listLibraryRoots()[0]);
    for (const [index, relativePath] of ['renamed folder ç/inside.bin', 'renamed folder ç/nested/second.bin'].entries()) {
      expect(lifecycle.run((repository) => repository.getLocationByRootPath(root.rootId, relativePath))).toMatchObject({
        assetId: originals[index].assetId,
        revisionId: originals[index].revisionId,
        locationId: originals[index].locationId,
        state: 'present',
      });
    }
    expect(mappings).toEqual(expect.arrayContaining(originals.map((identity) => expect.objectContaining({
      assetId: identity.assetId,
      revisionId: identity.revisionId,
      locationId: identity.locationId,
    }))));
    const snapshot = lifecycle.run((repository) => repository.captureAssetUserDataSnapshot(originals[0].assetId));
    expect(snapshot.find((entry) => entry.domain === 'annotation')?.payload)
      .toMatchObject({ isFavorite: true, tags: ['kept'], rating: 4 });
    expect(snapshot.find((entry) => entry.domain === 'shadow')?.payload)
      .toMatchObject({ prompt: '', seed: 0, tags: [], notes: 'kept' });
    indexer.stop();
    lifecycle.close();
  });

  it('relocates a registered root without changing descendant catalog paths or creating another root', async () => {
    const { userDataPath, rootA } = await workspace();
    const nestedPath = path.join('sub folder', 'nested', 'inside.bin');
    await fs.mkdir(path.dirname(path.join(rootA, nestedPath)), { recursive: true });
    await fs.writeFile(path.join(rootA, nestedPath), 'inside');
    const runtime = createRuntime(userDataPath);
    const [original] = await registerRoot(runtime.indexer, rootA, [nestedPath]);
    const nestedRegisteredRootPath = path.join(rootA, 'sub folder');
    const [nestedOriginal] = await registerRoot(runtime.indexer, nestedRegisteredRootPath, ['nested/inside.bin']);
    const originalRoots = runtime.lifecycle.run((repository) => repository.listLibraryRoots());
    const originalRoot = originalRoots.find((root) => root.absolutePath === rootA)!;
    const originalNestedRoot = originalRoots.find((root) => root.absolutePath === nestedRegisteredRootPath)!;
    const destinationRoot = path.join(path.dirname(rootA), 'Library renamed ç');

    await runtime.coordinator.executeKnownOperation({
      kind: 'rename', sourcePath: rootA, destinationPath: destinationRoot,
      perform: () => fs.rename(rootA, destinationRoot),
    });

    const roots = runtime.lifecycle.run((repository) => repository.listLibraryRoots());
    expect(roots).toHaveLength(2);
    const relocatedRoot = roots.find((root) => root.rootId === originalRoot.rootId)!;
    const relocatedNestedRoot = roots.find((root) => root.rootId === originalNestedRoot.rootId)!;
    expect(relocatedRoot).toMatchObject({ absolutePath: destinationRoot });
    expect(relocatedNestedRoot).toMatchObject({ absolutePath: path.join(destinationRoot, 'sub folder') });
    expect(runtime.lifecycle.run((repository) => repository.getLocationByRootPath(relocatedRoot.rootId, nestedPath.replace(/\\/g, '/'))))
      .toMatchObject({ assetId: original.assetId, revisionId: original.revisionId, locationId: original.locationId });
    expect(runtime.lifecycle.run((repository) => repository.getLocationByRootPath(relocatedNestedRoot.rootId, 'nested/inside.bin')))
      .toMatchObject({ assetId: nestedOriginal.assetId, revisionId: nestedOriginal.revisionId, locationId: nestedOriginal.locationId });
    runtime.indexer.stop();
    runtime.lifecycle.close();
  });

  it('recovers a directory rename after filesystem success and catalog failure without repeating the rename', async () => {
    const { userDataPath, rootA } = await workspace();
    const sourceDirectory = path.join(rootA, 'recover me');
    const destinationDirectory = path.join(rootA, 'recovered');
    await fs.mkdir(sourceDirectory);
    await fs.writeFile(path.join(sourceDirectory, 'inside.bin'), 'inside');
    const runtime = createRuntime(userDataPath, { coordinator: { logger: { error: () => {}, warn: () => {} } } });
    const [original] = await registerRoot(runtime.indexer, rootA, ['recover me/inside.bin']);
    const repository = (runtime.lifecycle as any).repository;
    const complete = repository.completeFileOperation.bind(repository);
    let failOnce = true;
    repository.completeFileOperation = (...args: unknown[]) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('synthetic directory catalog failure');
      }
      return complete(...args);
    };
    let filesystemCalls = 0;
    const result = await runtime.coordinator.executeKnownOperation({
      kind: 'rename', sourcePath: sourceDirectory, destinationPath: destinationDirectory,
      perform: async () => { filesystemCalls += 1; await fs.rename(sourceDirectory, destinationDirectory); },
    });
    expect(result.provenance).toMatchObject({ pending: true });
    expect(filesystemCalls).toBe(1);
    repository.completeFileOperation = complete;
    runtime.indexer.stop();
    runtime.lifecycle.close();

    const reopened = createRuntime(userDataPath);
    expect(await reopened.coordinator.initializeRecovery()).toMatchObject({ recovered: 1, pending: 0 });
    expect(await reopened.coordinator.initializeRecovery()).toMatchObject({ recovered: 0, pending: 0 });
    const root = reopened.lifecycle.run((repo) => repo.listLibraryRoots()[0]);
    expect(reopened.lifecycle.run((repo) => repo.getLocationByRootPath(root.rootId, 'recovered/inside.bin')))
      .toMatchObject({ assetId: original.assetId, revisionId: original.revisionId, locationId: original.locationId });
    expect(filesystemCalls).toBe(1);
    reopened.indexer.stop();
    reopened.lifecycle.close();
  });

  it('invalidates queued descendant hashes and stale scans while a directory rename is committed', async () => {
    const { userDataPath, rootA } = await workspace();
    const sourceDirectory = path.join(rootA, 'hashing');
    const destinationDirectory = path.join(rootA, 'hashed');
    await fs.mkdir(sourceDirectory);
    await fs.writeFile(path.join(sourceDirectory, 'inside.bin'), 'inside');
    let releaseHash!: () => void;
    let reportHashStarted!: () => void;
    const hashReleased = new Promise<void>((resolve) => { releaseHash = resolve; });
    const hashStarted = new Promise<void>((resolve) => { reportHashStarted = resolve; });
    const runtime = createRuntime(userDataPath, {
      indexer: {
        createReadStream: (filePath: string, options?: object) => Readable.from((async function* () {
          reportHashStarted();
          await hashReleased;
          for await (const chunk of fsSync.createReadStream(filePath, options)) yield chunk;
        })()),
      },
    });
    const staleToken = runtime.indexer.beginScan(rootA);
    const [original] = await registerRoot(runtime.indexer, rootA, ['hashing/inside.bin']);
    await hashStarted;
    const staleFiles = [await record(rootA, 'hashing/inside.bin')];

    await runtime.coordinator.executeKnownOperation({
      kind: 'rename', sourcePath: sourceDirectory, destinationPath: destinationDirectory,
      perform: () => fs.rename(sourceDirectory, destinationDirectory),
    });
    releaseHash();
    await runtime.indexer.waitForIdle();
    expect(await runtime.indexer.indexScan({
      rootPath: rootA, files: staleFiles, recursive: true, scanComplete: true, scanToken: staleToken,
    })).toMatchObject({ stale: true, assigned: 0, reconciled: false });
    expect(runtime.lifecycle.run((repository) => repository.getAsset(original.assetId))?.revisions[0].hashState).toBe('pending');
    runtime.indexer.stop();
    runtime.lifecycle.close();
  });

  it('keeps the legacy behavior and creates no journal when stable identity is disabled', async () => {
    const { userDataPath, rootA } = await workspace();
    const sourceDirectory = path.join(rootA, 'legacy');
    const destinationDirectory = path.join(rootA, 'legacy renamed');
    await fs.mkdir(sourceDirectory);
    const lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
    lifecycle.initialize();
    const indexer = new StableIdentityIndexer({ repositoryLifecycle: lifecycle, enabled: false });
    const coordinator = new StableIdentityFileOperationCoordinator({ repositoryLifecycle: lifecycle, indexer, enabled: false });
    const result = await coordinator.executeKnownOperation({
      kind: 'rename', sourcePath: sourceDirectory, destinationPath: destinationDirectory,
      perform: () => fs.rename(sourceDirectory, destinationDirectory),
    });
    expect(result.provenance).toEqual({ enabled: false, available: false });
    expect(lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);
    indexer.stop();
    lifecycle.close();
  });

  it('moves a subtree across registered roots and marks it missing when later moved out of scope', async () => {
    const { base, userDataPath, rootA, rootB } = await workspace();
    const sourceDirectory = path.join(rootA, 'source tree');
    const registeredDestination = path.join(rootB, 'moved tree');
    const outsideDestination = path.join(base, 'outside tree');
    await fs.mkdir(path.join(sourceDirectory, 'nested'), { recursive: true });
    await fs.writeFile(path.join(sourceDirectory, 'nested', 'inside.bin'), 'inside');
    const runtime = createRuntime(userDataPath);
    const [original] = await registerRoot(runtime.indexer, rootA, ['source tree/nested/inside.bin']);
    await registerRoot(runtime.indexer, rootB);

    await runtime.coordinator.executeKnownOperation({
      kind: 'move', sourcePath: sourceDirectory, destinationPath: registeredDestination,
      perform: async () => {
        await fs.cp(sourceDirectory, registeredDestination, { recursive: true });
        await fs.rm(sourceDirectory, { recursive: true });
      },
    });
    const roots = runtime.lifecycle.run((repository) => repository.listLibraryRoots());
    const rootBRecord = roots.find((root) => root.absolutePath === rootB)!;
    expect(runtime.lifecycle.run((repository) => repository.getLocationByRootPath(rootBRecord.rootId, 'moved tree/nested/inside.bin')))
      .toMatchObject({ assetId: original.assetId, revisionId: original.revisionId, locationId: original.locationId });

    await runtime.coordinator.executeKnownOperation({
      kind: 'move', sourcePath: registeredDestination, destinationPath: outsideDestination,
      perform: async () => {
        await fs.cp(registeredDestination, outsideDestination, { recursive: true });
        await fs.rm(registeredDestination, { recursive: true });
      },
    });
    expect(runtime.lifecycle.run((repository) => repository.getAsset(original.assetId))).toMatchObject({
      state: 'missing',
      locations: [expect.objectContaining({ locationId: original.locationId, state: 'missing' })],
    });
    expect(runtime.lifecycle.run((repository) => repository.listLibraryRoots())).toHaveLength(2);
    runtime.indexer.stop();
    runtime.lifecycle.close();
  });

  it('defers watcher observations below a directory operation and rejects the pre-operation scan', async () => {
    const { userDataPath, rootA } = await workspace();
    const sourceDirectory = path.join(rootA, 'watched');
    const destinationDirectory = path.join(rootA, 'watched renamed');
    await fs.mkdir(sourceDirectory);
    await fs.writeFile(path.join(sourceDirectory, 'inside.bin'), 'inside');
    const runtime = createRuntime(userDataPath);
    const [original] = await registerRoot(runtime.indexer, rootA, ['watched/inside.bin']);
    await runtime.indexer.waitForIdle();
    const staleToken = runtime.indexer.beginScan(rootA);
    const staleFiles = [await record(rootA, 'watched/inside.bin')];
    let reportRenamed!: () => void;
    let releaseOperation!: () => void;
    const renamed = new Promise<void>((resolve) => { reportRenamed = resolve; });
    const operationReleased = new Promise<void>((resolve) => { releaseOperation = resolve; });
    const operation = runtime.coordinator.executeKnownOperation({
      kind: 'rename', sourcePath: sourceDirectory, destinationPath: destinationDirectory,
      perform: async () => {
        await fs.rename(sourceDirectory, destinationDirectory);
        reportRenamed();
        await operationReleased;
      },
    });
    await renamed;
    await runtime.coordinator.observeWatcherRemovals({
      rootPath: rootA, files: [{ relativePath: 'watched/inside.bin' }],
    });
    await runtime.coordinator.observeWatcherFiles({
      rootPath: rootA,
      files: [{ relativePath: 'watched renamed/inside.bin', size: 6, lastModified: 0, contentModifiedMs: 0 }],
    });
    releaseOperation();
    await operation;

    expect(await runtime.indexer.indexScan({
      rootPath: rootA, files: staleFiles, recursive: true, scanComplete: true, scanToken: staleToken,
    })).toMatchObject({ stale: true, assigned: 0, reconciled: false });
    const root = runtime.lifecycle.run((repository) => repository.listLibraryRoots()[0]);
    expect(runtime.lifecycle.run((repository) => repository.getLocationByRootPath(root.rootId, 'watched renamed/inside.bin')))
      .toMatchObject({ assetId: original.assetId, revisionId: original.revisionId, locationId: original.locationId });
    runtime.indexer.stop();
    runtime.lifecycle.close();
  });

  it('aborts a denied directory rename without changing catalog state or leaving recovery work', async () => {
    const { userDataPath, rootA } = await workspace();
    const sourceDirectory = path.join(rootA, 'denied');
    const destinationDirectory = path.join(rootA, 'not moved');
    await fs.mkdir(sourceDirectory);
    await fs.writeFile(path.join(sourceDirectory, 'inside.bin'), 'inside');
    const runtime = createRuntime(userDataPath);
    const [original] = await registerRoot(runtime.indexer, rootA, ['denied/inside.bin']);
    await expect(runtime.coordinator.executeKnownOperation({
      kind: 'rename', sourcePath: sourceDirectory, destinationPath: destinationDirectory,
      perform: async () => { throw Object.assign(new Error('synthetic permission denied'), { code: 'EACCES' }); },
    })).rejects.toMatchObject({ code: 'EACCES' });
    const root = runtime.lifecycle.run((repository) => repository.listLibraryRoots()[0]);
    expect(runtime.lifecycle.run((repository) => repository.getLocationByRootPath(root.rootId, 'denied/inside.bin')))
      .toMatchObject({ assetId: original.assetId, revisionId: original.revisionId, locationId: original.locationId });
    expect(runtime.lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);
    runtime.indexer.stop();
    runtime.lifecycle.close();
  });

  it('rejects an existing directory destination before filesystem mutation or journal creation', async () => {
    const { userDataPath, rootA } = await workspace();
    const sourceDirectory = path.join(rootA, 'source');
    const destinationDirectory = path.join(rootA, 'destination');
    await Promise.all([fs.mkdir(sourceDirectory), fs.mkdir(destinationDirectory)]);
    await fs.writeFile(path.join(sourceDirectory, 'inside.bin'), 'inside');
    const runtime = createRuntime(userDataPath);
    await registerRoot(runtime.indexer, rootA, ['source/inside.bin']);
    let filesystemCalls = 0;
    await expect(runtime.coordinator.executeKnownOperation({
      kind: 'rename', sourcePath: sourceDirectory, destinationPath: destinationDirectory,
      perform: async () => { filesystemCalls += 1; },
    })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(filesystemCalls).toBe(0);
    expect(runtime.lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(0);
    runtime.indexer.stop();
    runtime.lifecycle.close();
  });

  it('keeps a partially copied directory move pending without relocating descendants', async () => {
    const { userDataPath, rootA, rootB } = await workspace();
    const sourceDirectory = path.join(rootA, 'partial');
    const destinationDirectory = path.join(rootB, 'partial');
    await fs.mkdir(sourceDirectory);
    await fs.writeFile(path.join(sourceDirectory, 'inside.bin'), 'inside');
    const runtime = createRuntime(userDataPath, { coordinator: { logger: { error: () => {}, warn: () => {} } } });
    const [original] = await registerRoot(runtime.indexer, rootA, ['partial/inside.bin']);
    await registerRoot(runtime.indexer, rootB);
    await expect(runtime.coordinator.executeKnownOperation({
      kind: 'move', sourcePath: sourceDirectory, destinationPath: destinationDirectory,
      perform: async () => {
        await fs.cp(sourceDirectory, destinationDirectory, { recursive: true });
        throw Object.assign(new Error('synthetic source removal failure'), { code: 'EACCES' });
      },
    })).rejects.toMatchObject({ code: 'EACCES', provenanceOperationId: expect.any(String) });
    expect(runtime.lifecycle.run((repository) => repository.listPendingFileOperations())).toHaveLength(1);
    const rootARecord = runtime.lifecycle.run((repository) => repository.listLibraryRoots().find((root) => root.absolutePath === rootA))!;
    expect(runtime.lifecycle.run((repository) => repository.getLocationByRootPath(rootARecord.rootId, 'partial/inside.bin')))
      .toMatchObject({ assetId: original.assetId, state: 'present' });
    expect(await runtime.coordinator.initializeRecovery()).toMatchObject({ recovered: 0, pending: 1 });
    runtime.indexer.stop();
    runtime.lifecycle.close();
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

  it('isolates inaccessible recovery entries and continues recovering later operations', async () => {
    const { userDataPath, rootA, rootB } = await workspace();
    const blockedSourcePath = path.join(rootA, 'blocked-source.bin');
    const blockedDestinationPath = path.join(rootB, 'blocked-destination.bin');
    const deletedPath = path.join(rootA, 'recoverable-delete.bin');
    await Promise.all([
      fs.writeFile(blockedSourcePath, 'blocked'),
      fs.writeFile(deletedPath, 'delete'),
    ]);
    const runtime = createRuntime(userDataPath, {
      coordinator: { logger: { error: () => {}, warn: () => {} } },
    });
    await registerRoot(runtime.indexer, rootA, ['blocked-source.bin', 'recoverable-delete.bin']);
    await registerRoot(runtime.indexer, rootB);

    await expect(runtime.coordinator.executeKnownOperation({
      kind: 'move',
      sourcePath: blockedSourcePath,
      destinationPath: blockedDestinationPath,
      perform: async () => {
        await fs.copyFile(blockedSourcePath, blockedDestinationPath);
        throw new Error('synthetic source delete failure');
      },
    })).rejects.toThrow('synthetic source delete failure');

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
    const deleted = await runtime.coordinator.executeKnownOperation({
      kind: 'delete',
      sourcePath: deletedPath,
      perform: () => fs.unlink(deletedPath),
    });
    expect(deleted.provenance).toMatchObject({ pending: true });
    repository.completeFileOperation = complete;

    const inaccessiblePaths = new Set([blockedSourcePath, blockedDestinationPath].map((value) => path.resolve(value)));
    const warnings: unknown[][] = [];
    const recovery = new StableIdentityFileOperationCoordinator({
      repositoryLifecycle: runtime.lifecycle,
      indexer: runtime.indexer,
      enabled: true,
      fileSystem: {
        stat: async (filePath: string) => {
          if (inaccessiblePaths.has(path.resolve(filePath))) {
            throw Object.assign(new Error('synthetic access denied'), { code: 'EACCES' });
          }
          return fs.stat(filePath);
        },
        realpath: (filePath: string) => fs.realpath(filePath),
      },
      logger: { warn: (...args: unknown[]) => warnings.push(args), error: () => {} },
    });

    expect(await recovery.initializeRecovery()).toMatchObject({ recovered: 1, pending: 1 });
    expect(warnings).toHaveLength(1);
    expect(runtime.lifecycle.run((repo) => repo.listPendingFileOperations())).toHaveLength(1);
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
    const staleToken = indexer.beginScan(rootA);
    const staleFiles = await Promise.all([
      record(rootA, 'folder_1/inside.bin'),
      record(rootA, 'folderX1/outside.bin'),
    ]);
    await fs.unlink(path.join(rootA, 'folder_1', 'inside.bin'));
    await fs.rmdir(path.join(rootA, 'folder_1'));

    await coordinator.observeWatcherRemovals({
      rootPath: rootA,
      folders: [{ relativePath: 'folder_1' }],
    });
    expect(await indexer.indexScan({
      rootPath: rootA,
      files: staleFiles,
      recursive: true,
      scanComplete: true,
      scanToken: staleToken,
    })).toMatchObject({ stale: true, assigned: 0, reconciled: false });
    expect(lifecycle.run((repository) => repository.getAsset(inside.assetId))?.state).toBe('missing');
    expect(lifecycle.run((repository) => repository.getAsset(outside.assetId))?.state).toBe('active');
    indexer.stop();
    lifecycle.close();
  });

  it('treats empty unlinkDir relative paths as removal of the watched root', async () => {
    const { userDataPath, rootA } = await workspace();
    await Promise.all([
      fs.writeFile(path.join(rootA, 'first.bin'), 'first'),
      fs.writeFile(path.join(rootA, 'second.bin'), 'second'),
    ]);
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const identities = await registerRoot(indexer, rootA, ['first.bin', 'second.bin']);
    await indexer.waitForIdle();
    const staleToken = indexer.beginScan(rootA);
    const staleFiles = await Promise.all(['first.bin', 'second.bin'].map((name) => record(rootA, name)));
    await fs.rm(rootA, { recursive: true });

    await coordinator.observeWatcherRemovals({
      rootPath: rootA,
      folders: [{ name: path.basename(rootA), relativePath: '' }],
    });

    expect(await indexer.indexScan({
      rootPath: rootA,
      files: staleFiles,
      recursive: true,
      scanComplete: true,
      scanToken: staleToken,
    })).toMatchObject({ stale: true, assigned: 0, reconciled: false });
    for (const identity of identities) {
      expect(lifecycle.run((repository) => repository.getAsset(identity.assetId))?.state).toBe('missing');
      expect(lifecycle.run((repository) => repository.getAsset(identity.assetId))?.state).not.toBe('deleted');
    }
    indexer.stop();
    lifecycle.close();
  });

  it('prevents stale scan assignment and reconciliation after immediate and deferred removals', async () => {
    const { userDataPath, rootA } = await workspace();
    const immediatePath = path.join(rootA, 'immediate.bin');
    const reconciledPath = path.join(rootA, 'before-reconcile.bin');
    const deferredPath = path.join(rootA, 'deferred.bin');
    await Promise.all([
      fs.writeFile(immediatePath, 'immediate'),
      fs.writeFile(reconciledPath, 'reconcile'),
      fs.writeFile(deferredPath, 'deferred'),
    ]);
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const [immediate, reconciled, deferred] = await registerRoot(indexer, rootA, [
      'immediate.bin',
      'before-reconcile.bin',
      'deferred.bin',
    ]);
    await indexer.waitForIdle();

    const beforeAssignmentToken = indexer.beginScan(rootA);
    const immediateRecord = await record(rootA, 'immediate.bin');
    await fs.unlink(immediatePath);
    await coordinator.observeWatcherRemovals({
      rootPath: rootA,
      files: [{ relativePath: 'immediate.bin' }],
    });
    expect(await indexer.indexScan({
      rootPath: rootA,
      files: [immediateRecord],
      recursive: true,
      scanComplete: true,
      scanToken: beforeAssignmentToken,
    })).toMatchObject({ stale: true, assigned: 0, reconciled: false });
    expect(lifecycle.run((repository) => repository.getAsset(immediate.assetId))?.state).toBe('missing');

    let releaseReconciliation!: () => void;
    let reportReconciliation!: () => void;
    const reconciliationReleased = new Promise<void>((resolve) => { releaseReconciliation = resolve; });
    const reconciliationReached = new Promise<void>((resolve) => { reportReconciliation = resolve; });
    const staleReconciliation = indexer.indexScan({
      rootPath: rootA,
      files: [await record(rootA, 'before-reconcile.bin'), await record(rootA, 'deferred.bin')],
      recursive: true,
      scanComplete: true,
      beforeReconcile: async () => {
        reportReconciliation();
        await reconciliationReleased;
      },
    });
    await reconciliationReached;
    await fs.unlink(reconciledPath);
    await coordinator.observeWatcherRemovals({
      rootPath: rootA,
      files: [{ relativePath: 'before-reconcile.bin' }],
    });
    releaseReconciliation();
    expect(await staleReconciliation).toMatchObject({ stale: true, reconciled: false });
    expect(lifecycle.run((repository) => repository.getAsset(reconciled.assetId))?.state).toBe('missing');

    let releaseDelete!: () => void;
    let reportDeleted!: () => void;
    const deleteReleased = new Promise<void>((resolve) => { releaseDelete = resolve; });
    const deleted = new Promise<void>((resolve) => { reportDeleted = resolve; });
    const internalDelete = coordinator.executeKnownOperation({
      kind: 'delete',
      sourcePath: deferredPath,
      perform: async () => {
        await fs.unlink(deferredPath);
        reportDeleted();
        await deleteReleased;
      },
    });
    await deleted;
    const beforeDeferredFlushToken = indexer.beginScan(rootA);
    const deferredRecord = { name: 'deferred.bin', size: 8, lastModified: 0, contentModifiedMs: 0, type: 'application/octet-stream' };
    await coordinator.observeWatcherRemovals({
      rootPath: rootA,
      files: [{ relativePath: 'deferred.bin' }],
    });
    releaseDelete();
    await internalDelete;
    expect(await indexer.indexScan({
      rootPath: rootA,
      files: [deferredRecord],
      recursive: true,
      scanComplete: true,
      scanToken: beforeDeferredFlushToken,
    })).toMatchObject({ stale: true, assigned: 0, reconciled: false });
    expect(lifecycle.run((repository) => repository.getAsset(deferred.assetId))?.state).toBe('deleted');
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
    const staleToken = indexer.beginScan(rootA);
    await coordinator.observeWatcherFiles({
      rootPath: rootA,
      files: [{ ...await record(rootA, 'source.bin'), provenanceBytesChanged: false }],
    });
    releaseWrite();
    await overwrite;

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

  it('coordinates an explicit unmapped rename for an already-migrated flag-off profile without scanning or hashing', async () => {
    const { userDataPath, rootA } = await workspace();
    const sourcePath = path.join(rootA, 'unmapped-before-rename.bin');
    const destinationPath = path.join(rootA, 'renamed-without-scan.bin');
    await fs.writeFile(sourcePath, 'known operation bytes');
    const lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
    lifecycle.initialize();
    lifecycle.run((repository) => {
      repository.activateUserDataAuthority();
      repository.syncLegacyUserDataBatch([{
        domain: 'annotation', legacyImageId: 'legacy-unmapped',
        payload: { isFavorite: true, tags: ['pending'], addedAt: 10, updatedAt: 20 },
        sourceVersion: 0,
      }]);
    });
    const indexer = new StableIdentityIndexer({ repositoryLifecycle: lifecycle, enabled: false });
    const coordinator = new StableIdentityFileOperationCoordinator({ repositoryLifecycle: lifecycle, indexer, enabled: true });

    const result = await coordinator.executeKnownOperation({
      kind: 'rename',
      sourcePath,
      destinationPath,
      userDataContext: {
        legacyImageId: 'legacy-unmapped',
        sourceRootPath: rootA,
        destinationRootPath: rootA,
      },
      perform: () => fs.rename(sourcePath, destinationPath),
    });
    expect(result.provenance).toMatchObject({ enabled: true, available: true });
    const root = lifecycle.run((repository) => repository.listLibraryRoots()[0]);
    const renamed = lifecycle.run((repository) => repository.getLocationByRootPath(root.rootId, 'renamed-without-scan.bin'))!;
    const record = lifecycle.run((repository) => repository.syncLegacyUserDataBatch([{
      domain: 'annotation', legacyImageId: 'legacy-unmapped',
      reference: { assetId: renamed.assetId, revisionId: renamed.revisionId, locationId: renamed.locationId },
    }]))[0].record;
    expect(record?.payload).toMatchObject({ isFavorite: true, tags: ['pending'] });
    expect(lifecycle.run((repository) => repository.getAsset(renamed.assetId))?.revisions[0].hashState).toBe('pending');
    await indexer.waitForIdle();
    indexer.stop();
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

  it('does not mutate the filesystem when stable user data requires an unavailable journal', async () => {
    const { rootA } = await workspace();
    const sourcePath = path.join(rootA, 'source-with-user-data.bin');
    const destinationPath = path.join(rootA, 'renamed-with-user-data.bin');
    await fs.writeFile(sourcePath, 'bytes');
    const coordinator = new StableIdentityFileOperationCoordinator({
      repositoryLifecycle: {
        getStatus: () => ({ available: false, error: new Error('synthetic catalog unavailable') }),
      },
      indexer: { enabled: false },
      enabled: true,
    });

    await expect(coordinator.executeKnownOperation({
      kind: 'rename',
      sourcePath,
      destinationPath,
      userDataContext: { legacyImageId: 'synthetic-ui-id' },
      perform: () => fs.rename(sourcePath, destinationPath),
    })).rejects.toThrow('synthetic catalog unavailable');
    await expect(fs.stat(sourcePath)).resolves.toBeDefined();
    await expect(fs.stat(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stores the recovery journal outside disposable cache paths', async () => {
    const { userDataPath } = await workspace();
    const lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
    lifecycle.initialize();
    expect(resolveProvenanceCatalogPath(userDataPath)).toContain(path.join('provenance', 'catalog.sqlite'));
    expect(lifecycle.run((repository) => repository.getStatus().schemaVersion)).toBe(5);
    lifecycle.close();
  });

  it('runs the packaged-smoke scenario to completion with a synthetic profile', async () => {
    const { userDataPath, rootA } = await workspace();
    const { lifecycle, indexer, coordinator } = createRuntime(userDataPath);
    const result = await runStableIdentityFileOperationsSmoke({
      rootPath: rootA,
      userDataPath,
      repositoryLifecycle: lifecycle,
      userDataService: (() => {
        const service = new StableIdentityUserDataService({
          repositoryLifecycle: lifecycle,
          userDataPath,
          migrationEnabled: true,
        });
        service.initialize();
        return service;
      })(),
      indexer,
      coordinator,
    });
    expect(result).toMatchObject({ success: true, schemaVersion: 5, pendingOperations: 0 });
    indexer.stop();
    lifecycle.close();
  });
});

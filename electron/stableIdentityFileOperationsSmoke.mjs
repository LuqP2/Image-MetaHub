import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProvenanceRepositoryLifecycle } from './provenanceRepository.mjs';
import { StableIdentityUserDataService } from './stableIdentityUserDataService.mjs';

function assertSmoke(condition, message) {
  if (!condition) throw new Error(`Packaged provenance smoke failed: ${message}`);
}

async function observedFile(rootPath, relativePath) {
  const stat = await fs.stat(path.join(rootPath, relativePath));
  return {
    name: relativePath,
    size: stat.size,
    lastModified: stat.mtimeMs,
    contentModifiedMs: stat.mtimeMs,
    type: 'application/octet-stream',
  };
}

export async function runStableIdentityFileOperationsSmoke({
  rootPath,
  userDataPath,
  repositoryLifecycle,
  userDataService,
  indexer,
  coordinator,
}) {
  if (!rootPath) throw new Error('A synthetic smoke root is required.');
  const syntheticRoot = path.resolve(rootPath);
  await fs.mkdir(syntheticRoot, { recursive: true });
  const sourcePath = path.join(syntheticRoot, 'original.bin');
  const renamedPath = path.join(syntheticRoot, 'renamed.bin');
  const copyPath = path.join(syntheticRoot, 'copy.bin');
  const directorySourcePath = path.join(syntheticRoot, '..archive ç');
  const directoryDestinationPath = path.join(syntheticRoot, 'renamed folder ç');
  const directoryRelativePath = '..archive ç/nested/inside.bin';
  const renamedDirectoryRelativePath = 'renamed folder ç/nested/inside.bin';
  await fs.mkdir(path.join(directorySourcePath, 'nested'), { recursive: true });
  await fs.writeFile(sourcePath, 'packaged synthetic bytes');
  await fs.writeFile(path.join(directorySourcePath, 'nested', 'inside.bin'), 'directory synthetic bytes');

  const scanToken = indexer.beginScan(syntheticRoot);
  const initialMappings = [];
  await indexer.indexScan({
    rootPath: syntheticRoot,
    files: await Promise.all([
      observedFile(syntheticRoot, 'original.bin'),
      observedFile(syntheticRoot, directoryRelativePath),
    ]),
    recursive: true,
    scanComplete: true,
    scanToken,
    onBatch: ({ mappings }) => initialMappings.push(...mappings),
  });
  const initial = initialMappings[0];
  const directoryInitial = initialMappings.find((mapping) => mapping.relativePath === directoryRelativePath);
  assertSmoke(initial?.assetId && initial?.revisionId && initial?.locationId, 'initial identity was not assigned');
  assertSmoke(directoryInitial?.assetId && directoryInitial?.revisionId && directoryInitial?.locationId, 'directory descendant identity was not assigned');

  assertSmoke(userDataService?.getStatus?.().authority === 'sqlite', 'stable user-data data service bridge is not authoritative');
  userDataService.syncLegacyBatch([
    {
      domain: 'annotation', legacyImageId: 'packaged-smoke-image',
      payload: { isFavorite: true, tags: ['packaged'], rating: 5, addedAt: 10, updatedAt: 20 },
      sourceVersion: 0,
    },
    {
      domain: 'shadow', legacyImageId: 'packaged-smoke-image',
      payload: { prompt: '', seed: 0, resources: [], tags: [], notes: '', updatedAt: 20 },
      sourceVersion: 0,
    },
  ]);
  userDataService.completeLegacyScan();
  userDataService.syncLegacyBatch([{
    domain: 'annotation',
    legacyImageId: 'packaged-directory-image',
    reference: {
      assetId: directoryInitial.assetId,
      revisionId: directoryInitial.revisionId,
      locationId: directoryInitial.locationId,
    },
    payload: { isFavorite: true, tags: ['directory'], rating: 4, addedAt: 11, updatedAt: 21 },
    sourceVersion: 0,
  }]);

  await coordinator.executeKnownOperation({
    kind: 'rename',
    sourcePath,
    destinationPath: renamedPath,
    userDataContext: { legacyImageId: 'packaged-smoke-image' },
    perform: () => fs.rename(sourcePath, renamedPath),
  });
  await coordinator.executeKnownOperation({
    kind: 'rename',
    sourcePath: directorySourcePath,
    destinationPath: directoryDestinationPath,
    perform: () => fs.rename(directorySourcePath, directoryDestinationPath),
  });
  await coordinator.executeKnownOperation({
    kind: 'copy',
    sourcePath: renamedPath,
    destinationPath: copyPath,
    userDataContext: { legacyImageId: 'packaged-smoke-image', copyUserData: true },
    perform: () => fs.copyFile(renamedPath, copyPath),
  });
  const copyBefore = await fs.stat(copyPath);
  const replacement = Buffer.from('packaged replacement!!');
  await coordinator.executeKnownOperation({
    kind: 'overwrite',
    destinationPath: copyPath,
    expectedOutputSha256: crypto.createHash('sha256').update(replacement).digest('hex'),
    perform: async () => {
      await fs.writeFile(copyPath, replacement);
      await fs.utimes(copyPath, copyBefore.atime, copyBefore.mtime);
    },
  });
  await indexer.waitForIdle();

  const snapshot = repositoryLifecycle.run((repository) => {
    const root = repository.listLibraryRoots().find((entry) => entry.absolutePath === syntheticRoot);
    assertSmoke(root, 'synthetic root was not registered');
    const renamed = repository.getLocationByRootPath(root.rootId, 'renamed.bin');
    const copied = repository.getLocationByRootPath(root.rootId, 'copy.bin');
    const renamedDirectoryDescendant = repository.getLocationByRootPath(root.rootId, renamedDirectoryRelativePath);
    const sourceAsset = repository.getAsset(initial.assetId);
    const copiedAsset = copied ? repository.getAsset(copied.assetId) : null;
    const copiedReference = copied ? {
      assetId: copied.assetId,
      revisionId: copied.revisionId,
      locationId: copied.locationId,
    } : null;
    const copiedAnnotation = copiedReference
      ? repository.syncLegacyUserDataBatch([{
          domain: 'annotation', legacyImageId: 'packaged-smoke-copy', reference: copiedReference,
        }])[0].record
      : null;
    const copiedShadow = copiedReference
      ? repository.syncLegacyUserDataBatch([{
          domain: 'shadow', legacyImageId: 'packaged-smoke-copy', reference: copiedReference,
        }])[0].record
      : null;
    const editedCopy = copiedReference && copiedAnnotation
      ? repository.mutateAssetUserData({
          domain: 'annotation', legacyImageId: 'packaged-smoke-copy', reference: copiedReference,
          expectedVersion: copiedAnnotation.version,
          patch: { set: { rating: 2, updatedAt: 30 } },
        })
      : null;
    return {
      root,
      renamed,
      copied,
      renamedDirectoryDescendant,
      directoryUserData: repository.captureAssetUserDataSnapshot(directoryInitial.assetId, 40),
      sourceAsset,
      copiedAsset,
      copiedAnnotation,
      copiedShadow,
      editedCopy,
      pendingOperations: repository.listPendingFileOperations(),
      status: repository.getStatus(),
    };
  });

  assertSmoke(snapshot.renamed?.assetId === initial.assetId, 'rename did not preserve the asset');
  assertSmoke(snapshot.renamed?.revisionId === initial.revisionId, 'rename did not preserve the revision');
  assertSmoke(snapshot.renamed?.locationId === initial.locationId, 'rename did not preserve the location');
  assertSmoke(snapshot.copied?.assetId !== initial.assetId, 'copy reused the source asset');
  assertSmoke(snapshot.renamedDirectoryDescendant?.assetId === directoryInitial.assetId, 'directory rename did not preserve the descendant asset');
  assertSmoke(snapshot.renamedDirectoryDescendant?.revisionId === directoryInitial.revisionId, 'directory rename did not preserve the descendant revision');
  assertSmoke(snapshot.renamedDirectoryDescendant?.locationId === directoryInitial.locationId, 'directory rename did not preserve the descendant location');
  assertSmoke(snapshot.directoryUserData.find((entry) => entry.domain === 'annotation')?.payload?.rating === 4, 'directory descendant annotation was not preserved');
  assertSmoke(snapshot.copiedAsset?.revisions.length === 2, 'overwrite did not create exactly one new revision');
  assertSmoke(snapshot.copiedAnnotation?.payload?.isFavorite === true, 'annotation was not copied');
  assertSmoke(snapshot.copiedShadow?.payload?.seed === 0, 'shadow metadata was not copied');
  assertSmoke(snapshot.editedCopy?.payload?.rating === 2, 'copied annotation was not independently editable');
  assertSmoke(snapshot.pendingOperations.length === 0, 'recovery journal contains pending operations');

  await indexer.waitForIdle();
  indexer.stop();
  repositoryLifecycle.close();
  const reopenedLifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
  reopenedLifecycle.initialize();
  const reopenedUserDataService = new StableIdentityUserDataService({
    repositoryLifecycle: reopenedLifecycle,
    userDataPath,
    migrationEnabled: false,
  });
  const reopenedUserDataStatus = reopenedUserDataService.initialize();
  const reopened = reopenedLifecycle.run((repository) => {
    const root = repository.listLibraryRoots().find((entry) => entry.absolutePath === syntheticRoot);
    const copied = root ? repository.getLocationByRootPath(root.rootId, 'copy.bin') : null;
    const renamedDirectoryDescendant = root ? repository.getLocationByRootPath(root.rootId, renamedDirectoryRelativePath) : null;
    const sourceData = repository.captureAssetUserDataSnapshot(initial.assetId, 40);
    const copiedData = copied ? repository.captureAssetUserDataSnapshot(copied.assetId, 40) : [];
    const directoryData = repository.captureAssetUserDataSnapshot(directoryInitial.assetId, 40);
    return { status: repository.getStatus(), copied, renamedDirectoryDescendant, sourceData, copiedData, directoryData };
  });
  reopenedLifecycle.close();
  assertSmoke(reopenedUserDataStatus.authority === 'sqlite', 'SQLite authority did not survive a flag-off reopen');
  assertSmoke(reopenedUserDataStatus.legacyScanComplete === true, 'legacy scan checkpoint did not survive reopen');
  assertSmoke(reopened.status.schemaVersion === 5, 'reopened catalog schema is not current');
  assertSmoke(reopened.sourceData.find((entry) => entry.domain === 'annotation')?.payload?.rating === 5, 'source annotation changed with its copy');
  assertSmoke(reopened.copiedData.find((entry) => entry.domain === 'annotation')?.payload?.rating === 2, 'copied annotation did not survive reopen');
  assertSmoke(reopened.copiedData.find((entry) => entry.domain === 'shadow')?.payload?.seed === 0, 'copied shadow metadata did not survive reopen');
  assertSmoke(reopened.renamedDirectoryDescendant?.assetId === directoryInitial.assetId, 'directory descendant identity did not survive reopen');
  assertSmoke(reopened.directoryData.find((entry) => entry.domain === 'annotation')?.payload?.rating === 4, 'directory descendant annotation did not survive reopen');

  return {
    success: true,
    versions: process.versions,
    paths: {
      userDataPath,
      databasePath: repositoryLifecycle.getStatus().databasePath,
      syntheticRoot,
      resourcesPath: process.resourcesPath,
      execPath: process.execPath,
      portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR || null,
    },
    identities: {
      sourceAssetId: initial.assetId,
      renamedRevisionId: snapshot.renamed.revisionId,
      copiedAssetId: snapshot.copied.assetId,
      copiedRevisionCount: snapshot.copiedAsset.revisions.length,
      directoryAssetId: directoryInitial.assetId,
      directoryRevisionId: directoryInitial.revisionId,
    },
    schemaVersion: snapshot.status.schemaVersion,
    pendingOperations: 0,
    userData: {
      authority: reopenedUserDataStatus.authority,
      legacyScanComplete: reopenedUserDataStatus.legacyScanComplete,
      sourceRating: 5,
      copiedRating: 2,
      copiedShadowSeed: 0,
      directoryRating: 4,
      reopened: true,
    },
  };
}

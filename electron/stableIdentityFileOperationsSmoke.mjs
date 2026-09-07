import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

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
  indexer,
  coordinator,
}) {
  if (!rootPath) throw new Error('A synthetic smoke root is required.');
  const syntheticRoot = path.resolve(rootPath);
  await fs.mkdir(syntheticRoot, { recursive: true });
  const sourcePath = path.join(syntheticRoot, 'original.bin');
  const renamedPath = path.join(syntheticRoot, 'renamed.bin');
  const copyPath = path.join(syntheticRoot, 'copy.bin');
  await fs.writeFile(sourcePath, 'packaged synthetic bytes');

  const scanToken = indexer.beginScan(syntheticRoot);
  const initialMappings = [];
  await indexer.indexScan({
    rootPath: syntheticRoot,
    files: [await observedFile(syntheticRoot, 'original.bin')],
    recursive: true,
    scanComplete: true,
    scanToken,
    onBatch: ({ mappings }) => initialMappings.push(...mappings),
  });
  const initial = initialMappings[0];
  assertSmoke(initial?.assetId && initial?.revisionId && initial?.locationId, 'initial identity was not assigned');

  await coordinator.executeKnownOperation({
    kind: 'rename', sourcePath, destinationPath: renamedPath, perform: () => fs.rename(sourcePath, renamedPath),
  });
  await coordinator.executeKnownOperation({
    kind: 'copy', sourcePath: renamedPath, destinationPath: copyPath, perform: () => fs.copyFile(renamedPath, copyPath),
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
    const sourceAsset = repository.getAsset(initial.assetId);
    const copiedAsset = copied ? repository.getAsset(copied.assetId) : null;
    return {
      root,
      renamed,
      copied,
      sourceAsset,
      copiedAsset,
      pendingOperations: repository.listPendingFileOperations(),
      status: repository.getStatus(),
    };
  });

  assertSmoke(snapshot.renamed?.assetId === initial.assetId, 'rename did not preserve the asset');
  assertSmoke(snapshot.renamed?.revisionId === initial.revisionId, 'rename did not preserve the revision');
  assertSmoke(snapshot.renamed?.locationId === initial.locationId, 'rename did not preserve the location');
  assertSmoke(snapshot.copied?.assetId !== initial.assetId, 'copy reused the source asset');
  assertSmoke(snapshot.copiedAsset?.revisions.length === 2, 'overwrite did not create exactly one new revision');
  assertSmoke(snapshot.pendingOperations.length === 0, 'recovery journal contains pending operations');

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
    },
    schemaVersion: snapshot.status.schemaVersion,
    pendingOperations: 0,
  };
}

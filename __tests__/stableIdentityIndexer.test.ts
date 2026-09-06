import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProvenanceRepositoryLifecycle } from '../electron/provenanceRepository.mjs';
import {
  StableIdentityIndexer,
  normalizeLibraryRootPath,
  normalizeRelativeCatalogPath,
} from '../electron/stableIdentityIndexer.mjs';
import { buildProvenanceIdentityLookupKey } from '../utils/provenancePath.mjs';
import { resetUserDataContents } from '../electron/cacheReset.mjs';

const temporaryDirectories: string[] = [];

type IdentityMapping = {
  relativePath: string;
  assetId: string;
  revisionId: string;
  locationId: string;
};

async function temporaryWorkspace() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-stable-identity-'));
  temporaryDirectories.push(workspace);
  const userDataPath = path.join(workspace, 'profile');
  const rootPath = path.join(workspace, 'Synthetic Library');
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.mkdir(rootPath, { recursive: true });
  return { userDataPath, rootPath };
}

async function fileRecord(rootPath: string, name: string) {
  const stat = await fs.stat(path.join(rootPath, name));
  return {
    name,
    lastModified: stat.mtimeMs,
    contentModifiedMs: stat.mtimeMs,
    size: stat.size,
    type: 'application/octet-stream',
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('StableIdentityIndexer', () => {
  it('preserves IDs across restart and cache reset without merging identical files', async () => {
    const { userDataPath, rootPath } = await temporaryWorkspace();
    await fs.writeFile(path.join(rootPath, 'first.bin'), 'identical synthetic bytes');
    await fs.writeFile(path.join(rootPath, 'second.bin'), 'identical synthetic bytes');
    const files = await Promise.all(['first.bin', 'second.bin'].map((name) => fileRecord(rootPath, name)));

    let lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
    lifecycle.initialize();
    let indexer = new StableIdentityIndexer({ repositoryLifecycle: lifecycle, enabled: true, batchSize: 1 });
    const firstMappings: IdentityMapping[] = [];
    await indexer.indexScan({
      rootPath,
      files,
      recursive: true,
      scanComplete: true,
      onBatch: ({ mappings }) => firstMappings.push(...mappings),
    });
    await indexer.waitForIdle();

    expect(firstMappings).toHaveLength(2);
    expect(firstMappings[0].assetId).not.toBe(firstMappings[1].assetId);
    const firstAsset = lifecycle.run((repository) => repository.getAsset(firstMappings[0].assetId));
    const secondAsset = lifecycle.run((repository) => repository.getAsset(firstMappings[1].assetId));
    expect(firstAsset?.revisions[0]).toMatchObject({ hashState: 'available' });
    expect(firstAsset?.revisions[0].sha256).toBe(secondAsset?.revisions[0].sha256);

    indexer.stop();
    lifecycle.close();
    await fs.writeFile(path.join(userDataPath, 'disposable-cache.json'), '{}');
    await resetUserDataContents({ userDataDir: userDataPath });

    lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
    lifecycle.initialize();
    indexer = new StableIdentityIndexer({ repositoryLifecycle: lifecycle, enabled: true });
    const reopenedMappings: IdentityMapping[] = [];
    await indexer.indexScan({
      rootPath,
      files,
      recursive: true,
      scanComplete: true,
      onBatch: ({ mappings }) => reopenedMappings.push(...mappings),
    });
    await indexer.waitForIdle();

    expect(reopenedMappings.map(({ assetId, revisionId }) => ({ assetId, revisionId })))
      .toEqual(firstMappings.map(({ assetId, revisionId }) => ({ assetId, revisionId })));
    expect(lifecycle.run((repository) => repository.getAsset(firstMappings[0].assetId))?.revisions).toHaveLength(1);

    await fs.writeFile(path.join(rootPath, 'first.bin'), 'changed synthetic bytes with a different size');
    const changedFiles = [await fileRecord(rootPath, 'first.bin'), files[1]];
    const changedMappings: IdentityMapping[] = [];
    await indexer.indexScan({
      rootPath,
      files: changedFiles,
      recursive: true,
      scanComplete: true,
      onBatch: ({ mappings }) => changedMappings.push(...mappings),
    });
    await indexer.waitForIdle();
    expect(changedMappings[0].assetId).toBe(firstMappings[0].assetId);
    expect(changedMappings[0].revisionId).not.toBe(firstMappings[0].revisionId);
    expect(lifecycle.run((repository) => repository.getAsset(firstMappings[0].assetId))?.revisions).toHaveLength(2);
    indexer.stop();
    lifecycle.close();
  });

  it('resumes pending hashes without duplicating revisions and discards stale reads', async () => {
    const { userDataPath, rootPath } = await temporaryWorkspace();
    await fs.writeFile(path.join(rootPath, 'changing.bin'), 'synthetic bytes');
    const record = await fileRecord(rootPath, 'changing.bin');
    const realStat = await fs.stat(path.join(rootPath, 'changing.bin'));
    let statCalls = 0;
    const lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
    lifecycle.initialize();
    let indexer = new StableIdentityIndexer({
      repositoryLifecycle: lifecycle,
      enabled: true,
      stat: async () => {
        statCalls += 1;
        return statCalls === 1
          ? realStat
          : { ...realStat, mtimeMs: realStat.mtimeMs + 1, isFile: () => true } as typeof realStat;
      },
    });
    const mappings: IdentityMapping[] = [];
    await indexer.indexScan({
      rootPath,
      files: [record],
      recursive: true,
      scanComplete: true,
      onBatch: ({ mappings: batch }) => mappings.push(...batch),
    });
    await indexer.waitForIdle();
    expect(lifecycle.run((repository) => repository.getAsset(mappings[0].assetId))?.revisions[0].hashState).toBe('pending');
    indexer.stop();

    indexer = new StableIdentityIndexer({ repositoryLifecycle: lifecycle, enabled: true });
    const resumedMappings: IdentityMapping[] = [];
    await indexer.indexScan({
      rootPath,
      files: [record],
      recursive: true,
      scanComplete: true,
      onBatch: ({ mappings: batch }) => resumedMappings.push(...batch),
    });
    await indexer.waitForIdle();
    expect(resumedMappings[0].revisionId).toBe(mappings[0].revisionId);
    expect(lifecycle.run((repository) => repository.getAsset(mappings[0].assetId))?.revisions).toMatchObject([
      { revisionId: mappings[0].revisionId, hashState: 'available' },
    ]);
    indexer.stop();
    lifecycle.close();
  });

  it('waits while paused and reconciles absence only after a complete root scan', async () => {
    const { userDataPath, rootPath } = await temporaryWorkspace();
    await fs.writeFile(path.join(rootPath, 'kept.bin'), 'kept');
    await fs.writeFile(path.join(rootPath, 'missing.bin'), 'missing');
    const files = await Promise.all(['kept.bin', 'missing.bin'].map((name) => fileRecord(rootPath, name)));
    const lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
    lifecycle.initialize();
    const indexer = new StableIdentityIndexer({ repositoryLifecycle: lifecycle, enabled: true });
    indexer.pause();
    const batches: Array<{ mappings: IdentityMapping[] }> = [];
    const initialScan = indexer.indexScan({
      rootPath,
      files,
      recursive: true,
      scanComplete: true,
      onBatch: (batch) => batches.push(batch),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(batches).toHaveLength(0);
    indexer.resume();
    await initialScan;
    await indexer.waitForIdle();
    const missingIdentity = batches.flatMap((batch) => batch.mappings).find((mapping) => mapping.relativePath === 'missing.bin');

    await indexer.indexScan({ rootPath, files: [files[0]], recursive: true, scanComplete: false });
    expect(lifecycle.run((repository) => repository.getAsset(missingIdentity.assetId))?.state).toBe('active');
    await indexer.indexScan({ rootPath, files: [files[0]], recursive: true, scanComplete: true });
    expect(lifecycle.run((repository) => repository.getAsset(missingIdentity.assetId))?.state).toBe('missing');
    indexer.stop();
    lifecycle.close();
  });

  it('normalizes separators and case keys without allowing root escape', () => {
    expect(normalizeRelativeCatalogPath('Folder\\Image.PNG', 'win32')).toEqual({
      relativePath: 'Folder/Image.PNG',
      relativePathKey: 'folder/image.png',
    });
    const decomposedPath = 'Cafe\u0301/Image.PNG';
    expect(normalizeRelativeCatalogPath(decomposedPath, 'linux').relativePath).toBe(decomposedPath);
    expect(buildProvenanceIdentityLookupKey('root', decomposedPath, 'linux'))
      .not.toBe(buildProvenanceIdentityLookupKey('root', 'Café/Image.PNG', 'linux'));
    expect(normalizeLibraryRootPath(`./${decomposedPath}`, 'linux').absolutePath.endsWith(decomposedPath.replace('/', path.sep)))
      .toBe(true);
    expect(() => normalizeRelativeCatalogPath('../outside.png', 'linux')).toThrow(/inside/);
    expect(() => normalizeRelativeCatalogPath('/outside.png', 'linux')).toThrow(/inside/);
  });
});

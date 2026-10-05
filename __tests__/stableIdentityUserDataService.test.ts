import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProvenanceRepositoryLifecycle } from '../electron/provenanceRepository.mjs';
import { AUTHORITY_MARKER_NAME, StableIdentityUserDataService } from '../electron/stableIdentityUserDataService.mjs';
import { PROVENANCE_DIRECTORY_NAME } from '../electron/provenancePaths.mjs';

const temporaryDirectories: string[] = [];

async function profile() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-user-data-authority-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('stable user-data authority routing', () => {
  it('leaves a new flag-off profile on legacy storage without creating migration state', async () => {
    const userDataPath = await profile();
    const lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
    lifecycle.initialize();
    const service = new StableIdentityUserDataService({ repositoryLifecycle: lifecycle, userDataPath, migrationEnabled: false });
    expect(service.initialize()).toMatchObject({ authority: 'legacy', available: true, migrationEnabled: false });
    await expect(fs.stat(path.join(userDataPath, PROVENANCE_DIRECTORY_NAME, AUTHORITY_MARKER_NAME)))
      .rejects.toMatchObject({ code: 'ENOENT' });
    lifecycle.close();
  });

  it('keeps SQLite authoritative after explicit migration even when the flag is later off', async () => {
    const userDataPath = await profile();
    const firstLifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
    firstLifecycle.initialize();
    const activated = new StableIdentityUserDataService({
      repositoryLifecycle: firstLifecycle, userDataPath, migrationEnabled: true,
    });
    expect(activated.initialize()).toMatchObject({ authority: 'sqlite', available: true, migrationEnabled: true });
    await expect(fs.stat(path.join(userDataPath, PROVENANCE_DIRECTORY_NAME, AUTHORITY_MARKER_NAME))).resolves.toBeDefined();
    firstLifecycle.close();

    const reopenedLifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
    reopenedLifecycle.initialize();
    const reopened = new StableIdentityUserDataService({
      repositoryLifecycle: reopenedLifecycle, userDataPath, migrationEnabled: false,
    });
    expect(reopened.initialize()).toMatchObject({
      authority: 'sqlite', available: true, migrationEnabled: false, indexingEnabled: false,
    });
    reopenedLifecycle.close();
  });

  it('reports a migrated profile as unavailable instead of silently falling back to legacy data', async () => {
    const userDataPath = await profile();
    const markerDirectory = path.join(userDataPath, PROVENANCE_DIRECTORY_NAME);
    await fs.mkdir(markerDirectory, { recursive: true });
    await fs.writeFile(path.join(markerDirectory, AUTHORITY_MARKER_NAME), JSON.stringify({ authority: 'sqlite', version: 1 }));
    const unavailableLifecycle = {
      getStatus: () => ({ available: false, error: { code: 'SYNTHETIC', message: 'synthetic catalog failure' } }),
    };
    const service = new StableIdentityUserDataService({
      repositoryLifecycle: unavailableLifecycle, userDataPath, migrationEnabled: false,
    });
    expect(service.initialize()).toEqual({
      initialized: true,
      authority: 'sqlite',
      available: false,
      migrationEnabled: false,
      indexingEnabled: false,
      legacyScanComplete: false,
      legacyScanCompletedAt: null,
      error: { code: 'SYNTHETIC', message: 'synthetic catalog failure' },
    });
    expect(() => service.getTagCounts()).toThrowError(expect.objectContaining({ code: 'USER_DATA_UNAVAILABLE' }));
  });
});

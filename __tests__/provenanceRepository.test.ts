import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetUserDataContents } from '../electron/cacheReset.mjs';
import {
  AssetProvenanceRepository,
  PROVENANCE_SCHEMA_VERSION,
  ProvenanceRepositoryLifecycle,
  resolveProvenanceCatalogPath,
} from '../electron/provenanceRepository.mjs';

const temporaryDirectories: string[] = [];
const sha = (character: string) => character.repeat(64);

async function temporaryUserData() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-provenance-repository-'));
  temporaryDirectories.push(directory);
  return directory;
}

function initialRecord(overrides: Record<string, unknown> = {}) {
  return {
    assetId: '11111111-1111-4111-8111-111111111111',
    revisionId: '22222222-2222-4222-8222-222222222222',
    locationId: '33333333-3333-4333-8333-333333333333',
    rootId: 'library-root',
    relativePath: 'images/original.png',
    byteSize: 1024,
    mimeType: 'image/png',
    width: 512,
    height: 512,
    contentModifiedMs: 1_788_000_000_000,
    ...overrides,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('AssetProvenanceRepository production contract', () => {
  it('persists stable assets, immutable revisions, locations and lifecycle states across restart', async () => {
    const userDataPath = await temporaryUserData();
    const databasePath = resolveProvenanceCatalogPath(userDataPath);
    let repository = new AssetProvenanceRepository({
      databasePath,
      now: () => new Date('2026-09-06T12:00:00.000Z'),
    });
    expect(repository.open()).toMatchObject({ state: 'ready', schemaVersion: PROVENANCE_SCHEMA_VERSION });

    const created = repository.createAssetWithRevisionAndLocation(initialRecord());
    expect(created).toMatchObject({
      assetId: initialRecord().assetId,
      state: 'active',
      revisions: [{ revisionId: initialRecord().revisionId, hashState: 'pending', sha256: null }],
      locations: [{ locationId: initialRecord().locationId, state: 'present' }],
    });
    expect(() => JSON.stringify(created)).not.toThrow();
    expect(() => repository.createAssetWithRevisionAndLocation(initialRecord({ assetId: 'path-based-id' })))
      .toThrowError(expect.objectContaining({ code: 'PROVENANCE_INVALID_INPUT' }));

    repository.completeRevisionHash(initialRecord().revisionId as string, { sha256: sha('a') });
    expect(() => repository.completeRevisionHash(initialRecord().revisionId as string, { sha256: sha('b') }))
      .toThrowError(expect.objectContaining({ code: 'PROVENANCE_REVISION_IMMUTABLE' }));
    const duplicateBytes = repository.createAssetWithRevisionAndLocation(initialRecord({
      assetId: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
      revisionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      locationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      relativePath: 'images/duplicate-bytes.png',
      sha256: sha('a'),
    }));
    expect(duplicateBytes.assetId).not.toBe(created.assetId);

    expect(repository.relocateLocation(initialRecord().locationId as string, {
      rootId: 'library-root',
      relativePath: 'renamed/original.png',
    })).toMatchObject({
      locationId: initialRecord().locationId,
      relativePath: 'renamed/original.png',
    });
    repository.markLocationMissing(initialRecord().locationId as string);
    expect(repository.getAsset(initialRecord().assetId as string)?.state).toBe('missing');

    const secondRevisionId = '44444444-4444-4444-8444-444444444444';
    repository.addRevision(initialRecord().assetId as string, {
      revisionId: secondRevisionId,
      locationId: initialRecord().locationId,
      byteSize: 2048,
      sha256: sha('c'),
      mimeType: 'image/png',
    });
    expect(repository.getAsset(initialRecord().assetId as string)).toMatchObject({
      state: 'active',
      locations: [{ revisionId: secondRevisionId, state: 'present' }],
    });
    repository.close();

    repository = new AssetProvenanceRepository({ databasePath });
    repository.open();
    expect(repository.getAsset(initialRecord().assetId as string)).toMatchObject({
      state: 'active',
      revisions: [{ revisionId: initialRecord().revisionId }, { revisionId: secondRevisionId }],
      locations: [{ relativePath: 'renamed/original.png', revisionId: secondRevisionId }],
    });
    expect(repository.markAssetDeleted(initialRecord().assetId as string)).toMatchObject({
      state: 'deleted',
      locations: [{ state: 'removed' }],
    });
    expect(() => repository.addRevision(initialRecord().assetId as string, { byteSize: 1 }))
      .toThrowError(expect.objectContaining({ code: 'PROVENANCE_ASSET_DELETED' }));
    expect(repository.createAssetWithRevisionAndLocation(initialRecord({
      assetId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      revisionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      locationId: '12121212-1212-4121-8121-121212121212',
      relativePath: 'renamed/original.png',
    }))).toMatchObject({ state: 'active' });
    repository.close();
  });

  it('normalizes filesystem timestamps while preserving opaque location whitespace', async () => {
    const databasePath = resolveProvenanceCatalogPath(await temporaryUserData());
    const repository = new AssetProvenanceRepository({ databasePath });
    repository.open();

    const created = repository.createAssetWithRevisionAndLocation(initialRecord({
      relativePath: ' images/original.png ',
      contentModifiedMs: 1_788_000_000_000.875,
    }));
    expect(created).toMatchObject({
      revisions: [{ contentModifiedMs: 1_788_000_000_000 }],
      locations: [{ relativePath: ' images/original.png ' }],
    });

    expect(repository.relocateLocation(initialRecord().locationId as string, {
      rootId: 'library-root',
      relativePath: ' renamed/original.png ',
    })).toMatchObject({ relativePath: ' renamed/original.png ' });
    expect(() => repository.relocateLocation(initialRecord().locationId as string, {
      rootId: 'library-root',
      relativePath: '   ',
    })).toThrowError(expect.objectContaining({ code: 'PROVENANCE_INVALID_INPUT' }));
    repository.close();
  });

  it('migrates v1 to v2 transactionally, preserves records and retries after rollback', async () => {
    const databasePath = resolveProvenanceCatalogPath(await temporaryUserData());
    let repository = new AssetProvenanceRepository({
      databasePath,
      now: () => new Date('2026-09-06T12:00:00.000Z'),
    });
    repository.open({ targetSchemaVersion: 1 });
    repository.database.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run('legacy-asset', 'active', 'now', 'now');
    repository.database.prepare(`
      INSERT INTO asset_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('legacy-revision', 'legacy-asset', sha('d'), 'available', 1, 'image/png', null, null, null, 'now', 'now');
    repository.close();

    repository = new AssetProvenanceRepository({ databasePath });
    expect(() => repository.open({ failMigrationVersion: 2 }))
      .toThrowError(expect.objectContaining({ code: 'PROVENANCE_MIGRATION_FAILED' }));

    repository = new AssetProvenanceRepository({ databasePath });
    repository.open({ targetSchemaVersion: 1 });
    expect(repository.getStatus().schemaVersion).toBe(1);
    expect(repository.database.prepare("SELECT name FROM sqlite_master WHERE name = 'asset_locations'").get()).toBeUndefined();
    expect(repository.database.prepare('SELECT asset_id FROM assets WHERE asset_id = ?').get('legacy-asset'))
      .toEqual({ asset_id: 'legacy-asset' });
    repository.close();

    repository = new AssetProvenanceRepository({ databasePath });
    repository.open();
    repository.applyMigrations();
    expect(repository.getStatus().schemaVersion).toBe(PROVENANCE_SCHEMA_VERSION);
    expect(repository.getAsset('legacy-asset')).toMatchObject({
      assetId: 'legacy-asset',
      revisions: [{ revisionId: 'legacy-revision' }],
      locations: [],
    });
    repository.close();
  });

  it('preserves a populated v2 catalog instead of guessing filesystem-root mappings', async () => {
    const databasePath = resolveProvenanceCatalogPath(await temporaryUserData());
    let repository = new AssetProvenanceRepository({ databasePath });
    repository.open({ targetSchemaVersion: 2 });
    repository.database.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)')
      .run('11111111-1111-4111-8111-111111111111', 'active', 'now', 'now');
    repository.database.prepare('INSERT INTO asset_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        null,
        'pending',
        1024,
        'image/png',
        null,
        null,
        1_788_000_000_000,
        'now',
        'now',
      );
    repository.database.prepare('INSERT INTO asset_locations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'legacy-library-root',
        'images/original.png',
        'present',
        'now',
        'now',
        null,
      );
    repository.close();

    repository = new AssetProvenanceRepository({ databasePath });
    expect(() => repository.open()).toThrowError(expect.objectContaining({
      code: 'PROVENANCE_MIGRATION_FAILED',
      message: expect.stringContaining('Schema-v2 locations cannot be associated with filesystem roots safely'),
      cause: expect.objectContaining({ code: 'PROVENANCE_LEGACY_LOCATIONS_UNMAPPABLE' }),
    }));

    repository = new AssetProvenanceRepository({ databasePath });
    repository.open({ targetSchemaVersion: 2 });
    expect(repository.getStatus().schemaVersion).toBe(2);
    expect(repository.database.prepare('SELECT * FROM asset_locations').get()).toMatchObject({
      location_id: '33333333-3333-4333-8333-333333333333',
      root_id: 'legacy-library-root',
      relative_path: 'images/original.png',
    });
    expect(repository.database.prepare("SELECT name FROM sqlite_master WHERE name = 'library_roots'").get()).toBeUndefined();
    repository.close();
  });

  it('creates a verified checkpointed backup and keeps the live writer usable', async () => {
    const userDataPath = await temporaryUserData();
    const lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath, logger: { error: vi.fn() } });
    expect(lifecycle.initialize()).toMatchObject({ available: true });
    lifecycle.run((repository) => repository.createAssetWithRevisionAndLocation(initialRecord({ sha256: sha('e') })));
    lifecycle.run((repository) => repository.syncLegacyUserDataBatch([{
      domain: 'annotation', legacyImageId: 'backup-ui-id',
      reference: {
        assetId: initialRecord().assetId,
        revisionId: initialRecord().revisionId,
        locationId: initialRecord().locationId,
      },
      payload: { isFavorite: true, tags: ['backup'], rating: 5, addedAt: 10, updatedAt: 20 },
      sourceVersion: 0,
    }]));

    const liveReader = new AssetProvenanceRepository({ databasePath: resolveProvenanceCatalogPath(userDataPath), readOnly: true });
    liveReader.open();
    liveReader.database.exec('BEGIN');
    expect(liveReader.getAsset(initialRecord().assetId as string)).not.toBeNull();

    lifecycle.run((repository) => repository.createAssetWithRevisionAndLocation(initialRecord({
      assetId: '55555555-5555-4555-8555-555555555555',
      revisionId: '66666666-6666-4666-8666-666666666666',
      locationId: '77777777-7777-4777-8777-777777777777',
      relativePath: 'images/before-backup.png',
      sha256: sha('f'),
    })));

    const backupPath = path.join(userDataPath, 'backups', 'provenance.sqlite');
    expect(lifecycle.createBackup(backupPath)).toMatchObject({ path: backupPath, schemaVersion: PROVENANCE_SCHEMA_VERSION, created: true });
    liveReader.database.exec('COMMIT');
    liveReader.close();
    lifecycle.run((repository) => repository.createAssetWithRevisionAndLocation(initialRecord({
      assetId: '88888888-8888-4888-8888-888888888888',
      revisionId: '99999999-9999-4999-8999-999999999999',
      locationId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      relativePath: 'images/after-backup.png',
      sha256: sha('a'),
    })));

    const backup = new AssetProvenanceRepository({ databasePath: backupPath, readOnly: true });
    backup.open();
    expect(backup.getAsset(initialRecord().assetId as string)).not.toBeNull();
    expect(backup.getAsset('55555555-5555-4555-8555-555555555555')).not.toBeNull();
    expect(backup.getAsset('88888888-8888-4888-8888-888888888888')).toBeNull();
    expect(backup.captureAssetUserDataSnapshot(initialRecord().assetId as string, 30)[0]?.payload)
      .toMatchObject({ isFavorite: true, tags: ['backup'], rating: 5, addedAt: 10 });
    backup.close();
    expect(lifecycle.run((repository) => repository.getAsset('88888888-8888-4888-8888-888888888888'))).not.toBeNull();
    lifecycle.close();
  });

  it('reopens the live database when backup copying fails', async () => {
    const userDataPath = await temporaryUserData();
    const lifecycle = new ProvenanceRepositoryLifecycle({
      userDataPath,
      logger: { error: vi.fn() },
      repositoryOptions: { backupDatabase: () => { throw new Error('synthetic backup failure'); } },
    });
    lifecycle.initialize();
    lifecycle.run((repository) => repository.createAssetWithRevisionAndLocation(initialRecord()));
    lifecycle.run((repository) => repository.syncLegacyUserDataBatch([{
      domain: 'annotation', legacyImageId: 'reset-ui-id',
      reference: {
        assetId: initialRecord().assetId,
        revisionId: initialRecord().revisionId,
        locationId: initialRecord().locationId,
      },
      payload: { isFavorite: false, tags: [], addedAt: 10, updatedAt: 20 },
      sourceVersion: 0,
    }]));

    expect(() => lifecycle.createBackup(path.join(userDataPath, 'backup.sqlite')))
      .toThrowError(expect.objectContaining({ code: 'PROVENANCE_BACKUP_FAILED' }));
    expect(lifecycle.run((repository) => repository.getAsset(initialRecord().assetId as string))).not.toBeNull();
    lifecycle.close();
  });
});

describe('provenance repository lifecycle and cache independence', () => {
  it('preserves the live catalog while cache reset removes disposable entries', async () => {
    const userDataPath = await temporaryUserData();
    const lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath, logger: { error: vi.fn() } });
    lifecycle.initialize();
    lifecycle.run((repository) => repository.createAssetWithRevisionAndLocation(initialRecord()));
    lifecycle.run((repository) => repository.syncLegacyUserDataBatch([{
      domain: 'annotation', legacyImageId: 'reset-ui-id',
      reference: {
        assetId: initialRecord().assetId,
        revisionId: initialRecord().revisionId,
        locationId: initialRecord().locationId,
      },
      payload: { isFavorite: false, tags: [], addedAt: 10, updatedAt: 20 },
      sourceVersion: 0,
    }]));
    await fs.writeFile(path.join(userDataPath, 'disposable-cache.json'), '{}', 'utf8');

    await resetUserDataContents({ userDataDir: userDataPath });
    await expect(fs.stat(path.join(userDataPath, 'disposable-cache.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(lifecycle.run((repository) => repository.getAsset(initialRecord().assetId as string))).not.toBeNull();
    lifecycle.close();

    const reopened = new ProvenanceRepositoryLifecycle({ userDataPath, logger: { error: vi.fn() } });
    expect(reopened.initialize()).toMatchObject({ available: true, schemaVersion: PROVENANCE_SCHEMA_VERSION });
    expect(reopened.run((repository) => repository.getAsset(initialRecord().assetId as string))).not.toBeNull();
    expect(reopened.run((repository) => repository.captureAssetUserDataSnapshot(initialRecord().assetId as string, 30))[0]?.payload)
      .toMatchObject({ isFavorite: false, tags: [], addedAt: 10 });
    reopened.close();
  });

  it('reports an unavailable catalog without replacing corrupt data or throwing from startup', async () => {
    const userDataPath = await temporaryUserData();
    const databasePath = resolveProvenanceCatalogPath(userDataPath);
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    const original = Buffer.from('existing data that is not a SQLite database');
    await fs.writeFile(databasePath, original);
    const logger = { error: vi.fn() };
    const lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath, logger });

    expect(() => lifecycle.initialize()).not.toThrow();
    expect(lifecycle.getStatus()).toMatchObject({
      state: 'unavailable',
      available: false,
      error: { code: 'PROVENANCE_OPEN_FAILED' },
    });
    expect(await fs.readFile(databasePath)).toEqual(original);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(() => lifecycle.run(() => null)).toThrowError(expect.objectContaining({ code: 'PROVENANCE_UNAVAILABLE' }));
  });

  it('preserves a newer incompatible catalog and its records', async () => {
    const userDataPath = await temporaryUserData();
    const databasePath = resolveProvenanceCatalogPath(userDataPath);
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    const database = new DatabaseSync(databasePath);
    database.exec('CREATE TABLE future_records (value TEXT NOT NULL); INSERT INTO future_records VALUES (\'keep-me\'); PRAGMA user_version = 99;');
    database.close();

    const lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath, logger: { error: vi.fn() } });
    expect(lifecycle.initialize()).toMatchObject({
      available: false,
      error: { code: 'PROVENANCE_SCHEMA_INCOMPATIBLE' },
    });
    const verification = new DatabaseSync(databasePath, { readOnly: true });
    expect(verification.prepare('SELECT value FROM future_records').get()).toEqual({ value: 'keep-me' });
    expect(verification.prepare('PRAGMA user_version').get()).toEqual({ user_version: 99 });
    verification.close();
  });
});

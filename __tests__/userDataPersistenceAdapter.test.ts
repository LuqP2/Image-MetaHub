import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IndexedImage } from '../types';
import { ProvenanceRepositoryLifecycle } from '../electron/provenanceRepository.mjs';
import { StableIdentityUserDataService } from '../electron/stableIdentityUserDataService.mjs';
import {
  clearAllAnnotations,
  saveAnnotation,
  saveShadowMetadata,
} from '../services/imageAnnotationsStorage';
import {
  __resetUserDataPersistenceAdapterForTests,
  hydrateUserDataForImages,
  loadAnnotationsForImages,
  patchAnnotation,
  patchShadowMetadata,
  registerStableUserDataImages,
} from '../services/userDataPersistenceAdapter';

const temporaryDirectories: string[] = [];
const lifecycles: ProvenanceRepositoryLifecycle[] = [];

const image = (identity: {
  imageId: string;
  assetId: string;
  revisionId: string;
  locationId: string;
}): IndexedImage => ({
  id: identity.imageId,
  name: 'synthetic.png',
  directoryId: 'synthetic-root',
  handle: {} as FileSystemFileHandle,
  metadata: {} as IndexedImage['metadata'],
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
  assetId: identity.assetId,
  revisionId: identity.revisionId,
  provenanceLocationId: identity.locationId,
});

async function stableBridge() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-user-data-adapter-'));
  temporaryDirectories.push(userDataPath);
  const lifecycle = new ProvenanceRepositoryLifecycle({ userDataPath });
  lifecycle.initialize();
  lifecycles.push(lifecycle);
  const ids = {
    rootId: '99999999-9999-4999-8999-999999999999',
    assetId: '11111111-1111-4111-8111-111111111111',
    revisionId: '22222222-2222-4222-8222-222222222222',
    locationId: '33333333-3333-4333-8333-333333333333',
  };
  lifecycle.run((repository) => {
    repository.ensureLibraryRoot({ rootId: ids.rootId, absolutePath: path.join(userDataPath, 'library'), pathKey: 'library' });
    repository.createAssetWithRevisionAndLocation({
      assetId: ids.assetId,
      revisionId: ids.revisionId,
      locationId: ids.locationId,
      rootId: ids.rootId,
      relativePath: 'synthetic.png',
      relativePathKey: 'synthetic.png',
      byteSize: 10,
    });
  });
  let rendererListener: ((payload: { records: any[] }) => void) | null = null;
  const service = new StableIdentityUserDataService({
    repositoryLifecycle: lifecycle,
    userDataPath,
    migrationEnabled: true,
    publishChanges: (payload) => rendererListener?.(payload),
  });
  service.initialize();
  const envelope = <T>(operation: () => T) => {
    try { return { success: true, value: operation() }; }
    catch (error: any) {
      return { success: false, error: error?.message, code: error?.code, details: error?.details ?? null };
    }
  };
  window.electronAPI = {
    stableUserDataStatus: async () => service.getStatus(),
    stableUserDataSync: async ({ entries }: any) => envelope(() => service.syncLegacyBatch(entries)),
    stableUserDataMutate: async (input: any) => envelope(() => service.mutate(input)),
    stableUserDataReserveLegacyMutation: async (input: any) => envelope(() => service.reserveLegacyMutation(input)),
    stableUserDataFinalizeLegacyMutation: async (input: any) => envelope(() => service.finalizeLegacyMutation(input)),
    stableUserDataCompleteLegacyScan: async () => envelope(() => service.completeLegacyScan()),
    stableUserDataGlobalTagMutation: async (input: any) => envelope(() => service.mutateAnnotationTagGlobally(input)),
    stableUserDataTagCounts: async () => envelope(() => service.getTagCounts()),
    onStableUserDataChanged: (listener: typeof rendererListener) => {
      rendererListener = listener;
      return () => { rendererListener = null; };
    },
  } as any;
  return { lifecycle, service, ids };
}

beforeEach(async () => {
  __resetUserDataPersistenceAdapterForTests();
  delete window.electronAPI;
  await clearAllAnnotations();
});

afterEach(async () => {
  __resetUserDataPersistenceAdapterForTests();
  delete window.electronAPI;
  for (const lifecycle of lifecycles.splice(0)) lifecycle.close();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('stable user-data persistence adapter', () => {
  it('stages the complete readable legacy source before checkpointing the profile scan', async () => {
    await saveAnnotation({
      imageId: 'unmapped-legacy-id', isFavorite: false, tags: [], addedAt: 11, updatedAt: 12,
    });
    await saveShadowMetadata({
      imageId: 'unmapped-legacy-id', prompt: '', resources: [], updatedAt: 13,
    });
    const { lifecycle, service, ids } = await stableBridge();

    await hydrateUserDataForImages([image({ imageId: 'mapped-without-source', ...ids })]);

    expect(service.getStatus()).toMatchObject({ legacyScanComplete: true });
    const pending = lifecycle.run((repository) => repository.database.prepare(`
      SELECT domain, legacy_image_id, payload_json, tombstone, state
      FROM legacy_user_data_pending
      WHERE legacy_image_id = ?
      ORDER BY domain
    `).all('unmapped-legacy-id'));
    expect(pending).toHaveLength(2);
    expect(pending.map((row: any) => ({
      domain: row.domain,
      payload: JSON.parse(row.payload_json),
      tombstone: row.tombstone,
      state: row.state,
    }))).toEqual([
      {
        domain: 'annotation',
        payload: { isFavorite: false, tags: [], addedAt: 11, updatedAt: 12 },
        tombstone: 0,
        state: 'pending',
      },
      {
        domain: 'shadow',
        payload: { prompt: '', resources: [], updatedAt: 13 },
        tombstone: 0,
        state: 'pending',
      },
    ]);

    const indexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
    try {
      const emptyAfterCheckpoint = await hydrateUserDataForImages([
        image({ imageId: 'mapped-without-source-after-checkpoint', ...ids }),
      ]);
      expect(emptyAfterCheckpoint.annotations.size).toBe(0);
      expect(emptyAfterCheckpoint.shadows.size).toBe(0);
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { value: indexedDb, configurable: true, writable: true });
    }
  });

  it('migrates legacy data, preserves explicit values, survives UI-id rename, and rejects path reuse', async () => {
    await saveAnnotation({
      imageId: 'legacy-ui-id', isFavorite: true, tags: ['embedded'], rating: 4, addedAt: 10, updatedAt: 20,
    });
    await saveShadowMetadata({
      imageId: 'legacy-ui-id', prompt: 'before', seed: 7, notes: 'before', updatedAt: 20,
    });
    const { lifecycle, ids } = await stableBridge();
    const original = image({ imageId: 'legacy-ui-id', ...ids });
    const hydrated = await hydrateUserDataForImages([original]);
    expect(hydrated.annotations.get(original.id)).toMatchObject({
      assetId: ids.assetId, isFavorite: true, tags: ['embedded'], rating: 4, addedAt: 10, updatedAt: 20,
    });
    expect(hydrated.shadows.get(original.id)).toMatchObject({ assetId: ids.assetId, prompt: 'before', seed: 7 });

    const annotation = await patchAnnotation(original.id, {
      set: { isFavorite: false },
      remove: ['rating'],
      removeTags: ['embedded'],
      suppressTags: ['embedded'],
    });
    expect(annotation).toMatchObject({ isFavorite: false, tags: [], suppressedMetadataTags: ['embedded'] });
    expect(annotation).not.toHaveProperty('rating');
    expect((await patchAnnotation(original.id, { importTags: ['embedded'] }))?.tags).toEqual([]);
    const shadow = await patchShadowMetadata(original, {
      set: { prompt: '', seed: 0, resources: [], tags: [], notes: '' },
    });
    expect(shadow).toMatchObject({ prompt: '', seed: 0, resources: [], tags: [], notes: '' });

    const renamed = image({ imageId: 'renamed-ui-id', ...ids });
    const afterRename = await hydrateUserDataForImages([renamed]);
    expect(afterRename.annotations.get(renamed.id)).toMatchObject({ isFavorite: false, tags: [] });
    expect(afterRename.shadows.get(renamed.id)).toMatchObject({ prompt: '', seed: 0, resources: [], tags: [], notes: '' });

    const indexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
    try {
      const durableOnly = image({ imageId: 'durable-without-legacy-backend', ...ids });
      const fromSqlite = await hydrateUserDataForImages([durableOnly]);
      expect(fromSqlite.annotations.get(durableOnly.id)).toMatchObject({ isFavorite: false, tags: [] });
      expect(fromSqlite.shadows.get(durableOnly.id)).toMatchObject({ prompt: '', seed: 0 });
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { value: indexedDb, configurable: true, writable: true });
    }

    const replacementIds = {
      assetId: '44444444-4444-4444-8444-444444444444',
      revisionId: '55555555-5555-4555-8555-555555555555',
      locationId: '66666666-6666-4666-8666-666666666666',
    };
    lifecycle.run((repository) => repository.createAssetWithRevisionAndLocation({
      ...replacementIds,
      rootId: ids.rootId,
      relativePath: 'replacement.png',
      relativePathKey: 'replacement.png',
      byteSize: 11,
    }));
    const reused = image({ imageId: 'legacy-ui-id', ...replacementIds });
    registerStableUserDataImages([reused]);
    const afterReuse = await hydrateUserDataForImages([reused]);
    expect(afterReuse.annotations.has(reused.id)).toBe(false);
    expect(afterReuse.shadows.has(reused.id)).toBe(false);
  });

  it('reports an unavailable migrated catalog instead of falling back to readable legacy data', async () => {
    await saveAnnotation({
      imageId: 'legacy-ui-id', isFavorite: true, tags: ['stale'], addedAt: 10, updatedAt: 20,
    });
    window.electronAPI = {
      stableUserDataStatus: async () => ({
        initialized: true,
        authority: 'sqlite',
        available: false,
        migrationEnabled: false,
        indexingEnabled: false,
        error: { message: 'synthetic catalog unavailable' },
      }),
    } as any;
    await expect(loadAnnotationsForImages([])).rejects.toThrow('synthetic catalog unavailable');
  });

  it('does not turn an unreadable, not-yet-migrated legacy record into a successful empty lookup', async () => {
    const { ids } = await stableBridge();
    const indexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
    try {
      await expect(hydrateUserDataForImages([image({ imageId: 'not-yet-migrated', ...ids })]))
        .rejects.toThrow('IndexedDB is unavailable');
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { value: indexedDb, configurable: true, writable: true });
    }
  });
});


it('reads unmapped annotations and shadows from SQLite after checkpoint and opt-out', async () => {
  await saveAnnotation({ imageId: 'pending-visible', isFavorite: true, tags: ['keep'], addedAt: 10, updatedAt: 20 });
  await saveShadowMetadata({ imageId: 'pending-visible', prompt: '', seed: 0, updatedAt: 20 });
  const { service } = await stableBridge();
  const unmapped = image({ imageId: 'pending-visible', assetId: '', revisionId: '', locationId: '' });
  await loadAnnotationsForImages([]);
  service.migrationEnabled = false;
  __resetUserDataPersistenceAdapterForTests();
  const indexedDb = globalThis.indexedDB;
  Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
  try {
    const hydrated = await hydrateUserDataForImages([unmapped]);
    expect(hydrated.annotations.get(unmapped.id)).toMatchObject({ isFavorite: true, tags: ['keep'] });
    expect(hydrated.shadows.get(unmapped.id)).toMatchObject({ prompt: '', seed: 0 });
  } finally {
    Object.defineProperty(globalThis, 'indexedDB', { value: indexedDb, configurable: true, writable: true });
  }
});

it.each(['rename', 'remove'] as const)('keeps global tag %s on pending data through retries and mapping', async (action) => {
  await saveAnnotation({ imageId: 'pending-tag', isFavorite: false, tags: ['old'], addedAt: 1, updatedAt: 2 });
  const { lifecycle, ids } = await stableBridge();
  const adapter = await import('../services/userDataPersistenceAdapter');
  // The global operation itself must stage the legacy source before changing it.
  await adapter.mutateAnnotationTagGlobally(action, 'old', action === 'rename' ? 'new' : undefined);
  const expectedTags = action === 'rename' ? ['new'] : [];
  const unmapped = image({ imageId: 'pending-tag', assetId: '', revisionId: '', locationId: '' });
  expect((await hydrateUserDataForImages([unmapped])).annotations.get(unmapped.id)?.tags).toEqual(expectedTags);
  lifecycle.run((repo) => repo.syncLegacyUserDataBatch([{
    domain: 'annotation', legacyImageId: unmapped.id, payload: { isFavorite: false, tags: ['old'], addedAt: 1, updatedAt: 2 }, sourceVersion: 0,
  }]));
  const mapped = image({ imageId: unmapped.id, ...ids });
  const hydrated = await hydrateUserDataForImages([mapped]);
  expect(hydrated.annotations.get(mapped.id)).toMatchObject({ tags: expectedTags, suppressedMetadataTags: ['old'] });
  expect((await patchAnnotation(mapped.id, { importTags: ['old'] }))?.tags).toEqual(expectedTags);
});

it('preserves simultaneous independent legacy patches and creates no migration outbox', async () => {
  await saveAnnotation({ imageId: 'legacy-concurrent', isFavorite: false, tags: [], addedAt: 1, updatedAt: 2 });
  await Promise.all([
    patchAnnotation('legacy-concurrent', { set: { isFavorite: true } }),
    patchAnnotation('legacy-concurrent', { addTags: ['keep'] }),
    patchShadowMetadata('legacy-concurrent', { set: { prompt: 'keep' } }),
    patchShadowMetadata('legacy-concurrent', { set: { seed: 0 } }),
  ]);
  const { getAnnotation, getShadowMetadata } = await import('../services/imageAnnotationsStorage');
  const { readLegacyUserDataSnapshot } = await import('../services/legacyUserDataMigrationSource');
  expect(await getAnnotation('legacy-concurrent')).toMatchObject({ isFavorite: true, tags: ['keep'] });
  expect(await getShadowMetadata('legacy-concurrent')).toMatchObject({ prompt: 'keep', seed: 0 });
  expect(await readLegacyUserDataSnapshot('annotation', 'legacy-concurrent')).toMatchObject({ sourceVersion: 0 });
  expect(await readLegacyUserDataSnapshot('annotation', 'legacy-concurrent')).not.toHaveProperty('mutationId');
});


it('confirms the projected pending tags after a later favorite edit', async () => {
  await saveAnnotation({ imageId: 'pending-edit', isFavorite: false, tags: ['old'], addedAt: 1, updatedAt: 2 });
  await stableBridge();
  const adapter = await import('../services/userDataPersistenceAdapter');
  await adapter.mutateAnnotationTagGlobally('rename', 'old', 'new');
  expect(await patchAnnotation('pending-edit', { set: { isFavorite: true } }))
    .toMatchObject({ isFavorite: true, tags: ['new'], suppressedMetadataTags: ['old'] });
});

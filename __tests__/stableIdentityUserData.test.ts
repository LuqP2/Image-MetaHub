import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetProvenanceRepository, resolveProvenanceCatalogPath } from '../electron/provenanceRepository.mjs';

const temporaryDirectories: string[] = [];
const openRepositories: AssetProvenanceRepository[] = [];
const ids = {
  root: '99999999-9999-4999-8999-999999999999',
  asset: '11111111-1111-4111-8111-111111111111',
  revision: '22222222-2222-4222-8222-222222222222',
  location: '33333333-3333-4333-8333-333333333333',
  assetB: '44444444-4444-4444-8444-444444444444',
  revisionB: '55555555-5555-4555-8555-555555555555',
  locationB: '66666666-6666-4666-8666-666666666666',
};

async function createRepository() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-stable-user-data-'));
  temporaryDirectories.push(userDataPath);
  const repository = new AssetProvenanceRepository({
    databasePath: resolveProvenanceCatalogPath(userDataPath),
    now: () => new Date('2026-09-07T12:00:00.000Z'),
  });
  repository.open();
  openRepositories.push(repository);
  repository.ensureLibraryRoot({ rootId: ids.root, absolutePath: path.join(userDataPath, 'library'), pathKey: 'synthetic-root' });
  repository.createAssetWithRevisionAndLocation({
    assetId: ids.asset,
    revisionId: ids.revision,
    locationId: ids.location,
    rootId: ids.root,
    relativePath: 'one.png',
    relativePathKey: 'one.png',
    byteSize: 10,
  });
  return repository;
}

const reference = {
  assetId: ids.asset,
  revisionId: ids.revision,
  locationId: ids.location,
};

const annotation = (overrides: Record<string, unknown> = {}) => ({
  isFavorite: false,
  tags: [],
  rating: 1,
  addedAt: 10,
  updatedAt: 20,
  suppressedMetadataTags: [],
  ...overrides,
});

afterEach(async () => {
  for (const repository of openRepositories.splice(0)) repository.close();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('stable identity user-data repository', () => {
  it('imports only through a trusted mapping while preserving false, zero and empty values', async () => {
    const repository = await createRepository();
    const pending = repository.syncLegacyUserDataBatch([{
      domain: 'annotation', legacyImageId: 'unmapped', payload: annotation(), sourceVersion: 0,
    }]);
    expect(pending).toMatchObject([{ status: 'pending', record: null }]);

    const [boundAnnotation, boundShadow] = repository.syncLegacyUserDataBatch([
      { domain: 'annotation', legacyImageId: 'image-1', reference, payload: annotation(), sourceVersion: 0 },
      {
        domain: 'shadow', legacyImageId: 'image-1', reference,
        payload: { prompt: '', seed: 0, resources: [], tags: [], notes: '', updatedAt: 20 }, sourceVersion: 0,
      },
    ]);
    expect(boundAnnotation.record?.payload).toEqual(annotation());
    expect(boundShadow.record?.payload).toEqual({ prompt: '', seed: 0, resources: [], tags: [], notes: '', updatedAt: 20 });
    repository.close();
  });

  it('makes retry and lost acknowledgements idempotent without changing source timestamps', async () => {
    const repository = await createRepository();
    const entry = { domain: 'annotation', legacyImageId: 'image-1', reference, payload: annotation(), sourceVersion: 0 };
    const first = repository.syncLegacyUserDataBatch([entry])[0].record;
    const retry = repository.syncLegacyUserDataBatch([entry])[0].record;
    expect(retry).toEqual(first);
    expect(retry?.version).toBe(1);
    expect(retry?.payload).toMatchObject({ addedAt: 10, updatedAt: 20 });
    repository.close();
  });

  it('merges distinct-field edits from stale versions and rejects same-field lost updates', async () => {
    const repository = await createRepository();
    repository.syncLegacyUserDataBatch([{
      domain: 'annotation', legacyImageId: 'image-1', reference, payload: annotation(), sourceVersion: 0,
    }]);
    repository.mutateAssetUserData({
      domain: 'annotation', legacyImageId: 'image-1', reference, expectedVersion: 1,
      patch: { set: { isFavorite: true, updatedAt: 21 } },
    });
    const rating = repository.mutateAssetUserData({
      domain: 'annotation', legacyImageId: 'image-1', reference, expectedVersion: 1,
      patch: { set: { rating: 5, updatedAt: 22 } },
    });
    expect(rating.payload).toMatchObject({ isFavorite: true, rating: 5 });
    expect(() => repository.mutateAssetUserData({
      domain: 'annotation', legacyImageId: 'image-1', reference, expectedVersion: 1,
      patch: { set: { isFavorite: false, updatedAt: 23 } },
    })).toThrowError(expect.objectContaining({
      code: 'USER_DATA_CONFLICT',
      details: { current: expect.objectContaining({ payload: expect.objectContaining({ isFavorite: true, rating: 5 }) }) },
    }));
    repository.close();
  });

  it('keeps tombstones authoritative over delayed legacy imports and metadata tag reimports', async () => {
    const repository = await createRepository();
    repository.syncLegacyUserDataBatch([{
      domain: 'annotation', legacyImageId: 'image-1', reference, payload: annotation({ tags: ['embedded'] }), sourceVersion: 0,
    }]);
    const removedTag = repository.mutateAssetUserData({
      domain: 'annotation', legacyImageId: 'image-1', reference, expectedVersion: 1,
      patch: { removeTags: ['embedded'], suppressTags: ['embedded'], set: { updatedAt: 21 } },
    });
    const reimport = repository.mutateAssetUserData({
      domain: 'annotation', legacyImageId: 'image-1', reference, expectedVersion: removedTag.version,
      patch: { importTags: ['embedded'], set: { updatedAt: 22 } },
    });
    expect(reimport.payload).toMatchObject({ tags: [], suppressedMetadataTags: ['embedded'] });

    const tombstone = repository.mutateAssetUserData({
      domain: 'annotation', legacyImageId: 'image-1', reference, expectedVersion: reimport.version,
      patch: { deleteRecord: true },
    });
    const delayed = repository.syncLegacyUserDataBatch([{
      domain: 'annotation', legacyImageId: 'image-1', reference,
      payload: annotation({ isFavorite: true, tags: ['embedded'] }), sourceVersion: 5,
    }])[0].record;
    expect(delayed).toEqual(tombstone);
    expect(delayed?.tombstone).toBe(true);
    repository.close();
  });

  it('serializes out-of-order legacy commits per field and finalizes each mutation once', async () => {
    const repository = await createRepository();
    repository.syncLegacyUserDataBatch([{
      domain: 'annotation', legacyImageId: 'image-1', reference, payload: annotation(), sourceVersion: 0,
    }]);
    const earlierId = '77777777-7777-4777-8777-777777777777';
    const laterId = '88888888-8888-4888-8888-888888888888';
    repository.reserveLegacyUserDataMutation({
      mutationId: earlierId, domain: 'annotation', legacyImageId: 'image-1',
      patch: { set: { isFavorite: true, updatedAt: 21 } },
    });
    repository.reserveLegacyUserDataMutation({
      mutationId: laterId, domain: 'annotation', legacyImageId: 'image-1',
      patch: { addTags: ['later'], set: { updatedAt: 22 } },
    });
    repository.finalizeLegacyUserDataMutation({
      mutationId: laterId, sourceVersion: 1, payload: annotation({ tags: ['later'], updatedAt: 22 }), tombstone: false,
    });
    const applied = repository.finalizeLegacyUserDataMutation({
      mutationId: earlierId, sourceVersion: 2,
      payload: annotation({ isFavorite: true, tags: ['later'], updatedAt: 21 }), tombstone: false,
    });
    expect(applied).toMatchObject({ state: 'applied', record: { payload: { isFavorite: true, tags: ['later'] } } });
    const final = repository.syncLegacyUserDataBatch([{ domain: 'annotation', legacyImageId: 'image-1', reference }])[0].record;
    expect(final?.payload).toMatchObject({ isFavorite: true, tags: ['later'], updatedAt: 22 });
    const retry = repository.finalizeLegacyUserDataMutation({
      mutationId: earlierId, sourceVersion: 2,
      payload: annotation({ isFavorite: true, tags: ['later'], updatedAt: 21 }), tombstone: false,
    });
    expect(retry.state).toBe('applied');
    repository.close();
  });

  it('marks a reused legacy path ambiguous instead of binding historical data to a new asset', async () => {
    const repository = await createRepository();
    repository.syncLegacyUserDataBatch([{
      domain: 'annotation', legacyImageId: 'same-path', reference, payload: annotation({ isFavorite: true }), sourceVersion: 0,
    }]);
    repository.createAssetWithRevisionAndLocation({
      assetId: ids.assetB, revisionId: ids.revisionB, locationId: ids.locationB,
      rootId: ids.root, relativePath: 'two.png', relativePathKey: 'two.png', byteSize: 11,
    });
    const outcome = repository.syncLegacyUserDataBatch([{
      domain: 'annotation', legacyImageId: 'same-path',
      reference: { assetId: ids.assetB, revisionId: ids.revisionB, locationId: ids.locationB },
    }])[0];
    expect(outcome).toMatchObject({ status: 'ambiguous', record: null });
    repository.close();
  });

  it('updates tags on historical assets without counting missing files in current-library facets', async () => {
    const repository = await createRepository();
    repository.syncLegacyUserDataBatch([{
      domain: 'annotation', legacyImageId: 'image-1', reference,
      payload: annotation({ tags: ['old-tag'] }), sourceVersion: 0,
    }]);
    repository.markLocationMissing(ids.location);

    expect(repository.getUserDataTagCounts()).toEqual([]);
    const changed = repository.mutateAnnotationTagGlobally({
      action: 'rename', sourceTag: 'old-tag', targetTag: 'new-tag', updatedAt: 30,
    });
    expect(changed).toHaveLength(1);
    expect(changed[0].payload).toMatchObject({ tags: ['new-tag'], suppressedMetadataTags: ['old-tag'] });
    repository.close();
  });
});


it.each(['delete-first', 'edit-first'] as const)('rejects stale shadow mutations across whole-record deletion: %s', async (order) => {
  const repository = await createRepository();
  repository.syncLegacyUserDataBatch([{ domain: 'shadow', legacyImageId: 'one', reference, payload: { prompt: 'initial', updatedAt: 1 }, sourceVersion: 0 }]);
  const deletion = { deleteRecord: true };
  const edit = { set: { prompt: 'new', updatedAt: 2 } };
  const first = repository.mutateAssetUserData({ domain: 'shadow', legacyImageId: 'one', reference, expectedVersion: 1, patch: order === 'delete-first' ? deletion : edit });
  expect(() => repository.mutateAssetUserData({ domain: 'shadow', legacyImageId: 'one', reference, expectedVersion: 1, patch: order === 'delete-first' ? edit : deletion }))
    .toThrowError(expect.objectContaining({ code: 'USER_DATA_CONFLICT' }));
  expect(repository.syncLegacyUserDataBatch([{ domain: 'shadow', legacyImageId: 'one', reference }])[0].record).toEqual(first);
  // An explicit retry using the confirmed current version remains valid.
  expect(repository.mutateAssetUserData({ domain: 'shadow', legacyImageId: 'one', reference, expectedVersion: first.version, patch: order === 'delete-first' ? edit : deletion }).tombstone)
    .toBe(order !== 'delete-first');
});

it.each(['before', 'after'] as const)('orders a pending source mutation reserved %s a global tag rename', async (order) => {
  const repository = await createRepository();
  repository.syncLegacyUserDataBatch([{ domain: 'annotation', legacyImageId: 'pending', payload: annotation({ tags: ['old'] }), sourceVersion: 0 }]);
  const mutationId = '77777777-7777-4777-8777-777777777777';
  const reserve = () => repository.reserveLegacyUserDataMutation({ mutationId, domain: 'annotation', legacyImageId: 'pending', patch: { unsuppressTags: ['old'], set: { tags: ['old'], updatedAt: 40 } } });
  if (order === 'before') reserve();
  repository.mutateAnnotationTagGlobally({ action: 'rename', sourceTag: 'old', targetTag: 'new', updatedAt: 30 });
  if (order === 'after') reserve();
  repository.finalizeLegacyUserDataMutation({ mutationId, sourceVersion: 1, payload: annotation({ tags: ['old'], updatedAt: 40 }), tombstone: false });
  const pending = repository.syncLegacyUserDataBatch([{ domain: 'annotation', legacyImageId: 'pending' }])[0].pending;
  const bound = repository.syncLegacyUserDataBatch([{ domain: 'annotation', legacyImageId: 'pending', reference }])[0].record;
  expect(bound?.payload).toEqual(pending?.payload);
  expect(bound?.payload?.tags).toEqual(order === 'before' ? ['new'] : ['old']);
});


it('keeps a global pending rename when a later source edit changes only favorite', async () => {
  const repository = await createRepository();
  repository.syncLegacyUserDataBatch([{ domain: 'annotation', legacyImageId: 'pending', payload: annotation({ tags: ['old'] }), sourceVersion: 0 }]);
  repository.mutateAnnotationTagGlobally({ action: 'rename', sourceTag: 'old', targetTag: 'new', updatedAt: 30 });
  const mutationId = '77777777-7777-4777-8777-777777777777';
  repository.reserveLegacyUserDataMutation({ mutationId, domain: 'annotation', legacyImageId: 'pending', patch: { set: { isFavorite: true, updatedAt: 40 } } });
  repository.finalizeLegacyUserDataMutation({ mutationId, sourceVersion: 1, payload: annotation({ isFavorite: true, tags: ['old'], updatedAt: 40 }), tombstone: false });
  repository.close();
  repository.open();
  expect(repository.syncLegacyUserDataBatch([{ domain: 'annotation', legacyImageId: 'pending' }])[0].pending?.payload)
    .toMatchObject({ isFavorite: true, tags: ['new'], updatedAt: 40 });
  expect(repository.syncLegacyUserDataBatch([{ domain: 'annotation', legacyImageId: 'pending', reference }])[0].record?.payload)
    .toMatchObject({ isFavorite: true, tags: ['new'], updatedAt: 40 });
});

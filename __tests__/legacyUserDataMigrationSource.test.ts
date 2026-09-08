import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllAnnotations, saveAnnotation } from '../services/imageAnnotationsStorage';
import { commitLegacyUserDataPatch, readLegacyUserDataSnapshot } from '../services/legacyUserDataMigrationSource';

describe('legacy user-data migration source', () => {
  beforeEach(async () => {
    await clearAllAnnotations();
  });

  it('commits source and retryable outbox together while preserving source timestamps and tombstones', async () => {
    await saveAnnotation({
      imageId: 'legacy-image',
      isFavorite: false,
      tags: ['old'],
      addedAt: 10,
      updatedAt: 20,
    });

    const first = await commitLegacyUserDataPatch(
      'annotation',
      'legacy-image',
      { set: { isFavorite: true, updatedAt: 21 }, removeTags: ['old'], suppressTags: ['old'] },
      '11111111-1111-4111-8111-111111111111',
    );
    expect(first).toMatchObject({
      sourceVersion: 1,
      tombstone: false,
      payload: { isFavorite: true, tags: [], addedAt: 10, updatedAt: 21, suppressedMetadataTags: ['old'] },
    });
    expect(await readLegacyUserDataSnapshot('annotation', 'legacy-image')).toEqual(first);

    const removed = await commitLegacyUserDataPatch(
      'annotation',
      'legacy-image',
      { deleteRecord: true },
      '22222222-2222-4222-8222-222222222222',
    );
    expect(removed).toMatchObject({ sourceVersion: 2, tombstone: true, payload: null });
    expect(await readLegacyUserDataSnapshot('annotation', 'legacy-image')).toEqual(removed);
  });
});

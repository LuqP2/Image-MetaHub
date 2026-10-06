import { describe, expect, it, vi } from 'vitest';
import { isWatchDue, modelFamily, parseCivitaiVersionLink, reconcileWatch, unreadVersions, versionDate } from '../services/modelLibrary/updateTracking';
import { normalizeModelSource } from '../services/modelLibrary/modelSourceStorage';
import { createModelLocalMetadata, promoteModelLocalMetadata } from '../services/modelLibrary/localMetadataStorage';
import { modelImageAssociation } from '../services/modelLibrary/imageAssociations';
import { normalizeRemoteVersion, retryAfterMs, fetchCivitaiJson, allowedCivitaiImage, fetchCivitaiImage } from '../electron/modelManagerRemote.mjs';
import type { CivitaiModelMetadata, ModelLocation, RemoteModelVersion } from '../services/modelLibrary/types';
import type { IndexedImage } from '../types';

const installed: CivitaiModelMetadata = { modelId: 1, versionId: 2, modelName: 'Example', versionName: 'Old preferred version', trainedWords: [], fetchedAt: 1, url: '', baseModel: 'SDXL', publishedAt: '2025-02-01' };
const version = (id: number, date?: string, baseModel = 'SDXL'): RemoteModelVersion => ({ id, name: `Arbitrary ${id}`, publishedAt: date, baseModel, description: '', url: '' });
const location: ModelLocation = { id: 's:example.safetensors', sourceId: 's', sourceKind: 'lora', sourceName: 'Models', relativePath: 'example.safetensors', absolutePath: '/synthetic/example.safetensors', fileName: 'example.safetensors', size: 100, createdAt: 1, modifiedAt: 1, discoveredAt: 1, lastSeenAt: 1 };

describe('model version tracking', () => {
  it('uses dates rather than names, IDs or provider ordering, and includes other families', () => {
    const versions = [version(800, '2024-01-01'), version(2, '2025-02-01'), version(1, '2025-03-01', 'Flux')];
    const watch = reconcileWatch(undefined, 1, 'Example', versions, [installed], 100);
    expect(watch.novelVersionIds).toEqual([1]);
    expect(modelFamily(versions[2], ['SDXL'])).toBe('Other base model');
    expect(modelFamily(versions[1], ['SDXL'])).toBe('Same family');
    expect(unreadVersions(watch).map((entry) => entry.id)).toEqual([1]);
  });
  it('uses newest installed version and suppresses installed variants', () => {
    const versions = [version(2, '2025-02-01'), version(3, '2025-03-01'), version(4, '2025-04-01')];
    expect(reconcileWatch(undefined, 1, 'Example', versions, [installed, { ...installed, versionId: 4 }], 100).novelVersionIds).toEqual([]);
  });
  it('preserves seen, ignored and notified versions across subsequent checks', () => {
    const first = reconcileWatch(undefined, 1, 'Example', [version(2, '2025-02-01'), version(3, '2025-03-01'), version(4, '2025-04-01')], [installed], 100);
    const restored = JSON.parse(JSON.stringify({ ...first, seenVersionIds: [3], ignoredVersionIds: [4], notifiedVersionIds: [3, 4] }));
    const next = reconcileWatch(restored, 1, 'Example', [...first.versions, version(5, '2025-05-01')], [installed], 200);
    expect(unreadVersions(next).map((entry) => entry.id)).toEqual([5]);
    expect(next.notifiedVersionIds).toEqual([3, 4]);
    expect(unreadVersions({ ...next, ignoredVersionIds: [] }).map((entry) => entry.id)).toEqual([4, 5]);
  });
  it('establishes a baseline without dates and flags only subsequent appearances', () => {
    const first = reconcileWatch(undefined, 1, 'Example', [version(2), version(3)], [{ ...installed, publishedAt: undefined }], 100);
    expect(first.chronologyUnknown).toBe(true);
    expect(first.novelVersionIds).toEqual([]);
    const next = reconcileWatch(first, 1, 'Example', [...first.versions, version(4)], [{ ...installed, publishedAt: undefined }], 200);
    expect(next.novelVersionIds).toEqual([4]);
  });
  it('falls back to creation and respects retry and check intervals', () => {
    expect(versionDate({ publishedAt: 'invalid', createdAt: '2025-01-01' })).toBe(Date.parse('2025-01-01'));
    const watch = reconcileWatch(undefined, 1, 'Example', [], [installed], 100);
    expect(isWatchDue(watch, 24, 1000)).toBe(false);
    expect(isWatchDue(watch, 24, 100 + 24 * 3600000)).toBe(true);
    expect(isWatchDue({ ...watch, retryAt: 100 + 48 * 3600000 }, 24, 100 + 24 * 3600000)).toBe(false);
  });
  it('does not turn an unsuccessful consultation into an undated publication baseline', () => {
    const failed = { ...reconcileWatch(undefined, 1, 'Example', [], [installed], 100), lastSuccessAt: undefined, error: 'Offline' };
    const firstSuccess = reconcileWatch(failed, 1, 'Example', [version(2), version(3)], [{ ...installed, publishedAt: undefined }], 200);
    expect(firstSuccess.novelVersionIds).toEqual([]);
    expect(firstSuccess.chronologyUnknown).toBe(true);
  });
  it('requires a trusted link to a concrete version', () => {
    expect(parseCivitaiVersionLink('https://civitai.com/models/1?modelVersionId=2')).toBe(2);
    expect(parseCivitaiVersionLink('https://civitai.com/models/1')).toBeNull();
    expect(parseCivitaiVersionLink('https://civitai.com.evil.test/models/1?modelVersionId=2')).toBeNull();
    expect(parseCivitaiVersionLink('https://civitai.com/models/1?modelVersionId=0')).toBeNull();
  });
});

describe('local model preferences and examples', () => {
  it('migrates folder defaults without enabling network activity', () => {
    const source = normalizeModelSource({ id: 's', path: '/synthetic/models' });
    expect(source.identifyOnScan).toBe(false);
    expect(source.watchUpdates).toBe(false);
  });
  it('preserves cover, examples, favorite, notes and watch override when promoting identity', () => {
    const preview = 'data:image/jpeg;base64,c3ludGhldGlj';
    const local = createModelLocalMetadata(location, { tags: [' test '], notes: 'Prefer old version', previewImage: preview, favorite: true, watchUpdates: false, examples: [{ id: 'e', origin: 'imported', preview, caption: 'Test' }] });
    const promoted = promoteModelLocalMetadata(local, 'a'.repeat(64));
    expect(promoted).toMatchObject({ id: `sha256:${'a'.repeat(64)}`, notes: local.notes, previewImage: preview, examples: local.examples, favorite: true, watchUpdates: false });
    expect(promoted.locationId).toBeUndefined();
  });
  it('never upgrades a name suggestion or abbreviated hash to a confirmed version', () => {
    const image = { models: [], loras: ['example'], metadata: { normalizedMetadata: {} } } as unknown as IndexedImage;
    expect(modelImageAssociation(image, location)).toBe('suggested');
    expect(modelImageAssociation({ ...image, loras: [{ name: 'example', hash: 'abc' }] } as IndexedImage, { ...location, sha256: 'abc' })).toBe('suggested');
    expect(modelImageAssociation({ ...image, loras: [{ name: 'example', hash: 'a'.repeat(64) }] } as IndexedImage, { ...location, sha256: 'a'.repeat(64) })).toBe('confirmed');
  });
});

describe('Civitai adapter', () => {
  it('normalizes optional version fields without trusting remote URLs', () => {
    expect(normalizeRemoteVersion({ id: 2, name: 'Version', description: '<p>Changes</p>', downloadUrl: 'https://untrusted.test' }, 1)).toMatchObject({ id: 2, description: 'Changes', url: 'https://civitai.com/models/1?modelVersionId=2' });
    expect(() => normalizeRemoteVersion({ id: '2' }, 1)).toThrow();
  });
  it('handles both Retry-After formats and surfaces restricted/unavailable states', async () => {
    expect(retryAfterMs('120', 0)).toBe(120000);
    expect(retryAfterMs('Thu, 01 Jan 1970 00:02:00 GMT', 0)).toBe(120000);
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '120' } }));
    await expect(fetchCivitaiJson('models/1', new AbortController().signal, fetcher)).rejects.toMatchObject({ status: 429, retryAfterMs: 120000 });
    fetcher.mockResolvedValue(new Response('', { status: 403 }));
    await expect(fetchCivitaiJson('models/1', new AbortController().signal, fetcher)).rejects.toThrow('restricted');
  });
  it('rejects untrusted image hosts and oversized streamed images', async () => {
    expect(allowedCivitaiImage('https://image.civitai.com/example')).toBe(true);
    expect(allowedCivitaiImage('https://image.civitai.com.evil.test/example')).toBe(false);
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/jpeg' } }));
    await expect(fetchCivitaiImage('https://image.civitai.com/example', new AbortController().signal, fetcher)).rejects.toThrow('too large');
  });
});

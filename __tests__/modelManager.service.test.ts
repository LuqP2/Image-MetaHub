import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelCatalog, ModelLocalMetadata, ModelSource } from '../services/modelLibrary/types';
import type { ImageScope, IndexedImage } from '../types';

const fakes = vi.hoisted(() => ({ sources: [] as ModelSource[], locals: [] as ModelLocalMetadata[], saveLocal: vi.fn(), images: [] as unknown[], scope: null as ImageScope | null, loading: false, enriching: false, notify: undefined as (() => void) | undefined }));
vi.mock('../store/useImageStore', () => {
  const getState = () => ({ images: fakes.images, activeImageScope: fakes.scope, isLoading: fakes.loading, enrichmentProgress: fakes.enriching ? { processed: 0, total: 1 } : null, setActiveImageScope: (scope: ImageScope) => { fakes.scope = scope; } });
  return { useImageStore: { getState, subscribe: (callback: (next: ReturnType<typeof getState>, previous: ReturnType<typeof getState>) => void) => { fakes.notify = () => callback(getState(), { ...getState(), images: [] }); return () => { fakes.notify = undefined; }; } } };
});
vi.mock('../services/thumbnailManager', () => ({ thumbnailManager: { getResolvedState: (image: { thumbnailUrl?: string }) => ({ thumbnailUrl: image.thumbnailUrl }) } }));
vi.mock('../services/modelLibrary/modelSourceStorage', () => ({ getAllModelSources: async () => fakes.sources, saveModelSource: async (value: ModelSource) => value, deleteModelSource: async () => {} }));
vi.mock('../services/modelLibrary/localMetadataStorage', async (original) => {
  const actual = await original<typeof import('../services/modelLibrary/localMetadataStorage')>();
  return { ...actual, getAllModelLocalMetadata: async () => fakes.locals, saveModelLocalMetadata: (value: ModelLocalMetadata) => fakes.saveLocal(value), deleteModelLocalMetadata: async () => {} };
});
vi.mock('../services/modelLibrary/watchStorage', () => ({ loadWatchPreferences: async () => ({ watches: [], intervalHours: 24 }), saveWatchPreference: async () => {} }));

const source: ModelSource = { id: 's', path: '/synthetic/models', name: 'Models', kind: 'lora', recursive: true, createdAt: 1, updatedAt: 1 };
const location = (name: string) => ({ id: `s:${name}.safetensors`, sourceId: 's', sourceKind: 'lora' as const, sourceName: 'Models', fileName: `${name}.safetensors`, relativePath: `${name}.safetensors`, absolutePath: `/synthetic/models/${name}.safetensors`, size: 100, modifiedAt: 1, createdAt: 1, discoveredAt: 1, lastSeenAt: 1, fileMetadata: { raw: {} }, civitai: { modelId: 1, versionId: 2, modelName: 'Test', versionName: 'Installed', trainedWords: [], fetchedAt: 1, url: '', publishedAt: '2025-01-01' } });
let catalog: ModelCatalog;
let cleanup: (() => void) | undefined;
let api: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.resetModules(); fakes.sources = [{ ...source }]; fakes.locals = []; fakes.images = [];
  fakes.scope = null; fakes.loading = false; fakes.enriching = false; fakes.notify = undefined;
  fakes.saveLocal.mockReset().mockImplementation(async (value) => value);
  catalog = { version: 1, locations: [location('one')], updatedAt: 1 };
  api = {
    modelManagerStoreMedia: vi.fn(async (reference) => ({ success: true, reference })),
    onModelManagerCommand: vi.fn(() => () => {}), modelManagerPublish: vi.fn(async () => ({ success: true })), modelManagerLoadPreferences: vi.fn(async () => null),
    modelManagerCommandResult: vi.fn(async () => {}),
    getJsonCacheData: vi.fn(async () => ({ success: true, data: catalog })), writeJsonCacheData: vi.fn(async () => ({ success: true })),
    modelLibrarySetRoots: vi.fn(async () => ({ success: true })), modelLibraryScan: vi.fn(async () => ({ success: true, results: [{ sourceId: 's', locations: catalog.locations }] })),
    modelLibraryReadMetadata: vi.fn(async () => ({ success: true, metadata: { raw: {} } })),
    modelLibraryHash: vi.fn(async () => ({ success: true, sha256: 'a'.repeat(64) })), modelLibraryCancelHash: vi.fn(async () => ({ success: true })),
    modelManagerCancelRemote: vi.fn(async () => {}), modelManagerImportMedia: vi.fn(async () => ({ success: true, preview: 'data:image/jpeg;base64,c3ludGhldGlj', name: 'Example' })),
    modelManagerRemote: vi.fn(async () => ({ success: true, modelName: 'Test', versions: [{ id: 2, name: 'Installed', publishedAt: '2025-01-01', description: '', url: '' }, { id: 3, name: 'New', publishedAt: '2025-02-01', description: '', url: '' }] })),
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers(); });
async function initialize() {
  const manager = await import('../services/modelLibrary/manager');
  cleanup = manager.startModelManager();
  await vi.waitFor(() => { expect(manager.getModelManagerState().loading).toBe(false); expect(manager.getModelManagerState().progress).toBeNull(); });
  return manager;
}

describe('single-owner model service', () => {
  it('shares usage with the Inspector and promotes an active Library descriptor after hashing', async () => {
    fakes.images = [{ id: 'synthetic-image', models: [], loras: ['one'], lastModified: 100, metadata: {} } as IndexedImage];
    const manager = await initialize();
    await vi.waitFor(() => expect(manager.modelItem(location('one').id).usage).toMatchObject({ totalCount: 1, nameMatchedCount: 1, status: 'ready' }));
    manager.setModelLibraryOpener((scope) => { fakes.scope = scope; });
    await manager.runModelCommand({ type: 'viewLibrary', locationId: location('one').id, mode: 'total' });
    expect(fakes.scope).toMatchObject({ type: 'managedModel', id: `location:${location('one').id}`, managedModel: { mode: 'total' } });
    await manager.runModelCommand({ type: 'hash', locationId: location('one').id });
    expect(fakes.scope).toMatchObject({ id: `sha256:${'a'.repeat(64)}`, managedModel: { locationIds: [location('one').id], mode: 'total' } });
    await vi.waitFor(() => expect(manager.getModelManagerState().usage?.[`sha256:${'a'.repeat(64)}`]).toMatchObject({ totalCount: 1, status: 'ready' }));
    await vi.waitFor(() => expect(api.modelManagerPublish.mock.calls.at(-1)?.[0].usage?.[`sha256:${'a'.repeat(64)}`]).toEqual(manager.modelItem(location('one').id).usage));
  });
  it('rebuilds partial image data and retains zero navigation after the last match disappears', async () => {
    const manager = await initialize();
    fakes.loading = true; fakes.enriching = true;
    fakes.images = [{ id: 'synthetic-image', models: [], loras: ['one'], lastModified: 100, metadata: {} } as IndexedImage]; fakes.notify?.();
    await vi.waitFor(() => expect(manager.modelItem(location('one').id).usage).toMatchObject({ status: 'partial', totalCount: 1 }));
    fakes.loading = false; fakes.enriching = false; fakes.images = []; fakes.notify?.();
    await vi.waitFor(() => expect(manager.modelItem(location('one').id).usage).toMatchObject({ status: 'ready', totalCount: 0, lastUsedAt: null }));
    const navigate = vi.fn(); manager.setModelLibraryOpener(navigate);
    await manager.runModelCommand({ type: 'viewLibrary', locationId: location('one').id, mode: 'confirmed' });
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ type: 'managedModel', managedModel: expect.objectContaining({ mode: 'confirmed' }) }));
    expect(api.modelLibraryHash).not.toHaveBeenCalled(); expect(api.modelManagerRemote).not.toHaveBeenCalled();
  });
  it('preserves a saved cover when refreshing the same Civitai version', async () => {
    const coverImage = `imh-model-media://media/${'c'.repeat(64)}.jpg`;
    catalog.locations[0].civitai = { ...location('one').civitai, coverImage };
    const manager = await initialize();
    api.modelManagerRemote.mockResolvedValue({ success: true, metadata: { ...location('one').civitai, versionName: 'Refreshed', coverImage: undefined } });
    await manager.runModelCommand({ type: 'identify', locationId: location('one').id });
    expect(manager.modelItem(location('one').id).location.civitai).toMatchObject({ versionName: 'Refreshed', coverImage });
    expect(api.modelManagerRemote.mock.calls.map(([args]) => args.kind)).toEqual(['hash']);
  });
  it('does not carry the old cover into a different Civitai version', async () => {
    catalog.locations[0].civitai = { ...location('one').civitai, coverImage: `imh-model-media://media/${'c'.repeat(64)}.jpg` };
    const manager = await initialize();
    api.modelManagerRemote.mockResolvedValue({ success: true, metadata: { ...location('one').civitai, versionId: 3 } });
    await manager.runModelCommand({ type: 'identify', locationId: location('one').id });
    const link = manager.modelItem(location('one').id).location.civitai;
    expect(link).toMatchObject({ versionId: 3 });
    expect(link && 'modelId' in link ? link.coverImage : undefined).toBeUndefined();
  });
  it('discards an identification response arriving after the user removes its link', async () => {
    const manager = await initialize();
    let complete!: (value: unknown) => void;
    api.modelManagerRemote.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const pending = manager.runModelCommand({ type: 'identify', locationId: location('one').id });
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    await manager.runModelCommand({ type: 'unbind', locationId: location('one').id });
    complete({ success: true, metadata: location('one').civitai });
    await pending;
    expect(manager.modelItem(location('one').id).location.civitai).toBeUndefined();
    expect(manager.modelItem(location('one').id).localMetadata?.watchUpdates).toBe(false);
    expect(manager.getModelManagerState().progress).toBeNull();
    // Removing a link must not prevent a later explicit identification.
    api.modelManagerRemote.mockResolvedValue({ success: true, metadata: location('one').civitai });
    await manager.runModelCommand({ type: 'identify', locationId: location('one').id });
    expect(manager.modelItem(location('one').id).location.civitai).toMatchObject({ modelId: 1, versionId: 2 });
  });
  it('saves local edits immediately but coalesces their full snapshot publication', async () => {
    vi.useFakeTimers();
    const manager = await initialize();
    // Drain the asynchronous initial usage publication before isolating local edits.
    await vi.advanceTimersByTimeAsync(300);
    api.modelManagerPublish.mockClear();
    fakes.saveLocal.mockClear();
    await manager.saveModelPatch(location('one').id, { notes: 'Keep this version' });
    await manager.saveModelPatch(location('one').id, { favorite: true });
    expect(fakes.saveLocal).toHaveBeenCalledTimes(2);
    expect(manager.modelItem(location('one').id).localMetadata).toMatchObject({ notes: 'Keep this version', favorite: true });
    expect(api.modelManagerPublish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(99);
    expect(api.modelManagerPublish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.modelManagerPublish).toHaveBeenCalledTimes(1);
    expect(api.modelManagerPublish.mock.calls[0][0].localMetadata[`location:${location('one').id}`]).toMatchObject({ notes: 'Keep this version', favorite: true });
  });
  it('stops automatic checks and rejects Inspector actions after access is revoked', async () => {
    const manager = await initialize();
    await manager.updateModelSource({ ...source, watchUpdates: true });
    await vi.waitFor(() => expect(manager.getModelManagerState().progress).toBeNull());
    cleanup?.();
    cleanup = undefined;
    api.modelManagerRemote.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 25 * 3600000);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(120000);
    expect(api.modelManagerRemote).not.toHaveBeenCalled();
    await expect(manager.runModelCommand({ type: 'check', locationId: location('one').id })).rejects.toThrow('requires Pro');
  });
  it('reports unlinked items without hashing again when identification was already offered', async () => {
    catalog.locations = [{ ...location('one'), civitai: undefined }];
    const manager = await initialize();
    await manager.checkModelUpdates([location('one').id], false, false);
    expect(api.modelLibraryHash).not.toHaveBeenCalled();
    expect(api.modelManagerRemote).not.toHaveBeenCalled();
    expect(manager.getModelManagerState().checkResult?.failedLocationIds).toEqual([location('one').id]);
  });
  it('marks only presented releases as viewed, counts models and leaves ignored releases ignored', async () => {
    const manager = await initialize();
    api.modelManagerRemote.mockResolvedValue({ success: true, modelName: 'Test', versions: [
      { id: 2, name: 'Installed', publishedAt: '2025-01-01', description: '', url: '' },
      { id: 3, name: 'New A', publishedAt: '2025-02-01', description: '', url: '' },
      { id: 4, name: 'New B', publishedAt: '2025-03-01', description: '', url: '' },
    ] });
    await manager.checkModelUpdates([location('one').id]);
    expect(manager.unreadModelCount()).toBe(1); // Models, not the two publications.
    await manager.runModelCommand({ type: 'seen', modelId: 1, versionIds: [3, 999] });
    expect(manager.getModelManagerState().watches['1'].seenVersionIds).toEqual([3]);
    expect(manager.unreadModelCount()).toBe(1);
    await manager.runModelCommand({ type: 'versionAction', modelId: 1, versionId: 4, action: 'ignore' });
    expect(manager.unreadModelCount()).toBe(0);
    expect(manager.getModelManagerState().watches['1'].ignoredVersionIds).toEqual([4]);
    expect(manager.getModelManagerState().watches['1'].versions).toHaveLength(3);
  });
  it('reports folder inheritance independently of the effective per-model override', async () => {
    fakes.sources = [{ ...source, watchUpdates: true }];
    const manager = await initialize();
    await manager.saveModelPatch(location('one').id, { watchUpdates: false });
    expect(manager.isModelWatched(manager.modelItem(location('one').id))).toBe(false);
    expect(manager.modelFolderWatchDefault(manager.modelItem(location('one').id))).toBe(true);
  });
  it('batches header writes instead of persisting the full catalog for every file', async () => {
    catalog.locations = Array.from({ length: 125 }, (_, index) => ({ ...location(String(index)), fileMetadata: undefined }));
    const manager = await initialize();
    expect(api.modelLibraryReadMetadata).toHaveBeenCalledTimes(125);
    expect(api.writeJsonCacheData).toHaveBeenCalledTimes(4); // Discovery + 50/50/25 completed headers.
    expect(manager.getModelManagerState().catalog.locations.every((item) => item.fileMetadata)).toBe(true);
  });
  it('flushes completed headers when their queue is cancelled', async () => {
    catalog.locations = Array.from({ length: 10 }, (_, index) => ({ ...location(String(index)), fileMetadata: undefined }));
    const manager = await import('../services/modelLibrary/manager');
    let reads = 0;
    api.modelLibraryReadMetadata.mockImplementation(async () => { if (++reads === 3) manager.cancelModelJob(); return { success: true, metadata: { raw: {} } }; });
    cleanup = manager.startModelManager();
    await vi.waitFor(() => expect(manager.getModelManagerState().progress).toBeNull());
    await vi.waitFor(() => expect(reads).toBe(3));
    expect(manager.getModelManagerState().catalog.locations.filter((item) => item.fileMetadata)).toHaveLength(3);
    expect(api.writeJsonCacheData).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ locations: manager.getModelManagerState().catalog.locations }) }));
  });
  it('loads a Civitai cover on demand once, shares it across copies and preserves a custom cover', async () => {
    catalog.locations.push(location('two'));
    const manager = await initialize();
    const custom = 'data:image/jpeg;base64,Y3VzdG9t';
    const preview = 'data:image/jpeg;base64,cmVtb3Rl';
    await manager.saveModelPatch(location('one').id, { previewImage: custom });
    api.modelManagerRemote.mockResolvedValue({ success: true, metadata: { ...location('one').civitai, coverImage: preview } });
    await manager.runModelCommand({ type: 'cover', locationId: location('one').id });
    await manager.runModelCommand({ type: 'cover', locationId: location('two').id });
    expect(api.modelManagerRemote).toHaveBeenCalledTimes(1);
    expect(api.modelManagerRemote).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cover', id: 2 }));
    expect(manager.getModelManagerState().catalog.locations.every((item) => item.civitai && 'coverImage' in item.civitai && item.civitai.coverImage === preview)).toBe(true);
    expect(manager.modelItem(location('one').id).localMetadata?.previewImage).toBe(custom);
    expect(api.modelManagerPublish).toHaveBeenCalledWith(expect.objectContaining({ catalog: expect.objectContaining({ locations: expect.arrayContaining([expect.objectContaining({ civitai: expect.objectContaining({ coverImage: preview }) })]) }) }));
  });
  it('reports unavailable remote covers without saving an empty cover', async () => {
    const manager = await initialize();
    api.modelManagerRemote.mockResolvedValue({ success: true, metadata: location('one').civitai });
    await expect(manager.runModelCommand({ type: 'cover', locationId: location('one').id })).rejects.toThrow('no available cover');
    expect(manager.getModelManagerState().progress).toBeNull();
    expect(manager.modelItem(location('one').id).location.civitai).not.toHaveProperty('coverImage');
  });
  it('loads Civitai examples and a default cover without overwriting a chosen cover', async () => {
    const manager = await initialize();
    const custom = 'data:image/jpeg;base64,Y3VzdG9t';
    const remoteCover = 'data:image/jpeg;base64,cmVtb3Rl';
    await manager.saveModelPatch(location('one').id, { previewImage: custom });
    api.modelManagerRemote.mockResolvedValue({ success: true, examples: [{ id: 'civitai:2:1', origin: 'civitai', preview: remoteCover, caption: '', versionId: 2 }] });
    await manager.runModelCommand({ type: 'examples', locationId: location('one').id });
    const item = manager.modelItem(location('one').id);
    expect(item.location.civitai).toMatchObject({ coverImage: remoteCover });
    expect(item.localMetadata).toMatchObject({ previewImage: custom, examples: [{ origin: 'civitai', versionId: 2 }] });
  });
  it('keeps legacy folders local and reads all headers independently of selection', async () => {
    catalog.locations = [location('one'), location('two')].map((item) => ({ ...item, fileMetadata: undefined }));
    const manager = await initialize();
    expect(api.modelLibraryReadMetadata).toHaveBeenCalledTimes(2);
    expect(api.modelLibraryHash).not.toHaveBeenCalled();
    expect(api.modelManagerRemote).not.toHaveBeenCalled();
    expect(manager.getModelManagerState().catalog.locations.every((item) => item.fileMetadata)).toBe(true);
  });
  it('queries each remote model once even when multiple installed versions are selected', async () => {
    catalog.locations.push({ ...location('two'), civitai: { ...location('two').civitai, versionId: 1 } });
    const manager = await initialize();
    await manager.checkModelUpdates(catalog.locations.map((item) => item.id));
    expect(api.modelManagerRemote).toHaveBeenCalledTimes(1);
    expect(manager.unreadModelCount()).toBe(1);
    expect(manager.getModelManagerState().showUpdates).toBe(true);
  });
  it('names the checked model in an individual result instead of showing an anonymous batch summary', async () => {
    const manager = await initialize();
    await manager.checkModelUpdates([location('one').id]);
    expect(manager.getModelManagerState().message).toContain('one.safetensors: new versions available');
    expect(manager.getModelManagerState().showUpdates).not.toBe(true);
  });
  it('serializes independent edits from two windows without dropping fields or hashing', async () => {
    const manager = await initialize();
    await Promise.all([manager.saveModelPatch(location('one').id, { notes: 'First window' }), manager.saveModelPatch(location('one').id, { favorite: true })]);
    expect(manager.modelItem(location('one').id).localMetadata).toMatchObject({ notes: 'First window', favorite: true });
    expect(api.modelLibraryHash).not.toHaveBeenCalled();
  });
  it('promotes the latest edits, cover and examples after a long hash request', async () => {
    const manager = await initialize();
    let complete!: (value: unknown) => void;
    api.modelLibraryHash.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const pending = manager.runModelCommand({ type: 'hash', locationId: location('one').id });
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    await manager.saveModelPatch(location('one').id, { notes: 'Edited during hashing', previewImage: 'data:image/jpeg;base64,eA==', examples: [{ id: 'e', origin: 'imported', caption: 'Keep', preview: 'data:image/jpeg;base64,eA==' }] });
    complete({ success: true, sha256: 'a'.repeat(64) }); await pending;
    expect(manager.modelItem(location('one').id).localMetadata).toMatchObject({ id: `sha256:${'a'.repeat(64)}`, notes: 'Edited during hashing', previewImage: 'data:image/jpeg;base64,eA==' });
    expect(manager.modelItem(location('one').id).localMetadata?.examples).toHaveLength(1);
  });
  it('preserves ignored decisions made during a remote request', async () => {
    const manager = await initialize();
    await manager.checkModelUpdates([location('one').id]);
    const response = await api.modelManagerRemote(); let complete!: (value: unknown) => void;
    api.modelManagerRemote.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const pending = manager.checkModelUpdates([location('one').id]);
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    await manager.markModelVersion(1, 3, 'ignore'); complete(response); await pending;
    expect(manager.getModelManagerState().watches['1'].ignoredVersionIds).toEqual([3]);
    expect(manager.unreadModelCount()).toBe(0);
  });
  it('preserves last successful results on failure and honours Retry-After', async () => {
    const manager = await initialize();
    await manager.checkModelUpdates([location('one').id]);
    const successAt = manager.getModelManagerState().watches['1'].lastSuccessAt;
    api.modelManagerRemote.mockResolvedValue({ success: false, error: 'Rate limited', retryAfterMs: 120000 });
    await manager.checkModelUpdates([location('one').id]);
    expect(manager.getModelManagerState().watches['1']).toMatchObject({ lastSuccessAt: successAt, error: 'Rate limited' });
    expect(manager.getModelManagerState().watches['1'].versions).toHaveLength(2);
    expect(manager.getModelManagerState().watches['1'].retryAt).toBeGreaterThan(Date.now());
  });
  it('runs due checks without a mounted Models workspace and emits only one notification', async () => {
    vi.useFakeTimers();
    const manager = await initialize();
    await manager.updateModelSource({ ...source, watchUpdates: true });
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.modelManagerRemote).toHaveBeenCalledTimes(1);
    expect(manager.getModelManagerState().notification).toContain('1 new model version');
    manager.dismissModelNotification(); await vi.advanceTimersByTimeAsync(60000);
    expect(api.modelManagerRemote).toHaveBeenCalledTimes(1);
    expect(manager.getModelManagerState().notification).toBeNull();
  });
  it('cancels an in-flight request without replacing the previous successful state', async () => {
    const manager = await initialize(); await manager.checkModelUpdates([location('one').id]);
    const versions = manager.getModelManagerState().watches['1'].versions;
    let complete!: (value: unknown) => void;
    api.modelManagerRemote.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const pending = manager.checkModelUpdates([location('one').id]);
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    manager.cancelModelJob(); complete({ success: false, cancelled: true, error: 'Cancelled' }); await pending;
    expect(api.modelManagerCancelRemote).toHaveBeenCalled();
    expect(manager.getModelManagerState().watches['1'].versions).toEqual(versions);
    expect(manager.getModelManagerState().progress).toBeNull();
  });
  it('stores imported cover in user preferences, independently of catalog cache', async () => {
    const manager = await initialize();
    await manager.runModelCommand({ type: 'importMedia', locationId: location('one').id, cover: true });
    expect(manager.modelItem(location('one').id).localMetadata?.previewImage).toBe('data:image/jpeg;base64,c3ludGhldGlj');
    await vi.waitFor(() => expect(api.modelManagerPublish).toHaveBeenCalledWith(expect.objectContaining({ localMetadata: expect.objectContaining({ [`location:${location('one').id}`]: expect.objectContaining({ previewImage: 'data:image/jpeg;base64,c3ludGhldGlj' }) }) })));
    const last = api.modelManagerPublish.mock.calls.at(-1)![0];
    expect(last.localMetadata[`location:${location('one').id}`].previewImage).toBe('data:image/jpeg;base64,c3ludGhldGlj');
    expect(api.writeJsonCacheData.mock.calls.every(([args]) => !JSON.stringify(args.data).includes('c3ludGhldGlj'))).toBe(true);
  });
  it('validates remote version belongs to the pasted model before assigning a manual link', async () => {
    const manager = await initialize();
    api.modelManagerRemote.mockResolvedValue({ success: true, metadata: { ...location('one').civitai, modelId: 999 } });
    await expect(manager.runModelCommand({ type: 'bind', locationId: location('one').id, url: 'https://civitai.com/models/1?modelVersionId=2' })).rejects.toThrow('does not belong');
    expect(manager.modelItem(location('one').id).location.civitai).toMatchObject({ modelId: 1 });
  });
  it('restores version identity and authored metadata after derived caches were cleared', async () => {
    api.getJsonCacheData.mockResolvedValue({ success: false });
    const restored = { ...location('one'), sha256: 'a'.repeat(64) };
    api.modelManagerLoadPreferences.mockResolvedValue({ sources: [source], localMetadata: { [`sha256:${'a'.repeat(64)}`]: { id: `sha256:${'a'.repeat(64)}`, tags: [], notes: 'Keep', previewImage: 'data:image/jpeg;base64,eA==', updatedAt: 1 } }, watches: {}, intervalHours: 24, identities: { version: 1, locations: [restored], updatedAt: 1 } });
    const manager = await initialize();
    expect(manager.modelItem(location('one').id).localMetadata).toMatchObject({ notes: 'Keep', previewImage: 'data:image/jpeg;base64,eA==' });
    expect(manager.modelItem(location('one').id).location.civitai).toMatchObject({ versionId: 2 });
    expect(api.modelLibraryHash).not.toHaveBeenCalled();
  });
  it('routes inspector edits through the main owner instead of a second catalog writer', async () => {
    const manager = await initialize();
    const handler = api.onModelManagerCommand.mock.calls[0][0];
    handler({ requestId: 'inspector-1', command: { type: 'saveLocal', locationId: location('one').id, patch: { notes: 'Inspector note' } } });
    await vi.waitFor(() => expect(api.modelManagerCommandResult).toHaveBeenCalledWith('inspector-1', { success: true }));
    expect(manager.modelItem(location('one').id).localMetadata?.notes).toBe('Inspector note');
    expect(api.writeJsonCacheData).toHaveBeenCalledTimes(1); // Initial scan only; notes do not rewrite the catalog.
  });
  it('identifies an unlinked model when monitoring is explicitly enabled', async () => {
    catalog.locations[0].civitai = undefined;
    const manager = await initialize();
    api.modelManagerRemote.mockImplementation(async ({ kind }) => kind === 'hash' ? { success: true, metadata: location('one').civitai } : { success: true, versions: [{ id: 2, name: 'Installed', publishedAt: '2025-01-01', description: '', url: '' }] });
    await manager.saveModelPatch(location('one').id, { watchUpdates: true });
    await vi.waitFor(() => expect(manager.getModelManagerState().watches['1']?.lastSuccessAt).toBeDefined());
    expect(api.modelLibraryHash).toHaveBeenCalledTimes(1);
    expect(api.modelManagerRemote.mock.calls.map(([args]) => args.kind)).toEqual(['hash', 'model']);
  });
  it('does not emit an automatic notice for releases already surfaced by a manual check', async () => {
    const manager = await initialize();
    await manager.checkModelUpdates([location('one').id]);
    expect(manager.getModelManagerState().watches['1'].notifiedVersionIds).toEqual([3]);
    expect(manager.getModelManagerState().notification).toBeNull();
    await manager.updateModelSource({ ...source, watchUpdates: true });
    vi.setSystemTime(Date.now() + 25 * 3600000);
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(api.modelManagerRemote).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(manager.getModelManagerState().progress).toBeNull());
    expect(manager.getModelManagerState().notification).toBeNull();
  });
});

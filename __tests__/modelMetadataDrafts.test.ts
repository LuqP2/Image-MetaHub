import { describe, expect, it, vi } from 'vitest';
import { changedDraftFields, conflictingDraftFields, ModelMetadataDraftStore } from '../services/modelLibrary/metadataDrafts';
import type { ModelInspectorItem, ModelLocalMetadata } from '../services/modelLibrary/types';

const item = (id: string, metadata: Partial<ModelLocalMetadata> = {}, hash?: string): ModelInspectorItem => ({
  location: { id, sha256: hash } as ModelInspectorItem['location'], localMetadata: { notes: 'Saved', tags: ['original'], ...metadata } as ModelLocalMetadata,
});
describe('metadata drafts within one renderer session', () => {
  it('retains edits and editor state across model changes and remounts, and shares identical copies', () => {
    const store = new ModelMetadataDraftStore(), hash = 'a'.repeat(64);
    const a = store.ensure(item('a', {}, hash)); store.edit(a); store.change(a, 'notes', 'Draft A');
    const b = store.ensure(item('b')); store.edit(b); store.change(b, 'notes', 'Draft B');
    expect(store.get(store.ensure(item('a', {}, hash))).values.notes).toBe('Draft A');
    expect(store.get(store.ensure(item('copy', {}, hash))).values.notes).toBe('Draft A');
    store.close(a); expect(changedDraftFields(store.get(a))).toEqual(['notes']);
    store.edit(a); expect(store.get(a).values.notes).toBe('Draft A');
  });
  it('refreshes clean fields without overwriting changed fields and saves only the edited fields', async () => {
    const store = new ModelMetadataDraftStore(); const a = store.ensure(item('a'));
    store.change(a, 'notes', 'Mine');
    store.sync(a, item('a', { tags: ['externally edited'] }).localMetadata);
    expect(store.get(a).values.tags).toBe('externally edited');
    expect(store.get(a).values.notes).toBe('Mine');
    const execute = vi.fn().mockResolvedValue(undefined);
    await store.save(a, execute);
    expect(execute).toHaveBeenCalledExactlyOnceWith({ notes: 'Mine' });
    expect(changedDraftFields(store.get(a))).toEqual([]);
    expect(store.get(a).values.tags).toBe('externally edited');
  });
  it('requires an explicit decision for conflicts, supports local overwrite and reloads latest values on discard', async () => {
    const store = new ModelMetadataDraftStore(); const a = store.ensure(item('a'));
    store.change(a, 'notes', 'Mine'); store.sync(a, item('a', { notes: 'Other window' }).localMetadata);
    expect(conflictingDraftFields(store.get(a))).toEqual(['notes']);
    const execute = vi.fn().mockResolvedValue(undefined);
    await store.save(a, execute); expect(execute).not.toHaveBeenCalled();
    await store.save(a, execute, true); expect(execute).toHaveBeenCalledExactlyOnceWith({ notes: 'Mine' });
    store.change(a, 'notes', 'Pending'); store.sync(a, item('a', { notes: 'New saved value' }).localMetadata); store.discard(a);
    expect(store.get(a).values.notes).toBe('New saved value'); expect(changedDraftFields(store.get(a))).toEqual([]);
  });
  it('keeps failed saves and preserves edits during assignment of a hash', async () => {
    const store = new ModelMetadataDraftStore(); const a = store.ensure(item('a'));
    store.edit(a); store.change(a, 'notes', 'Mine');
    const hashed = store.ensure(item('a', {}, 'b'.repeat(64)));
    store.sync(hashed, item('a').localMetadata);
    expect(store.get(hashed).values.notes).toBe('Mine');
    await store.save(hashed, vi.fn().mockRejectedValue(new Error('Synthetic failure')));
    expect(store.get(hashed).values.notes).toBe('Mine'); expect(store.get(hashed).error).toBe('Synthetic failure');
    expect(store.get(hashed).editing).toBe(true);
  });
  it('does not apply an asynchronous save response from A to B, including hash migration while saving A', async () => {
    const store = new ModelMetadataDraftStore(); const a = store.ensure(item('a'));
    store.change(a, 'notes', 'Mine');
    let finish!: () => void; const pending = new Promise<void>((resolve) => { finish = resolve; });
    const save = store.save(a, () => pending);
    const b = store.ensure(item('b')); store.change(b, 'notes', 'B draft');
    const hashed = store.ensure(item('a', {}, 'c'.repeat(64)));
    finish(); await save;
    expect(store.get(b).values.notes).toBe('B draft'); expect(changedDraftFields(store.get(b))).toEqual(['notes']);
    expect(store.get(hashed).values.notes).toBe('Mine'); expect(changedDraftFields(store.get(hashed))).toEqual([]);
  });
  it('uses existing metadata normalization after saving instead of reporting its own normalization as a conflict', async () => {
    const store = new ModelMetadataDraftStore(); const a = store.ensure(item('a'));
    store.change(a, 'tags', ' TAG ,tag, Other '); store.change(a, 'strength', '42');
    await store.save(a, vi.fn().mockResolvedValue(undefined));
    expect(store.get(a).values.tags).toBe('tag, other'); expect(store.get(a).values.strength).toBe('10');
    store.change(a, 'tags', 'new tag');
    store.sync(a, item('a', { tags: ['tag', 'other'], defaultStrength: 10 }).localMetadata);
    expect(conflictingDraftFields(store.get(a))).toEqual([]);
  });
  it('merges disjoint drafts after identification and requires a choice before discarding colliding edits', async () => {
    const store = new ModelMetadataDraftStore(), hash = 'd'.repeat(64);
    const a = store.ensure(item('a')); store.change(a, 'notes', 'File draft'); store.change(a, 'name', 'Authored name');
    const b = store.ensure(item('b', {}, hash)); store.change(b, 'notes', 'Existing draft');
    const joined = store.ensure(item('a', {}, hash));
    expect(store.get(joined).values.name).toBe('Authored name');
    expect(store.get(joined).identityConflict?.fields).toEqual(['notes']);
    const execute = vi.fn().mockResolvedValue(undefined);
    await store.save(joined, execute, true); expect(execute).not.toHaveBeenCalled();
    store.sync(joined, item('a', { tags: ['external'] }).localMetadata);
    store.resolveIdentityConflict(joined, true);
    expect(store.get(joined).values.notes).toBe('File draft');
    expect(store.get(joined).values.tags).toBe('external');
    await store.save(joined, execute); expect(execute).toHaveBeenCalledExactlyOnceWith({ displayName: 'Authored name', notes: 'File draft' });
  });
  it('does not create identity alias cycles if a refresh invalidates a formerly known hash', () => {
    const store = new ModelMetadataDraftStore(); const a = store.ensure(item('a'));
    store.change(a, 'notes', 'Pending');
    store.ensure(item('a', {}, 'e'.repeat(64)));
    const unhashed = store.ensure(item('a'));
    expect(store.get(unhashed).values.notes).toBe('Pending');
  });
});

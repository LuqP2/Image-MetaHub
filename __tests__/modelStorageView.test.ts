import { describe, expect, it } from 'vitest';
import { buildStorageRows, createInspectorSyncQueue, filterStorageRows, nextStorageSort, selectStorageRange, sortStorageRows, storageWindow } from '../services/modelLibrary/storageView';
import type { StorageRow, StorageSortColumn } from '../services/modelLibrary/storageView';
import type { ModelManagerSnapshot } from '../services/modelLibrary/types';

const row = (key: string, patch: Partial<StorageRow> = {}): StorageRow => ({
  file: { key, path: `/synthetic/${key}`, size: 100, locationIds: [key], modifiedAt: 1, stale: false, sha256: key.padEnd(64, 'a') },
  item: { location: { id: key } as StorageRow['item']['location'], usage: { status: 'ready', totalCount: 1, lastUsedAt: 1, dateBasis: 'libraryFileDate', confirmedCount: 0, nameMatchedCount: 1, ambiguousCount: 0 } },
  name: key, type: 'Checkpoint', copies: 1, eligible: true, sourceIds: ['source'], kinds: ['checkpoint'], ...patch,
});
const keys = (rows: StorageRow[]) => rows.map((entry) => entry.file.key);
describe('Storage ordering and selection', () => {
  it.each(['name', 'type', 'path', 'size', 'usage', 'latest', 'copies'] as StorageSortColumn[])('orders %s in both directions', (column) => {
    const a = row('a'), b = row('b');
    a.name = 'model2'; b.name = 'Model10'; a.type = 'A'; b.type = 'B'; b.file.size = 200; b.item.usage!.totalCount = 2; b.item.usage!.lastUsedAt = 2; b.copies = 2;
    expect(keys(sortStorageRows([b, a], { column, direction: 'asc' }))).toEqual(['a', 'b']);
    expect(keys(sortStorageRows([a, b], { column, direction: 'desc' }))).toEqual(['b', 'a']);
  });
  it.each(['asc', 'desc'] as const)('keeps unknown values last (%s), while partial and zero counts are sortable', (direction) => {
    const a = row('zero'), b = row('partial'), c = row('unsupported'), d = row('loading');
    a.item.usage!.totalCount = 0; a.item.usage!.lastUsedAt = null; b.item.usage!.status = 'partial'; c.item.usage!.status = 'unsupported'; d.item.usage!.status = 'loading';
    const sorted = sortStorageRows([c, d, b, a], { column: 'usage', direction });
    expect(keys(sorted.slice(0, 2))).toEqual(direction === 'asc' ? ['zero', 'partial'] : ['partial', 'zero']);
    expect(keys(sorted.slice(2)).sort()).toEqual(['loading', 'unsupported']);
    b.file.sha256 = undefined;
    expect(keys(sortStorageRows([b, a], { column: 'copies', direction }))).toEqual(['zero', 'partial']);
    expect(keys(sortStorageRows([a, b], { column: 'latest', direction }))).toEqual(['partial', 'zero']);
  });
  it('uses stable path/key tie breaks and chosen-column defaults', () => {
    const a = row('a'), b = row('b'); a.file.path = b.file.path = '/same';
    expect(keys(sortStorageRows([b, a], { column: 'size', direction: 'desc' }))).toEqual(['a', 'b']);
    expect(nextStorageSort({ column: 'size', direction: 'desc' }, 'name')).toEqual({ column: 'name', direction: 'asc' });
    expect(nextStorageSort({ column: 'name', direction: 'asc' }, 'name').direction).toBe('desc');
  });
  it('selects ranges in current order, skips unavailable files, and falls back when the anchor is hidden', () => {
    const rows = [row('c'), row('b', { eligible: false }), row('a')];
    expect([...selectStorageRange(new Set(['hidden']), rows, 'c', 'a', false)]).toEqual(['c', 'a']);
    expect([...selectStorageRange(new Set(['hidden']), rows, 'c', 'a', true)]).toEqual(['hidden', 'c', 'a']);
    expect([...selectStorageRange(new Set(), rows, 'hidden', 'a', false)]).toEqual(['a']);
  });
  it('keeps only complete supported zeros in the no-match filter', () => {
    const a = row('a'), b = row('b'), c = row('c');
    for (const entry of [a, b, c]) entry.item.usage!.totalCount = 0;
    b.item.usage!.status = 'partial'; c.item.usage!.status = 'unsupported';
    expect(keys(filterStorageRows([a, b, c], { folder: 'all', kind: 'all', query: '', filter: 'unmatched' }))).toEqual(['a']);
  });
  it('resolves overlapping sources deterministically, preserves physical copies and updates authored names', () => {
    const manager = { catalog: { locations: [
      { id: 'z', sourceId: 'other', sourceKind: 'checkpoint', fileName: 'model.safetensors', sha256: 'a'.repeat(64) },
      { id: 'a', sourceId: 'chosen', sourceKind: 'lora', fileName: 'model.safetensors', sha256: 'a'.repeat(64) },
      { id: 'copy', sourceId: 'chosen', sourceKind: 'lora', fileName: 'copy.safetensors', sha256: 'a'.repeat(64) },
    ] }, localMetadata: { ['sha256:' + 'a'.repeat(64)]: { displayName: 'Custom2' } }, usage: {}, storage: { files: [
      { key: 'one', path: '/one', locationIds: ['z', 'a'], size: 1, stale: false, sha256: 'a'.repeat(64) },
      { key: 'two', path: '/two', locationIds: ['copy'], size: 1, stale: false, sha256: 'a'.repeat(64) },
    ] } } as unknown as ModelManagerSnapshot;
    const rows = buildStorageRows(manager, 'chosen', 'lora');
    expect(rows.map((entry) => entry.item.location.id)).toEqual(['a', 'copy']);
    expect(rows.map((entry) => entry.name)).toEqual(['Custom2', 'Custom2']);
    expect(rows.map((entry) => entry.copies)).toEqual([2, 2]);
  });
  it('uses viewport height, row height and header height and clamps after shrink', () => {
    expect(storageWindow(100, 560, 600, 56)).toEqual({ top: 560, first: 2, last: 28 });
    expect(storageWindow(100, 800, 840, 80)).toEqual({ top: 800, first: 2, last: 28 });
    expect(storageWindow(2, 9000, 600, 56).top).toBe(0);
  });
  it('serializes sync and discards stale selection work after a newer request', async () => {
    const enqueue = createInspectorSyncQueue();
    const log: string[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const first = enqueue(async (current) => { log.push('collectionA'); await pending; if (current()) log.push('selectionA'); });
    await Promise.resolve(); await Promise.resolve();
    const obsolete = enqueue(async () => { log.push('obsolete'); });
    const latest = enqueue(async () => { log.push('collectionB'); log.push('selectionB'); });
    release(); await Promise.all([first, obsolete, latest]);
    expect(log).toEqual(['collectionA', 'collectionB', 'selectionB']);
  });
  it('does not cancel an explicit open when a subsequent render schedules background sync', async () => {
    const enqueue = createInspectorSyncQueue(), log: string[] = [];
    const open = enqueue(async () => { log.push('open'); }, true);
    const sync = enqueue(async () => { log.push('sync'); });
    await Promise.all([open, sync]);
    expect(log).toEqual(['open', 'sync']);
  });
});

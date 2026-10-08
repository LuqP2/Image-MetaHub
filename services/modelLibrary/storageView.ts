import { confirmedCopyCounts, confirmedCopies } from './storage';
import { getEffectiveModelPresentation, getModelLocalMetadata, getModelLocalMetadataId } from './presentation';
import { modelKindLabel } from './modelKinds';
import type { ModelInspectorItem, ModelKind, ModelManagerSnapshot, ModelStorageFile } from './types';

export type StorageSortColumn = 'name' | 'type' | 'path' | 'size' | 'usage' | 'latest' | 'copies';
export type StorageSort = { column: StorageSortColumn; direction: 'asc' | 'desc' };
export type StorageFilters = { folder: string; kind: string; query: string; filter: string };
export interface StorageRow {
  file: ModelStorageFile;
  item: ModelInspectorItem;
  name: string;
  type: string;
  copies: number;
  eligible: boolean;
  sourceIds: string[];
  kinds: ModelKind[];
}
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
export const STORAGE_HEADER_HEIGHT = 40;
export const STORAGE_ROW_HEIGHT = { compact: 56, comfortable: 80 } as const;

export function nextStorageSort(current: StorageSort, column: StorageSortColumn): StorageSort {
  return { column, direction: current.column === column ? current.direction === 'asc' ? 'desc' : 'asc'
    : ['name', 'type', 'path'].includes(column) ? 'asc' : 'desc' };
}

export function buildStorageRows(manager: ModelManagerSnapshot, folder = 'all', kind = 'all'): StorageRow[] {
  const files = manager.storage?.files ?? [];
  const byId = new Map(manager.catalog.locations.map((location) => [location.id, location]));
  const copies = confirmedCopyCounts(files);
  return files.flatMap((file) => {
    const locations = file.locationIds.flatMap((id) => { const location = byId.get(id); return location ? [location] : []; });
    const ranked = [...locations].sort((a, b) => {
      const rank = (location: typeof a) => (folder !== 'all' && location.sourceId === folder ? 2 : 0)
        + (kind !== 'all' && location.sourceKind === kind ? 1 : 0);
      return rank(b) - rank(a) || a.id.localeCompare(b.id);
    });
    const location = ranked[0];
    if (!location) return [];
    const localMetadata = getModelLocalMetadata(manager.localMetadata, location);
    const usage = file.stale || file.error ? undefined : manager.usage?.[file.sha256 ? `sha256:${file.sha256.toLowerCase()}` : getModelLocalMetadataId(location)];
    return [{ file, item: { location, localMetadata, usage }, name: getEffectiveModelPresentation(location, localMetadata).name,
      type: modelKindLabel(location.sourceKind), copies: confirmedCopies(file, files, copies), eligible: !file.stale && !file.error,
      sourceIds: locations.map((entry) => entry.sourceId), kinds: locations.map((entry) => entry.sourceKind) }];
  });
}

export function filterStorageRows(rows: StorageRow[], filters: StorageFilters): StorageRow[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return rows.filter((row) => (filters.folder === 'all' || row.sourceIds.includes(filters.folder))
    && (filters.kind === 'all' || row.kinds.some((kind) => kind === filters.kind))
    && (!query || [row.name, row.item.location.fileName, row.file.path].some((text) => text.toLocaleLowerCase().includes(query)))
    && (filters.filter !== 'duplicates' || row.copies > 1)
    && (filters.filter !== 'unmatched' || row.item.usage?.status === 'ready' && row.item.usage.totalCount === 0));
}

export function sortStorageRows(rows: StorageRow[], sort: StorageSort): StorageRow[] {
  const value = (row: StorageRow): string | number | null => {
    switch (sort.column) {
      case 'name': return row.name;
      case 'type': return row.type;
      case 'path': return row.file.path;
      case 'size': return row.file.size;
      case 'usage': return row.item.usage && ['ready', 'partial'].includes(row.item.usage.status) ? row.item.usage.totalCount : null;
      case 'latest': return row.item.usage && ['ready', 'partial'].includes(row.item.usage.status) ? row.item.usage.lastUsedAt : null;
      case 'copies': return row.file.sha256 && row.eligible ? row.copies : null;
    }
  };
  return [...rows].sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    const difference = av === null || bv === null ? 0 : typeof av === 'number' && typeof bv === 'number' ? av - bv : collator.compare(String(av), String(bv));
    return difference * (sort.direction === 'asc' ? 1 : -1) || collator.compare(a.file.path, b.file.path) || a.file.key.localeCompare(b.file.key);
  });
}

export function selectStorageRange(selected: ReadonlySet<string>, rows: StorageRow[], anchor: string | null, key: string, additive: boolean): Set<string> {
  const start = rows.findIndex((row) => row.file.key === anchor), end = rows.findIndex((row) => row.file.key === key);
  const next = new Set(additive ? selected : []);
  if (end < 0) return next;
  for (const row of rows.slice(Math.min(start < 0 ? end : start, end), Math.max(start < 0 ? end : start, end) + 1)) {
    if (row.eligible) next.add(row.file.key);
  }
  return next;
}

export function storageWindow(count: number, scrollTop: number, viewport: number, rowHeight: number) {
  const top = Math.max(0, Math.min(scrollTop, Math.max(0, count * rowHeight + STORAGE_HEADER_HEIGHT - viewport)));
  const first = Math.max(0, Math.floor(top / rowHeight) - 8);
  const last = Math.min(count, Math.ceil((top + Math.max(0, viewport - STORAGE_HEADER_HEIGHT)) / rowHeight) + 8);
  return { top, first, last };
}

/** Orders collection and selection; drops obsolete sync work but never drops explicit opens. */
export function createInspectorSyncQueue() {
  let revision = 0;
  let tail: Promise<unknown> = Promise.resolve();
  return (work: (current: () => boolean) => Promise<unknown>, explicitOpen = false): Promise<unknown> => {
    const requested = ++revision;
    tail = tail.catch(() => undefined).then(() => explicitOpen || requested === revision ? work(() => requested === revision) : undefined);
    return tail;
  };
}

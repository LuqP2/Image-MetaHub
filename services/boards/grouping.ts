import type { LibraryQueryImage } from '../libraryQuery/types';
import type { BoardGroupingDimension, BoardGroupConstraint, BoardSmartFrameLayout } from './queryTypes';
import type { BoardQueryDataset } from './queryProtocol';
import { SESSION_GAP_MS } from '../../utils/imageGrouping';
import { formatLocalDateKey } from '../../utils/dateFilterUtils';

export interface BoardGroupBucket {
  key: string; label: string; constraint: BoardGroupConstraint; imageIds: string[]; count: number;
  subgroups?: BoardGroupBucket[];
}
export interface BoardMatrixCell { imageIds: string[]; count: number }
export type BoardGroupedLayout =
  | { kind: 'groups'; groups: BoardGroupBucket[] }
  | { kind: 'matrix'; rows: BoardGroupBucket[]; columns: BoardGroupBucket[]; cells: Record<string, BoardMatrixCell> };
export const matrixCellKey = (row: string, column: string) => JSON.stringify([row, column]);
export const groupingLabels: Record<BoardGroupingDimension, string> = {
  model: 'Checkpoint', lora: 'LoRA', sampler: 'Sampler', scheduler: 'Scheduler', seed: 'Seed', dimensions: 'Resolution', generator: 'Generator',
  rating: 'Rating', favorite: 'Favorite', tag: 'Tag', autoTag: 'Auto-tag', date: 'Date', session: 'Session', folder: 'Folder', collection: 'Collection', cluster: 'Cluster',
};
interface GroupValue { value: string; label: string }
export interface BoardGroupingContext {
  values(image: LibraryQueryImage, dimension: BoardGroupingDimension): GroupValue[];
  dataset: BoardQueryDataset;
}
export function createGroupingContext(dataset: BoardQueryDataset): BoardGroupingContext {
  const reverse = (records: Record<string, string[]>) => {
    const result = new Map<string, string[]>();
    for (const [id, members] of Object.entries(records)) for (const imageId of new Set(members)) {
      const bucket = result.get(imageId); if (bucket) bucket.push(id); else result.set(imageId, [id]);
    }
    return result;
  };
  const collections = reverse(dataset.collections);
  const clusters = reverse(Object.fromEntries(Object.entries(dataset.clusters ?? {}).map(([id, cluster]) => [id, cluster.imageIds])));
  const values = (image: LibraryQueryImage, dimension: BoardGroupingDimension): GroupValue[] => {
    let entries: string[] = [];
    switch (dimension) {
      case 'model': entries = image.models; break;
      case 'lora': entries = image.loraNames; break;
      case 'tag': entries = image.tags; break;
      case 'autoTag': entries = image.autoTags; break;
      case 'sampler': entries = [image.sampler]; break;
      case 'scheduler': entries = [image.scheduler]; break;
      case 'generator': entries = [image.generator]; break;
      case 'dimensions': entries = image.dimensions === '0x0' ? [] : [image.dimensions]; break;
      case 'seed': entries = [dataset.grouping?.[image.id]?.seed ?? '']; break;
      case 'folder': entries = [dataset.grouping?.[image.id]?.folder ?? '']; break;
      case 'rating': entries = image.rating == null ? [] : [String(image.rating)]; break;
      case 'favorite': entries = [String(image.isFavorite)]; break;
      case 'date': entries = Number.isFinite(image.lastModified) ? [formatLocalDateKey(image.lastModified)] : []; break;
      case 'collection': entries = collections.get(image.id) ?? []; break;
      case 'cluster': entries = clusters.get(image.id) ?? []; break;
      case 'session': entries = []; break; // Session boundaries depend on the complete frame result.
    }
    return [...new Set(entries.map(value => value.trim()).filter(Boolean))].map(value => ({ value,
      label: dimension === 'collection' ? dataset.collectionLabels?.[value] ?? value : dimension === 'cluster' ? dataset.clusters?.[value]?.label ?? value
        : dimension === 'favorite' ? value === 'true' ? 'Favorite' : 'Not favorite' : value }));
  };
  return { values, dataset };
}
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export function groupBoardImages(images: LibraryQueryImage[], dimension: BoardGroupingDimension, context: BoardGroupingContext): BoardGroupBucket[] {
  const buckets = new Map<string, BoardGroupBucket>();
  const add = (image: LibraryQueryImage, constraint: BoardGroupConstraint, label: string) => {
    const key = JSON.stringify(constraint);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { key, label, constraint, imageIds: [], count: 0 }; buckets.set(key, bucket); }
    bucket.imageIds.push(image.id); bucket.count++;
  };
  const unique = [...new Map(images.map(image => [image.id, image])).values()];
  if (dimension === 'session') {
    const sorted = unique.filter(image => Number.isFinite(image.lastModified)).sort((a, b) => a.lastModified - b.lastModified || collator.compare(a.id, b.id));
    for (let start = 0; start < sorted.length;) {
      let end = start;
      while (end + 1 < sorted.length && sorted[end + 1].lastModified - sorted[end].lastModified <= SESSION_GAP_MS) end++;
      const from = sorted[start].lastModified, to = sorted[end].lastModified + 1;
      const constraint: BoardGroupConstraint = { kind: 'session', dimension: 'session', start: from, endExclusive: to };
      const label = `${formatLocalDateKey(from)} ${new Date(from).toLocaleTimeString()} – ${new Date(to - 1).toLocaleTimeString()}`;
      for (let i = start; i <= end; i++) add(sorted[i], constraint, label);
      start = end + 1;
    }
    for (const image of unique) if (!Number.isFinite(image.lastModified)) add(image, { kind: 'missing', dimension }, 'No value');
    // Preserve the frame's current image order inside each session.
    const rank = new Map(unique.map((image, index) => [image.id, index]));
    for (const bucket of buckets.values()) bucket.imageIds.sort((a, b) => rank.get(a)! - rank.get(b)!);
    return [...buckets.values()];
  }
  for (const image of unique) {
    const values = context.values(image, dimension);
    if (!values.length) add(image, { kind: 'missing', dimension }, 'No value');
    for (const { value, label } of values) add(image, { kind: 'exact', dimension, value }, label);
  }
  return [...buckets.values()].sort((a, b) => collator.compare(a.label, b.label) || a.key.localeCompare(b.key));
}
export function buildBoardGroupedLayout(images: LibraryQueryImage[], layout: BoardSmartFrameLayout, context: BoardGroupingContext): BoardGroupedLayout | undefined {
  if (layout.kind === 'grid') return undefined;
  const byId = new Map(images.map(image => [image.id, image]));
  if (layout.kind === 'groups') {
    const groups = groupBoardImages(images, layout.groupBy, context);
    if (layout.subgroupBy) for (const group of groups) group.subgroups = groupBoardImages(group.imageIds.map(id => byId.get(id)!), layout.subgroupBy, context);
    return { kind: 'groups', groups };
  }
  const rows = groupBoardImages(images, layout.rows, context), columns = groupBoardImages(images, layout.columns, context);
  const rowMembership = new Map<string, string[]>();
  for (const row of rows) for (const id of row.imageIds) { const keys = rowMembership.get(id); if (keys) keys.push(row.key); else rowMembership.set(id, [row.key]); }
  const cells: Record<string, BoardMatrixCell> = Object.create(null);
  for (const column of columns) for (const id of column.imageIds) for (const row of rowMembership.get(id) ?? []) {
    const key = matrixCellKey(row, column.key);
    const cell = cells[key] ??= { imageIds: [], count: 0 }; cell.imageIds.push(id); cell.count++;
  }
  return { kind: 'matrix', rows, columns, cells };
}

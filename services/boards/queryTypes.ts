import type { LibraryQueryCriteria } from '../libraryQuery/types';
import type { BoardAssetReference, BoardObjectBase } from './types';

export type BoardGroupingDimension = 'model' | 'lora' | 'sampler' | 'scheduler' | 'seed' | 'dimensions' | 'generator' | 'rating' | 'favorite' | 'tag' | 'autoTag' | 'date' | 'session' | 'folder' | 'collection' | 'cluster';
export type BoardGroupConstraint =
  | { kind: 'exact'; dimension: BoardGroupingDimension; value: string }
  | { kind: 'missing'; dimension: BoardGroupingDimension }
  | { kind: 'session'; dimension: 'session'; start: number; endExclusive: number };
export type BoardSetExpression =
  | { kind: 'library' }
  | { kind: 'collection'; collectionId: string }
  | { kind: 'snapshot'; references: BoardAssetReference[] }
  | { kind: 'frame'; frameId: string }
  | { kind: 'intersection'; inputs: BoardSetExpression[] }
  | { kind: 'difference'; left: BoardSetExpression; right: BoardSetExpression }
  | { kind: 'query'; source: BoardSetExpression; criteria: LibraryQueryCriteria; groupConstraints: BoardGroupConstraint[] };
export type BoardSmartFrameLayout =
  | { kind: 'grid' }
  | { kind: 'groups'; groupBy: BoardGroupingDimension; subgroupBy: BoardGroupingDimension | null }
  | { kind: 'matrix'; rows: BoardGroupingDimension; columns: BoardGroupingDimension };
export interface BoardSmartFrameObject extends BoardObjectBase {
  type: 'smart-frame';
  frameId: null;
  title: string;
  color: string;
  source: BoardSetExpression;
  criteria: LibraryQueryCriteria;
  groupConstraints: BoardGroupConstraint[];
  layout: BoardSmartFrameLayout;
}

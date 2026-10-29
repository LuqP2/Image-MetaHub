import type { LibraryQueryImage, LibraryQueryExecutionContext, LibraryQueryFacets } from '../libraryQuery/types';
import type { BoardSmartFrameObject } from './queryTypes';

export type BoardQueryFrame = Pick<BoardSmartFrameObject, 'id' | 'type' | 'source' | 'criteria' | 'groupConstraints'> & { layout?: BoardSmartFrameObject['layout'] };

export interface BoardQueryDataset {
  images: LibraryQueryImage[];
  grouping?: Record<string, { seed: string | null; folder: string | null }>;
  collectionLabels?: Record<string, string>;
  clusters?: Record<string, { label: string; imageIds: string[] }>;
  context: LibraryQueryExecutionContext;
  collections: Record<string, string[]>;
  /** Reference JSON key -> resolved current image ID. Missing entries remain unavailable. */
  references: Record<string, string>;
}
export type BoardSourceCounts = Record<string, Array<[string, number]>>;
export type BoardQueryFacets = LibraryQueryFacets & { sourceCounts?: BoardSourceCounts };
export interface BoardQueryResult {
  frameId: string;
  definitionKey?: string;
  datasetRevision: number;
  queryRevision: number;
  status: 'loading' | 'ready' | 'updating' | 'source-missing' | 'error';
  imageIds: string[];
  totalCount: number;
  unavailableReferences: number;
  facets?: BoardQueryFacets;
  grouped?: import('./grouping').BoardGroupedLayout;
  error?: string;
}
export type BoardQueryRequest =
  | { type: 'syncDataset'; revision: number; dataset: BoardQueryDataset }
  | { type: 'evaluateBoard'; boardId: string; datasetRevision: number; queryRevision: number; frames: BoardQueryFrame[] }
  | { type: 'disposeBoard'; boardId: string };
export type BoardQueryResponse =
  | { type: 'boardResults'; boardId: string; datasetRevision: number; queryRevision: number; results: Record<string, BoardQueryResult> }
  | { type: 'error'; boardId: string; datasetRevision: number; queryRevision: number; error: string };

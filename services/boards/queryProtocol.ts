import type { LibraryQueryImage, LibraryQueryExecutionContext, LibraryQueryFacets } from '../libraryQuery/types';
import type { BoardSmartFrameObject } from './queryTypes';

export type BoardQueryFrame = Pick<BoardSmartFrameObject, 'id' | 'type' | 'source' | 'criteria' | 'groupConstraints'>;

export interface BoardQueryDataset {
  images: LibraryQueryImage[];
  context: LibraryQueryExecutionContext;
  collections: Record<string, string[]>;
  /** Reference JSON key -> resolved current image ID. Missing entries remain unavailable. */
  references: Record<string, string>;
}
export interface BoardQueryResult {
  frameId: string;
  definitionKey?: string;
  datasetRevision: number;
  queryRevision: number;
  status: 'loading' | 'ready' | 'updating' | 'source-missing' | 'error';
  imageIds: string[];
  totalCount: number;
  unavailableReferences: number;
  facets?: LibraryQueryFacets;
  error?: string;
}
export type BoardQueryRequest =
  | { type: 'syncDataset'; revision: number; dataset: BoardQueryDataset }
  | { type: 'evaluateBoard'; boardId: string; datasetRevision: number; queryRevision: number; frames: BoardQueryFrame[] }
  | { type: 'disposeBoard'; boardId: string };
export type BoardQueryResponse =
  | { type: 'boardResults'; boardId: string; datasetRevision: number; queryRevision: number; results: Record<string, BoardQueryResult> }
  | { type: 'error'; boardId: string; datasetRevision: number; queryRevision: number; error: string };

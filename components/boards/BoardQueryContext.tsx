import { createContext, useContext } from 'react';
import type { IndexedImage } from '../../types';
import type { BoardPoint } from '../../services/boards/layout';
export interface BoardQueryActions {
  images: Map<string, IndexedImage>;
  open(imageId: string, frameId: string, navigationIds?: string[]): void;
  create(center: BoardPoint): void;
  retry(): void;
  snapshot(frameId: string): void;
  useCurrentFilters(frameId: string): void;
  collections: Array<{ id: string; name: string }>;
}
export const BoardQueryContext = createContext<BoardQueryActions | null>(null);
export const useBoardQueryActions = () => useContext(BoardQueryContext);

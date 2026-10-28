import { createContext, useContext } from 'react';
import type { IndexedImage } from '../../types';
export interface BoardQueryActions {
  images: Map<string, IndexedImage>;
  open(imageId: string, frameId: string): void;
  create(): void;
  retry(): void;
  snapshot(frameId: string): void;
  useCurrentFilters(frameId: string): void;
  collections: Array<{ id: string; name: string }>;
}
export const BoardQueryContext = createContext<BoardQueryActions | null>(null);
export const useBoardQueryActions = () => useContext(BoardQueryContext);

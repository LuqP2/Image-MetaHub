import { createContext, useContext } from 'react';
import type { IndexedImage } from '../../types';
import type { BoardAssetObject } from '../../services/boards/types';
import type { BoardObjectUpdate } from '../../services/boards/operations';

export interface BoardEditorActions {
  editable: boolean;
  connecting: boolean;
  begin(): void;
  change(update: BoardObjectUpdate): void;
  commit(): void;
  cancel(): void;
  openAsset?(object: BoardAssetObject): void;
  resolveAsset?(object: BoardAssetObject): { status: 'resolved' | 'loading' | 'missing' | 'ambiguous'; image?: IndexedImage };
}
export const BoardEditorContext = createContext<BoardEditorActions | null>(null);
export function useBoardEditor() {
  const context = useContext(BoardEditorContext);
  if (!context) throw new Error('Board editor context is missing.');
  return context;
}

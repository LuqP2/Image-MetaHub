import { createContext, useContext } from 'react';
import type { IndexedImage } from '../../types';
import type { BoardAssetObject } from '../../services/boards/types';
import type { BoardObjectUpdate } from '../../services/boards/operations';
import type { BoardPoint } from '../../services/boards/layout';

export interface BoardEditorActions {
  editable: boolean;
  connecting: boolean;
  tool?: 'select' | 'text' | 'frame' | 'connect';
  setTool?(tool: 'select' | 'text' | 'frame' | 'connect'): void;
  begin(): void;
  change(update: BoardObjectUpdate): void;
  commit(): void;
  cancel(): void;
  openAsset?(object: BoardAssetObject): void;
  resolveAsset?(object: BoardAssetObject): { status: 'resolved' | 'loading' | 'missing' | 'ambiguous'; image?: IndexedImage };
  dropAssets?(ids: string[], anchor: BoardPoint): void;
}
export const BoardEditorContext = createContext<BoardEditorActions | null>(null);
export function useBoardEditor() {
  const context = useContext(BoardEditorContext);
  if (!context) throw new Error('Board editor context is missing.');
  return context;
}

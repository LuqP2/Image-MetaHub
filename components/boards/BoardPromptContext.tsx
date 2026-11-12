import { createContext, useContext } from 'react';
import type { BoardPromptInput, BoardPromptObject } from '../../services/boards/types';
import type { BoardPoint } from '../../services/boards/layout';

export interface BoardPromptActions {
  loading: boolean;
  matchedIds: ReadonlySet<string>;
  matchedObjectIds: ReadonlySet<string>;
  counts(prompt: string): { canvas: number; library: number };
  add(input: BoardPromptInput, point?: BoardPoint): void;
  bring(card: BoardPromptObject): void;
  save(card: BoardPromptObject): void;
  openLibrary(id: string): void;
}
const empty = new Set<string>();
export const BoardPromptContext = createContext<BoardPromptActions>({ loading: false, matchedIds: empty, matchedObjectIds: empty, counts: () => ({ canvas: 0, library: 0 }), add() {}, bring() {}, save() {}, openLibrary() {} });
export const useBoardPrompts = () => useContext(BoardPromptContext);

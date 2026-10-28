import { create } from 'zustand';
import type { BoardQueryResult } from '../services/boards/queryProtocol';

interface BoardQueryState {
  results: Record<string, Record<string, BoardQueryResult>>;
  publish(boardId: string, results: Record<string, BoardQueryResult>): void;
  clear(boardId: string): void;
}
export const useBoardQueryStore = create<BoardQueryState>(set => ({
  results: {},
  publish: (boardId, results) => set(state => ({ results: { ...state.results, [boardId]: results } })),
  clear: boardId => set(state => { const results = { ...state.results }; delete results[boardId]; return { results }; }),
}));

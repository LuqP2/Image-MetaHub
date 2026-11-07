import { create } from 'zustand';
import type { BoardConnection } from '../services/boards/types';

export type BoardConnectionStyle = Required<Pick<BoardConnection, 'color' | 'width' | 'lineStyle'>>;
export const DEFAULT_BOARD_CONNECTION_STYLE: BoardConnectionStyle = { color: '#94a3b8', width: 1.5, lineStyle: 'solid' };
const key = 'imh-board-connection-style';
function validStyle(value: Partial<BoardConnectionStyle>): Partial<BoardConnectionStyle> {
  return {
    ...(typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color) ? { color: value.color } : {}),
    ...(typeof value.width === 'number' && Number.isFinite(value.width) && value.width >= .5 && value.width <= 12 ? { width: value.width } : {}),
    ...(value.lineStyle === 'solid' || value.lineStyle === 'dashed' ? { lineStyle: value.lineStyle } : {}),
  };
}
function load(): BoardConnectionStyle {
  try { return { ...DEFAULT_BOARD_CONNECTION_STYLE, ...validStyle(JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}) }; }
  catch { return { ...DEFAULT_BOARD_CONNECTION_STYLE }; }
}
export const useBoardConnectionStyleStore = create<{ style: BoardConnectionStyle; setStyle(patch: Partial<BoardConnectionStyle>): void }>(set => ({
  style: load(),
  setStyle(patch) { set(state => { const style = { ...state.style, ...validStyle(patch) }; try { localStorage.setItem(key, JSON.stringify(style)); } catch { /* Drawing preferences are best effort. */ } return { style }; }); },
}));

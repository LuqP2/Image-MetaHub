import type { BoardBounds } from './layout';

export interface BoardViewport { x: number; y: number; zoom: number }
/** Coordinates are relative to the stage, in screen pixels. */
export function boardVisibleArea(stage: HTMLElement): BoardBounds {
  const rect = stage.getBoundingClientRect();
  const controls = stage.querySelector('.board-viewport-controls')?.getBoundingClientRect();
  const help = stage.querySelector('.board-help')?.getBoundingClientRect();
  const bottom = Math.max(controls ? rect.bottom - controls.top : 0, help ? rect.bottom - help.top : 0);
  return { x: 32, y: 32, width: Math.max(1, rect.width - 64), height: Math.max(1, rect.height - bottom - 64) };
}
export function visibleBoardCenter(viewport: BoardViewport, area: BoardBounds) {
  return { x: (area.x + area.width / 2 - viewport.x) / viewport.zoom, y: (area.y + area.height / 2 - viewport.y) / viewport.zoom };
}
export function revealBoardBounds(viewport: BoardViewport, bounds: BoardBounds, area: BoardBounds, shrink = false): BoardViewport {
  const zoom = shrink ? Math.max(0.1, Math.min(viewport.zoom, area.width / Math.max(1, bounds.width), area.height / Math.max(1, bounds.height))) : viewport.zoom;
  const revealAxis = (offset: number, start: number, size: number, availableStart: number, availableSize: number) => {
    const renderedSize = size * zoom;
    if (renderedSize > availableSize) return availableStart + (availableSize - renderedSize) / 2 - start * zoom;
    return Math.max(availableStart - start * zoom, Math.min(availableStart + availableSize - (start + size) * zoom, offset));
  };
  return { zoom, x: revealAxis(viewport.x, bounds.x, bounds.width, area.x, area.width), y: revealAxis(viewport.y, bounds.y, bounds.height, area.y, area.height) };
}
export const boardMotionDuration = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;

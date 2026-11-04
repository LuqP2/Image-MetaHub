export const BOARD_BROWSER_ROW_HEIGHT = 140;
export function browserMarqueeIds(ids: string[], width: number, box: { left: number; top: number; right: number; bottom: number }): string[] {
  const columnWidth = Math.max(1, (width - 24) / 2);
  const selected: string[] = [];
  const first = Math.max(0, Math.floor(box.top / BOARD_BROWSER_ROW_HEIGHT));
  const last = Math.min(Math.ceil(ids.length / 2) - 1, Math.floor(box.bottom / BOARD_BROWSER_ROW_HEIGHT));
  for (let row = first; row <= last; row++) for (let column = 0; column < 2; column++) {
    const id = ids[row * 2 + column];
    const x = 8 + column * (columnWidth + 8), y = row * BOARD_BROWSER_ROW_HEIGHT + 4;
    if (id && x < box.right && x + columnWidth > box.left && y < box.bottom && y + BOARD_BROWSER_ROW_HEIGHT - 8 > box.top) selected.push(id);
  }
  return selected;
}

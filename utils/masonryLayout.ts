export interface MasonryItem {
  key: string;
  aspectRatio?: number;
  header?: boolean;
}

export interface MasonryRect {
  index: number;
  key: string;
  column: number;
  left: number;
  top: number;
  width: number;
  height: number;
  imageHeight: number;
  header: boolean;
}

export interface MasonryLayout {
  rects: MasonryRect[];
  columns: MasonryRect[][];
  headers: MasonryRect[];
  height: number;
  cardWidth: number;
}

/** Input order is retained; only the visual placement changes. */
export function buildMasonryLayout(
  items: MasonryItem[], width: number, preferredWidth: number,
  gap: number, filenameHeight: number, headerHeight: number,
): MasonryLayout {
  // Match the regular virtual grid: leading gutter + card width per column.
  const available = Math.max(1, width);
  const count = Math.max(1, Math.floor(available / (preferredWidth + gap)));
  const cardWidth = Math.min(preferredWidth, Math.max(1, available - gap));
  const columns: MasonryRect[][] = Array.from({ length: count }, () => []);
  const bottoms = Array<number>(count).fill(gap);
  const headers: MasonryRect[] = [];
  const rects = items.map((item, index): MasonryRect => {
    if (item.header) {
      const top = Math.max(...bottoms);
      const rect = { index, key: item.key, column: -1, left: 0, top,
        width, height: headerHeight, imageHeight: 0, header: true };
      bottoms.fill(top + headerHeight + gap);
      headers.push(rect);
      return rect;
    }
    let column = 0;
    for (let c = 1; c < count; c++) if (bottoms[c] < bottoms[column]) column = c;
    const ratio = item.aspectRatio;
    const imageHeight = ratio && Number.isFinite(ratio) && ratio > 0
      ? cardWidth / ratio : cardWidth * 1.2;
    const rect = { index, key: item.key, column, left: gap + column * (cardWidth + gap),
      top: bottoms[column], width: cardWidth, height: imageHeight + filenameHeight,
      imageHeight, header: false };
    bottoms[column] += rect.height + gap;
    columns[column].push(rect);
    return rect;
  });
  return { rects, columns, headers, height: Math.max(...bottoms), cardWidth };
}

/** Binary search each ordered column so scrolling does not scan the entire library. */
export function masonryWindow(layout: MasonryLayout, top: number, bottom: number): MasonryRect[] {
  const result: MasonryRect[] = [];
  for (const column of [...layout.columns, layout.headers]) {
    let low = 0;
    let high = column.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (column[mid].top + column[mid].height < top) low = mid + 1;
      else high = mid;
    }
    for (let i = low; i < column.length && column[i].top <= bottom; i++) result.push(column[i]);
  }
  return result.sort((a, b) => a.index - b.index);
}

export function masonrySelection(layout: MasonryLayout, box: { left: number; right: number; top: number; bottom: number }): MasonryRect[] {
  return masonryWindow(layout, box.top, box.bottom).filter(rect =>
    !rect.header && rect.left <= box.right && rect.left + rect.width >= box.left);
}

export function masonryKeyboardTarget(layout: MasonryLayout, current: number, key: string, viewportHeight: number): number {
  const first = layout.rects.find(rect => !rect.header);
  const last = [...layout.rects].reverse().find(rect => !rect.header);
  if (!first || !last) return -1;
  if (key === 'Home') return first.index;
  if (key === 'End') return last.index;
  const rect = layout.rects[current];
  if (!rect || rect.header) return first.index;
  const center = rect.top + rect.height / 2;
  const direction = key === 'ArrowUp' || key === 'PageUp' ? -1 : 1;
  const column = key === 'ArrowLeft' ? rect.column - 1 : key === 'ArrowRight' ? rect.column + 1 : rect.column;
  let candidates = layout.columns[column] ?? [];
  const isVertical = key === 'ArrowUp' || key === 'ArrowDown' || key === 'PageUp' || key === 'PageDown';
  if (isVertical) candidates = candidates.filter(candidate => direction * (candidate.top - rect.top) > 0);
  const targetCenter = key === 'PageUp' || key === 'PageDown' ? center + direction * viewportHeight : center;
  let best = rect;
  let distance = Infinity;
  for (const candidate of candidates) {
    const delta = Math.abs(candidate.top + candidate.height / 2 - targetCenter);
    if (delta < distance) { best = candidate; distance = delta; }
  }
  return best.index;
}

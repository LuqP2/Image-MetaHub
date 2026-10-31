import { boardGroupLabel } from '../../services/boards/presentation';
import { useMemo, useState } from 'react';
import { FixedSizeGrid } from 'react-window';
import BoardLocalSizer from './BoardLocalSizer';
import { matrixCellKey, type BoardGroupedLayout } from '../../services/boards/grouping';
import BoardGroupPreview from './BoardGroupPreview';
import BoardSmartFrameResults from './BoardSmartFrameResults';
import { BoardBrowseHeader, BoardGroupSort, compareBoardGroups, useBoardGroupOrder, useBoardBrowse } from './useBoardBrowse';
type Matrix = Extract<BoardGroupedLayout, { kind: 'matrix' }>;
const CW = 220, CH = 160, HH = 44, HW = 180;
export default function BoardSmartFrameMatrix({ frameId, matrix }: { frameId: string; matrix: Matrix }) {
  const [order, setOrder] = useBoardGroupOrder(frameId);
  const rows = useMemo(() => [...matrix.rows].sort(compareBoardGroups(order)), [matrix.rows, order]);
  const columns = useMemo(() => [...matrix.columns].sort(compareBoardGroups(order)), [matrix.columns, order]);
  const [offset, setOffset] = useState({ left: 0, top: 0 });
  const browse = useBoardBrowse(key => {
    const pair = JSON.parse(key) as string[];
    const row = matrix.rows.find(item => item.key === pair[0]), column = matrix.columns.find(item => item.key === pair[1]);
    return row && column ? { key, rawLabel: `${row.label} / ${column.label}`, label: `${boardGroupLabel(row)} › ${boardGroupLabel(column)}`, ids: matrix.cells[key]?.imageIds ?? [] } : undefined;
  });
  return <div className="board-group-layout nodrag nopan nowheel" data-board-results="true" onKeyDown={event => event.stopPropagation()}>
    {browse.notice && <small role="status">{browse.notice}</small>}
    {browse.selected ? <><BoardBrowseHeader frameId={frameId} entry={browse.selected} back={browse.back} /><BoardSmartFrameResults frameId={frameId} imageIds={browse.selected.ids} /></> : <>
      <BoardGroupSort value={order} change={setOrder} /><small>Rows / columns. Empty cells have no results.</small>
      <div className="board-group-scroll"><BoardLocalSizer>{({ width, height }) => {
        const gw = Math.max(1, width - HW), gh = Math.max(1, height - HH);
        const cs = Math.floor(offset.left / CW), rs = Math.floor(offset.top / CH);
        return <div className="board-matrix" style={{ width, height }}>
          <div className="board-matrix-corner" style={{ width: HW, height: HH }} />
          <div className="board-matrix-column-headings" style={{ left: HW, width: gw, height: HH }}>
            {columns.slice(cs, cs + Math.ceil(gw / CW) + 1).map((column, index) => <div tabIndex={0} title={column.label} className="board-matrix-heading" key={column.key} style={{ left: (cs + index) * CW - offset.left, width: CW, height: HH }}>{boardGroupLabel(column)}</div>)}
          </div>
          <div className="board-matrix-row-headings" style={{ top: HH, width: HW, height: gh }}>
            {rows.slice(rs, rs + Math.ceil(gh / CH) + 1).map((row, index) => <div tabIndex={0} title={row.label} className="board-matrix-heading" key={row.key} style={{ top: (rs + index) * CH - offset.top, width: HW, height: CH }}>{boardGroupLabel(row)}</div>)}
          </div>
          <div style={{ position: 'absolute', left: HW, top: HH }}><FixedSizeGrid className="scrollbar-thin" width={gw} height={gh} columnWidth={CW} rowHeight={CH}
            columnCount={columns.length} rowCount={rows.length} overscanColumnCount={1} overscanRowCount={1}
            initialScrollLeft={browse.scroll.current.left} initialScrollTop={browse.scroll.current.top}
            onScroll={({ scrollLeft, scrollTop }) => { browse.scroll.current = { left: scrollLeft, top: scrollTop }; setOffset({ left: scrollLeft, top: scrollTop }); }}
            itemKey={({ rowIndex, columnIndex }) => matrixCellKey(rows[rowIndex].key, columns[columnIndex].key)}>
            {({ rowIndex, columnIndex, style }) => {
              const row = rows[rowIndex], column = columns[columnIndex], key = matrixCellKey(row.key, column.key);
              return <div style={style}><BoardGroupPreview frameId={frameId} label={`${boardGroupLabel(row)} › ${boardGroupLabel(column)}`} rawLabel={`${row.label} / ${column.label}`} ids={matrix.cells[key]?.imageIds ?? []} constraints={[row.constraint, column.constraint]} open={() => browse.open(key)} /></div>;
            }}
          </FixedSizeGrid></div>
        </div>;
      }}</BoardLocalSizer></div>
    </>}
  </div>;
}

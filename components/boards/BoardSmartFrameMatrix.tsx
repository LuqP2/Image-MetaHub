import { useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeGrid } from 'react-window';
import { matrixCellKey, type BoardGroupedLayout } from '../../services/boards/grouping';
import BoardGroupPreview from './BoardGroupPreview';
import BoardSmartFrameResults from './BoardSmartFrameResults';

type Matrix = Extract<BoardGroupedLayout, { kind: 'matrix' }>;
export default function BoardSmartFrameMatrix({ frameId, matrix }: { frameId: string; matrix: Matrix }) {
  const [opened, setOpened] = useState<string | null>(null);
  const selected = opened ? matrix.cells[opened] : null;
  return <div className="board-group-layout nodrag nopan nowheel" data-board-results="true" onKeyDown={event => event.stopPropagation()}>
    {opened ? <><button className="board-button" onClick={() => setOpened(null)}>Back to matrix</button><BoardSmartFrameResults frameId={frameId} imageIds={selected?.imageIds ?? []} /></> : <>
      <small>Rows × columns. Empty cells are combinations with no results.</small>
      <div className="board-group-scroll"><AutoSizer>{({ width, height }) => width > 0 && height > 0 ? <FixedSizeGrid width={width} height={height}
        columnCount={matrix.columns.length + 1} rowCount={matrix.rows.length + 1} columnWidth={250} rowHeight={190} overscanRowCount={1} overscanColumnCount={1}>
        {({ columnIndex, rowIndex, style }) => {
          if (!columnIndex && !rowIndex) return <div style={style} />;
          if (!rowIndex) return <div className="board-matrix-heading" style={style}>{matrix.columns[columnIndex - 1].label}</div>;
          if (!columnIndex) return <div className="board-matrix-heading" style={style}>{matrix.rows[rowIndex - 1].label}</div>;
          const row = matrix.rows[rowIndex - 1], column = matrix.columns[columnIndex - 1];
          const key = matrixCellKey(row.key, column.key);
          return <div style={style}><BoardGroupPreview frameId={frameId} label={`${row.label} × ${column.label}`} ids={matrix.cells[key]?.imageIds ?? []}
            constraints={[row.constraint, column.constraint]} open={() => setOpened(key)} /></div>;
        }}
      </FixedSizeGrid> : null}</AutoSizer></div>
    </>}
  </div>;
}

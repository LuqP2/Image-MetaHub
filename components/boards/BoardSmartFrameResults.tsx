import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeGrid } from 'react-window';
import { useBoardQueryActions } from './BoardQueryContext';
import BoardResultThumbnail from './BoardResultThumbnail';

export default function BoardSmartFrameResults({ imageIds, frameId }: { imageIds: string[]; frameId: string }) {
  const actions = useBoardQueryActions();
  return <div data-board-results="true" className="board-smart-results nodrag nopan nowheel" onKeyDown={event => event.stopPropagation()}>
    <AutoSizer>{({ width, height }) => {
      if (width <= 0 || height <= 0) return null;
      const columns = Math.max(1, Math.floor(width / 120));
      return <FixedSizeGrid width={width} height={height} columnWidth={width / columns} rowHeight={116} columnCount={columns}
        rowCount={Math.ceil(imageIds.length / columns)} overscanRowCount={1} itemKey={({ columnIndex, rowIndex }) => imageIds[rowIndex * columns + columnIndex] ?? `empty-${rowIndex}-${columnIndex}`}>
        {({ columnIndex, rowIndex, style }) => {
          const id = imageIds[rowIndex * columns + columnIndex];
          const image = id ? actions?.images.get(id) : null;
          return <div style={style}>{image && <BoardResultThumbnail image={image} open={() => actions?.open(id, frameId, imageIds)} />}</div>;
        }}
      </FixedSizeGrid>;
    }}</AutoSizer>
  </div>;
}

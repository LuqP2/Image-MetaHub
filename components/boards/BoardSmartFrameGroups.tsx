import { boardGroupLabel } from '../../services/boards/presentation';
import { useMemo } from 'react';
import { FixedSizeList } from 'react-window';
import BoardLocalSizer from './BoardLocalSizer';
import type { BoardGroupBucket } from '../../services/boards/grouping';
import BoardGroupPreview from './BoardGroupPreview';
import BoardSmartFrameResults from './BoardSmartFrameResults';
import { BoardBrowseHeader, BoardGroupSort, compareBoardGroups, useBoardGroupOrder, useBoardBrowse } from './useBoardBrowse';
export default function BoardSmartFrameGroups({ frameId, groups }: { frameId: string; groups: BoardGroupBucket[] }) {
  const [order, setOrder] = useBoardGroupOrder(frameId);
  const entries = useMemo(() => [...groups].sort(compareBoardGroups(order)).flatMap(group => [
    { key: group.key, label: boardGroupLabel(group), rawLabel: group.label, ids: group.imageIds, constraints: [group.constraint] },
    ...[...(group.subgroups ?? [])].sort(compareBoardGroups(order)).map(subgroup => ({ key: JSON.stringify([group.key, subgroup.key]), label: `${boardGroupLabel(group)} › ${boardGroupLabel(subgroup)}`, rawLabel: `${group.label} / ${subgroup.label}`, ids: subgroup.imageIds, constraints: [group.constraint, subgroup.constraint] })),
  ]), [groups, order]);
  const browse = useBoardBrowse(key => entries.find(entry => entry.key === key));
  return <div className="board-group-layout nodrag nopan nowheel" data-board-results="true" onKeyDown={event => event.stopPropagation()}>
    {browse.notice && <small role="status">{browse.notice}</small>}
    {browse.selected ? <><BoardBrowseHeader frameId={frameId} entry={browse.selected} back={browse.back} /><BoardSmartFrameResults frameId={frameId} imageIds={browse.selected.ids} /></> : <>
      <BoardGroupSort value={order} change={setOrder} />
      <small>Images can appear in multiple groups. Frame totals count unique images.</small>
      <div className="board-group-scroll"><BoardLocalSizer>{({ width, height }) => <FixedSizeList className="scrollbar-thin" width={width} height={height} itemCount={entries.length} itemSize={160} itemKey={index => entries[index].key} overscanCount={1}
        initialScrollOffset={browse.scroll.current.top} onScroll={({ scrollOffset }) => { browse.scroll.current.top = scrollOffset; }}>
        {({ index, style }) => { const entry = entries[index]; return <div style={style}><BoardGroupPreview frameId={frameId} label={entry.label} rawLabel={entry.rawLabel} ids={entry.ids} constraints={entry.constraints} open={() => browse.open(entry.key)} /></div>; }}
      </FixedSizeList>}</BoardLocalSizer></div>
    </>}
  </div>;
}

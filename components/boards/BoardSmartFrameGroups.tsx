import { useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList } from 'react-window';
import type { BoardGroupBucket } from '../../services/boards/grouping';
import BoardGroupPreview from './BoardGroupPreview';
import BoardSmartFrameResults from './BoardSmartFrameResults';

export default function BoardSmartFrameGroups({ frameId, groups }: { frameId: string; groups: BoardGroupBucket[] }) {
  const [opened, setOpened] = useState<string | null>(null);
  const entries = groups.flatMap(group => [
    { key: group.key, label: group.label, ids: group.imageIds, constraints: [group.constraint] },
    ...(group.subgroups ?? []).map(subgroup => ({ key: JSON.stringify([group.key, subgroup.key]), label: `${group.label} / ${subgroup.label}`, ids: subgroup.imageIds, constraints: [group.constraint, subgroup.constraint] })),
  ]);
  const selected = entries.find(entry => entry.key === opened);
  return <div className="board-group-layout nodrag nopan nowheel" data-board-results="true" onKeyDown={event => event.stopPropagation()}>
    {selected ? <><button className="board-button" onClick={() => setOpened(null)}>Back to groups</button><small>{selected.label}</small><BoardSmartFrameResults frameId={frameId} imageIds={selected.ids} /></> : <>
      <small>Images may appear in multiple groups. Frame totals count unique images.</small>
      <div className="board-group-scroll"><AutoSizer>{({ width, height }) => width > 0 && height > 0 ? <FixedSizeList width={width} height={height} itemCount={entries.length} itemSize={190} itemKey={index => entries[index].key} overscanCount={1}>
        {({ index, style }) => { const entry = entries[index]; return <div style={style}><BoardGroupPreview frameId={frameId} label={entry.label} ids={entry.ids} constraints={entry.constraints} open={() => setOpened(entry.key)} /></div>; }}
      </FixedSizeList> : null}</AutoSizer></div>
    </>}
  </div>;
}

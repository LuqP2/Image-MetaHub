import type { BoardGroupingDimension, BoardSmartFrameLayout } from '../../services/boards/queryTypes';
import { groupingLabels } from '../../services/boards/grouping';

export default function BoardSmartFrameLayoutEditor({ layout, disabled, change }: { layout: BoardSmartFrameLayout; disabled: boolean; change(layout: BoardSmartFrameLayout): void }) {
  const options = Object.entries(groupingLabels);
  return <fieldset disabled={disabled}><legend>Layout</legend>
    <label>Layout mode<select className="board-input" value={layout.kind} onChange={event => change(event.target.value === 'grid' ? { kind: 'grid' } : event.target.value === 'groups' ? { kind: 'groups', groupBy: 'model', subgroupBy: null } : { kind: 'matrix', rows: 'generator', columns: 'rating' })}>
      <option value="grid">Grid</option><option value="groups">Groups</option><option value="matrix">Metadata matrix</option>
    </select></label>
    {layout.kind === 'groups' && <>
      <label>Organize by<select className="board-input" value={layout.groupBy} onChange={event => change({ ...layout, groupBy: event.target.value as BoardGroupingDimension })}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Subgroup by<select className="board-input" value={layout.subgroupBy ?? ''} onChange={event => change({ ...layout, subgroupBy: event.target.value ? event.target.value as BoardGroupingDimension : null })}><option value="">None</option>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </>}
    {layout.kind === 'matrix' && (['rows', 'columns'] as const).map(axis => <label key={axis}>{axis === 'rows' ? 'Rows' : 'Columns'}<select className="board-input" value={layout[axis]} onChange={event => change({ ...layout, [axis]: event.target.value as BoardGroupingDimension })}>
      {options.filter(([value]) => value !== layout[axis === 'rows' ? 'columns' : 'rows']).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>)}
  </fieldset>;
}

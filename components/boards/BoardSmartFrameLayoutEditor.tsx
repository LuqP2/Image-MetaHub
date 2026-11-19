import { useTranslation } from '../../i18n/useTranslation';
import { boardGroupingLabel } from './boardPresentation';
import type { BoardGroupingDimension, BoardSmartFrameLayout } from '../../services/boards/queryTypes';
import { groupingLabels } from '../../services/boards/grouping';

export default function BoardSmartFrameLayoutEditor({ layout, disabled, change }: { layout: BoardSmartFrameLayout; disabled: boolean; change(layout: BoardSmartFrameLayout): void }) {
  const { t } = useTranslation();
  const options = Object.keys(groupingLabels).map(value => [value, boardGroupingLabel(value as BoardGroupingDimension, t)] as const);
  return <fieldset disabled={disabled}><legend>{t('canvas.layout')}</legend>
    <label>{t('canvas.layoutMode')}<select className="board-input" value={layout.kind} onChange={event => change(event.target.value === 'grid' ? { kind: 'grid' } : event.target.value === 'groups' ? { kind: 'groups', groupBy: 'model', subgroupBy: null } : { kind: 'matrix', rows: 'generator', columns: 'rating' })}>
      <option value="grid">{t('canvas.grid')}</option><option value="groups">{t('canvas.groups')}</option><option value="matrix">{t('canvas.matrix')}</option>
    </select></label>
    {layout.kind === 'groups' && <>
      <label>{t('canvas.organizeBy')}<select className="board-input" value={layout.groupBy} onChange={event => change({ ...layout, groupBy: event.target.value as BoardGroupingDimension })}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>{t('canvas.subgroupBy')}<select className="board-input" value={layout.subgroupBy ?? ''} onChange={event => change({ ...layout, subgroupBy: event.target.value ? event.target.value as BoardGroupingDimension : null })}><option value="">{t('canvas.none')}</option>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </>}
    {layout.kind === 'matrix' && (['rows', 'columns'] as const).map(axis => <label key={axis}>{axis === 'rows' ? t('canvas.rows') : t('canvas.columns')}<select className="board-input" value={layout[axis]} onChange={event => change({ ...layout, [axis]: event.target.value as BoardGroupingDimension })}>
      {options.filter(([value]) => value !== layout[axis === 'rows' ? 'columns' : 'rows']).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>)}
  </fieldset>;
}

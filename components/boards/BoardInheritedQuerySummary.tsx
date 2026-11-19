import { createBoardPresentation } from '../../services/boards/presentation';
import { useTranslation, type Translate } from '../../i18n/useTranslation';
import { formatMessage } from '../../i18n/messages.mjs';
import { boardMediaLabel } from './boardPresentation';
const english: Translate = (key, values) => formatMessage('en', key, values);
import type { BoardSetExpression, BoardSmartFrameObject } from '../../services/boards/queryTypes';
import type { LibraryQueryCriteria } from '../../services/libraryQuery/types';

export function summarizeBoardCriteria(criteria: LibraryQueryCriteria, t: Translate = english): string[] {
  const { boardValueLabel } = createBoardPresentation(t);
  const valueLabel = (label: string, value: string) => t('canvas.filterValue', { label, value });
  const items: string[] = [];
  if (criteria.searchQuery.trim()) items.push(valueLabel(t('librarySearch.search'), criteria.searchQuery));
  const fields = { selectedNodes: t('canvas.nodes'), selectedModels: t('librarySearch.checkpoints'), excludedModels: t('librarySearch.excludeItem', { item: t('librarySearch.checkpoints') }), selectedLoras: t('comparison.loras'), excludedLoras: t('librarySearch.excludeItem', { item: t('comparison.loras') }),
    selectedSamplers: t('librarySearch.samplers'), excludedSamplers: t('librarySearch.excludeItem', { item: t('librarySearch.samplers') }), selectedSchedulers: t('librarySearch.schedulers'), excludedSchedulers: t('librarySearch.excludeItem', { item: t('librarySearch.schedulers') }),
    selectedGenerators: t('canvas.generators'), excludedGenerators: t('librarySearch.excludeItem', { item: t('canvas.generators') }), selectedGpuDevices: t('canvas.gpus'), excludedGpuDevices: t('librarySearch.excludeItem', { item: t('canvas.gpus') }),
    selectedTags: t('canvas.tagsMode', { mode: t(criteria.selectedTagsMatchMode === 'all' ? 'libraryTags.all' : 'libraryTags.any') }), excludedTags: t('librarySearch.excludeItem', { item: t('comparison.tags') }), selectedAutoTags: t('canvas.autoTags'), excludedAutoTags: t('librarySearch.excludeItem', { item: t('canvas.autoTags') }),
    selectedFolders: t('libraryFolders.folders'), excludedFolders: t('librarySearch.excludeItem', { item: t('libraryFolders.folders') }), selectedRatings: t('canvas.ratings') } as const;
  for (const [key, label] of Object.entries(fields)) {
    const values = criteria[key as keyof typeof fields];
    if (values?.length) items.push(valueLabel(label, values.map(value => boardValueLabel(String(value))).join(', ')));
  }
  if (criteria.favoriteFilterMode !== 'neutral') items.push(criteria.favoriteFilterMode === 'include' ? t('librarySearch.favoritesOnly') : t('librarySearch.excludeFavoritesChip'));
  if (criteria.selectedFolders.length && !criteria.includeSubfolders) items.push(t('canvas.directFolders'));
  const advanced = criteria.advancedFilters;
  if (advanced.dimension) items.push(valueLabel(t('canvas.resolution'), advanced.dimension));
  if (advanced.date?.from || advanced.date?.to) items.push(valueLabel(t('canvas.date'), `${advanced.date.from || t('canvas.anyBound')} – ${advanced.date.to || t('canvas.anyBound')}`));
  for (const [key, label] of [['steps', t('librarySearch.steps')], ['cfg', 'CFG'], ['generationTimeMs', t('canvas.generationTimeMs')], ['stepsPerSecond', t('canvas.stepsPerSecond')], ['vramPeakMb', t('canvas.vramMb')]] as const) {
    const range = advanced[key];
    if (range) items.push(valueLabel(label, `${range.min ?? t('canvas.anyBound')} – ${range.maxExclusive ? '< ' : ''}${range.max ?? t('canvas.anyBound')}`));
  }
  if (advanced.mediaTypes?.length) items.push(valueLabel(t('canvas.media'), advanced.mediaTypes.map(type => boardMediaLabel(type, t)).join(', ')));
  if (advanced.generationModes?.length) items.push(valueLabel(t('canvas.generationMode'), advanced.generationModes.join(', ')));
  if (advanced.telemetryState) items.push(valueLabel(t('canvas.telemetry'), advanced.telemetryState));
  if (advanced.hasVerifiedTelemetry) items.push(t('canvas.verifiedOnly'));
  return items;
}
export default function BoardInheritedQuerySummary({ source, frames }: { source: BoardSetExpression; frames: BoardSmartFrameObject[] }) {
  const { t } = useTranslation();
  const roleKeys = { Source: 'canvas.source', 'Intersection input': 'canvas.intersectionInput', Keep: 'canvas.keep', Subtract: 'canvas.subtract' } as const;
  const roleLabel = (role: keyof typeof roleKeys) => t(roleKeys[role]);
  const entries: Array<{ title: string; criteria?: LibraryQueryCriteria; constraints?: number }> = [];
  const visited = new Set<string>();
  const visit = (expression: BoardSetExpression, role: keyof typeof roleKeys = 'Source') => {
    if (expression.kind === 'frame') {
      const key = `${role}:${expression.frameId}`;
      if (visited.has(key)) return;
      visited.add(key);
      const parent = frames.find(frame => frame.id === expression.frameId);
      if (!parent) { entries.push({ title: t('canvas.reconnectSource') }); return; }
      entries.push({ title: t('canvas.filterValue', { label: roleLabel(role), value: parent.title }), criteria: parent.criteria, constraints: parent.groupConstraints.length });
      visit(parent.source, role);
    } else if (expression.kind === 'query') {
      entries.push({ title: t('canvas.filterValue', { label: roleLabel(role), value: t('canvas.independentQuery') }), criteria: expression.criteria, constraints: expression.groupConstraints.length }); visit(expression.source, role);
    } else if (expression.kind === 'intersection') expression.inputs.forEach(input => visit(input, 'Intersection input'));
    else if (expression.kind === 'difference') { visit(expression.left, 'Keep'); visit(expression.right, 'Subtract'); }
  };
  visit(source);
  if (!entries.length) return null;
  return <section aria-label={t('canvas.inheritedFilters')}><h3>{t('canvas.inheritedFilters')}</h3><p>{t('canvas.inheritedHelp')}</p>
    {entries.map((entry, index) => <div key={index}><strong>{entry.title}</strong>{entry.criteria && <ul>{(summarizeBoardCriteria(entry.criteria, t).length ? summarizeBoardCriteria(entry.criteria, t) : [t('canvas.noAdditionalFilters')]).map(text => <li key={text}>{text}</li>)}</ul>}{!!entry.constraints && <p>{t('canvas.inheritedConstraints', { count: entry.constraints })}</p>}</div>)}
  </section>;
}

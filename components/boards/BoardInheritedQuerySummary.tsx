import type { BoardSetExpression, BoardSmartFrameObject } from '../../services/boards/queryTypes';
import type { LibraryQueryCriteria } from '../../services/libraryQuery/types';

function summary(criteria: LibraryQueryCriteria): string[] {
  const items: string[] = [];
  if (criteria.searchQuery.trim()) items.push(`Search: ${criteria.searchQuery}`);
  const fields = { selectedModels: 'Checkpoints', excludedModels: 'Exclude checkpoints', selectedLoras: 'LoRAs', excludedLoras: 'Exclude LoRAs',
    selectedSamplers: 'Samplers', excludedSamplers: 'Exclude samplers', selectedSchedulers: 'Schedulers', excludedSchedulers: 'Exclude schedulers',
    selectedGenerators: 'Generators', excludedGenerators: 'Exclude generators', selectedGpuDevices: 'GPUs', excludedGpuDevices: 'Exclude GPUs',
    selectedTags: `Tags (${criteria.selectedTagsMatchMode})`, excludedTags: 'Exclude tags', selectedAutoTags: 'Auto-tags', excludedAutoTags: 'Exclude auto-tags',
    selectedFolders: 'Folders', excludedFolders: 'Exclude folders', selectedRatings: 'Ratings' } as const;
  for (const [key, label] of Object.entries(fields)) {
    const values = criteria[key as keyof typeof fields];
    if (values.length) items.push(`${label}: ${values.join(', ')}`);
  }
  if (criteria.favoriteFilterMode !== 'neutral') items.push(criteria.favoriteFilterMode === 'include' ? 'Favorites only' : 'Exclude favorites');
  if (criteria.selectedFolders.length && !criteria.includeSubfolders) items.push('Direct folders only');
  const advanced = criteria.advancedFilters;
  if (advanced.dimension) items.push(`Resolution: ${advanced.dimension}`);
  if (advanced.date?.from || advanced.date?.to) items.push(`Date: ${advanced.date.from || 'any'} – ${advanced.date.to || 'any'}`);
  for (const [key, label] of [['steps', 'Steps'], ['cfg', 'CFG'], ['generationTimeMs', 'Generation time (ms)'], ['stepsPerSecond', 'Steps per second'], ['vramPeakMb', 'VRAM (MB)']] as const) {
    const range = advanced[key];
    if (range) items.push(`${label}: ${range.min ?? 'any'} – ${range.maxExclusive ? '< ' : ''}${range.max ?? 'any'}`);
  }
  if (advanced.mediaTypes?.length) items.push(`Media: ${advanced.mediaTypes.join(', ')}`);
  if (advanced.generationModes?.length) items.push(`Generation mode: ${advanced.generationModes.join(', ')}`);
  if (advanced.telemetryState) items.push(`Telemetry: ${advanced.telemetryState}`);
  if (advanced.hasVerifiedTelemetry) items.push('Verified telemetry only');
  return items;
}
export default function BoardInheritedQuerySummary({ source, frames }: { source: BoardSetExpression; frames: BoardSmartFrameObject[] }) {
  const entries: Array<{ title: string; criteria?: LibraryQueryCriteria; constraints?: number }> = [];
  const visited = new Set<string>();
  const visit = (expression: BoardSetExpression, role = 'Source') => {
    if (expression.kind === 'frame') {
      const key = `${role}:${expression.frameId}`;
      if (visited.has(key)) return;
      visited.add(key);
      const parent = frames.find(frame => frame.id === expression.frameId);
      if (!parent) { entries.push({ title: 'Unavailable source frame — reconnect Source above' }); return; }
      entries.push({ title: `${role}: ${parent.title}`, criteria: parent.criteria, constraints: parent.groupConstraints.length });
      visit(parent.source, role);
    } else if (expression.kind === 'query') {
      entries.push({ title: `${role}: independent query`, criteria: expression.criteria, constraints: expression.groupConstraints.length }); visit(expression.source, role);
    } else if (expression.kind === 'intersection') expression.inputs.forEach(input => visit(input, 'Intersection input'));
    else if (expression.kind === 'difference') { visit(expression.left, 'Keep'); visit(expression.right, 'Subtract'); }
  };
  visit(source);
  if (!entries.length) return null;
  return <section aria-label="Inherited filters"><h3>Inherited filters</h3><p>Local filters refine these source results. Edit a source frame or duplicate independently to change inherited criteria.</p>
    {entries.map((entry, index) => <div key={index}><strong>{entry.title}</strong>{entry.criteria && <ul>{(summary(entry.criteria).length ? summary(entry.criteria) : ['No additional filters']).map(text => <li key={text}>{text}</li>)}</ul>}{!!entry.constraints && <p>{entry.constraints} inherited group constraints</p>}</div>)}
  </section>;
}

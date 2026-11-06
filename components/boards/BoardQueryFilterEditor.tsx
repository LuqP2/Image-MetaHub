import LibraryRatingFilter from '../LibraryRatingFilter';
import LibraryFavoriteFilter from '../LibraryFavoriteFilter';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import FacetFilterSection from '../FacetFilterSection';
import { summarizeBoardCriteria } from './BoardInheritedQuerySummary';
import BoardFacetSelector from './BoardFacetSelector';
import { normalizeLibraryQueryCriteria } from '../../services/libraryQuery/criteria';
import type { BoardQueryFacets } from '../../services/boards/queryProtocol';
import type { LibraryQueryCriteria } from '../../services/libraryQuery/types';
import AdvancedFilters from '../AdvancedFilters';

const dimensions = [
  ['Checkpoints', 'Models', 'availableModels'], ['LoRAs', 'Loras', 'availableLoras'], ['Samplers', 'Samplers', 'availableSamplers'],
  ['Schedulers', 'Schedulers', 'availableSchedulers'], ['Generators', 'Generators', 'availableGenerators'], ['GPU devices', 'GpuDevices', 'availableGpuDevices'],
] as const;
export default function BoardQueryFilterEditor({ value, facets, onChange: emitChange, disabled }: {
  value: LibraryQueryCriteria; facets?: BoardQueryFacets; onChange(value: LibraryQueryCriteria, typing?: boolean): void; disabled: boolean;
}) {
  const [search, setSearch] = useState(value.searchQuery);
  const draft = useRef<string | null>(null);
  const latest = useRef({ value, emitChange }); latest.current = { value, emitChange };
  const onChange = (next: LibraryQueryCriteria, typing = false) => {
    clearTimeout(timer.current);
    if (!typing && draft.current !== null && next.searchQuery === value.searchQuery) next = { ...next, searchQuery: draft.current };
    draft.current = null;
    emitChange(next, typing);
  };
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { setSearch(value.searchQuery); }, [value.searchQuery]);
  useLayoutEffect(() => () => {
    clearTimeout(timer.current);
    if (draft.current !== null) latest.current.emitChange({ ...latest.current.value, searchQuery: draft.current }, true);
  }, []);
  return <fieldset disabled={disabled} className="board-query-filters">
    <label>Search<input className="board-input" aria-label="Query search" value={search} onChange={event => {
      const searchQuery = event.target.value; setSearch(searchQuery); draft.current = searchQuery; clearTimeout(timer.current);
      timer.current = setTimeout(() => { draft.current = null; latest.current.emitChange({ ...latest.current.value, searchQuery }, true); }, 200);
    }} onBlur={() => { clearTimeout(timer.current); if (search !== value.searchQuery) onChange({ ...value, searchQuery: search }, true); }} /></label>
    <div className="board-filter-summary">{summarizeBoardCriteria(value).map(item => <small key={item}>{item}</small>)}</div>
    <button className="board-button" type="button" onClick={() => { draft.current = null; onChange(normalizeLibraryQueryCriteria({ sortOrder: value.sortOrder, randomSeed: value.randomSeed })); }}>Clear local filters</button>
    <small>Counts reflect the current frame results. Choose + to include or - to exclude.</small>
    {[...dimensions, ['Tags', 'Tags', null], ['Auto-tags', 'AutoTags', null], ['Folders', 'Folders', null]].map(([label, suffix, facet]) => {
      const includeKey = `selected${suffix}` as 'selectedModels';
      const excludeKey = `excluded${suffix}` as 'excludedModels';
      const counts = facets?.sourceCounts?.[suffix!];
      const choices = counts?.map(([name]) => name) ?? (facet ? facets?.[facet as 'availableModels'] : []) ?? [];
      return <BoardFacetSelector key={suffix} label={label!} choices={choices} counts={counts} included={value[includeKey]} excluded={value[excludeKey]} disabled={disabled} clear={() => onChange({ ...value, [includeKey]: [], [excludeKey]: [] })}
        change={(name, mode) => onChange({ ...value, [includeKey]: mode === 'include' ? [...new Set([...value[includeKey], name])] : value[includeKey].filter(item => item !== name), [excludeKey]: mode === 'exclude' ? [...new Set([...value[excludeKey], name])] : value[excludeKey].filter(item => item !== name) })} />;
    })}
    <FacetFilterSection title="ComfyUI Nodes" items={facets?.availableNodes ?? []} counts={new Map(facets?.nodeFacetCounts)} selectedValues={value.selectedNodes ?? []} excludedValues={[]} hideExclude
      onIncludeToggle={name => onChange({ ...value, selectedNodes: (value.selectedNodes ?? []).includes(name) ? value.selectedNodes!.filter(item => item !== name) : [...(value.selectedNodes ?? []), name] })}
      onExcludeToggle={() => {}} onClear={() => onChange({ ...value, selectedNodes: [] })} />
    <label>Tag matching<select className="board-input" value={value.selectedTagsMatchMode} onChange={event => onChange({ ...value, selectedTagsMatchMode: event.target.value as 'any' | 'all' })}><option value="any">Any</option><option value="all">All</option></select></label>
    <LibraryFavoriteFilter favoriteFilterMode={value.favoriteFilterMode} count={new Map(facets?.sourceCounts?.Favorites).get('true') ?? 0} onChange={favoriteFilterMode => onChange({ ...value, favoriteFilterMode })} />
    <LibraryRatingFilter selectedRatings={value.selectedRatings} counts={new Map(facets?.sourceCounts?.Ratings?.map(([rating, count]) => [Number(rating), count]))} onChange={selectedRatings => onChange({ ...value, selectedRatings })} />
    <label><input type="checkbox" checked={value.includeSubfolders} onChange={event => onChange({ ...value, includeSubfolders: event.target.checked })} />Include subfolders</label>
    <label>Sort<select className="board-input" value={value.sortOrder} onChange={event => onChange({ ...value, sortOrder: event.target.value as LibraryQueryCriteria['sortOrder'] })}>{['date-desc', 'date-asc', 'asc', 'desc', 'random'].map(sort => <option key={sort}>{sort}</option>)}</select></label>
    <AdvancedFilters advancedFilters={value.advancedFilters} availableDimensions={facets?.availableDimensions ?? []}
      onAdvancedFiltersChange={advancedFilters => onChange({ ...value, advancedFilters })} onClearAdvancedFilters={() => onChange({ ...value, advancedFilters: {} })} />
  </fieldset>;
}

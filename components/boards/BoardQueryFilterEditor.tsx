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
export default function BoardQueryFilterEditor({ value, facets, onChange, disabled }: {
  value: LibraryQueryCriteria; facets?: BoardQueryFacets; onChange(value: LibraryQueryCriteria): void; disabled: boolean;
}) {
  return <fieldset disabled={disabled} className="board-query-filters">
    <label>Search<input className="board-input" aria-label="Query search" value={value.searchQuery} onChange={event => onChange({ ...value, searchQuery: event.target.value })} /></label>
    <div className="board-filter-summary">{summarizeBoardCriteria(value).map(item => <small key={item}>{item}</small>)}</div>
    <button className="board-button" type="button" onClick={() => onChange(normalizeLibraryQueryCriteria({ sortOrder: value.sortOrder, randomSeed: value.randomSeed }))}>Clear local filters</button>
    <small>Counts show images in the source. Choose + to include or - to exclude.</small>
    {[...dimensions, ['Tags', 'Tags', null], ['Auto-tags', 'AutoTags', null], ['Folders', 'Folders', null]].map(([label, suffix, facet]) => {
      const includeKey = `selected${suffix}` as 'selectedModels';
      const excludeKey = `excluded${suffix}` as 'excludedModels';
      const counts = facets?.sourceCounts?.[suffix!];
      const choices = counts?.map(([name]) => name) ?? (facet ? facets?.[facet as 'availableModels'] : []) ?? [];
      return <BoardFacetSelector key={suffix} label={label!} choices={choices} counts={counts} included={value[includeKey]} excluded={value[excludeKey]} disabled={disabled}
        change={(name, mode) => onChange({ ...value, [includeKey]: mode === 'include' ? [...new Set([...value[includeKey], name])] : value[includeKey].filter(item => item !== name), [excludeKey]: mode === 'exclude' ? [...new Set([...value[excludeKey], name])] : value[excludeKey].filter(item => item !== name) })} />;
    })}
    <label>Tag matching<select className="board-input" value={value.selectedTagsMatchMode} onChange={event => onChange({ ...value, selectedTagsMatchMode: event.target.value as 'any' | 'all' })}><option value="any">Any</option><option value="all">All</option></select></label>
    <label>Favorites<select className="board-input" value={value.favoriteFilterMode} onChange={event => onChange({ ...value, favoriteFilterMode: event.target.value as LibraryQueryCriteria['favoriteFilterMode'] })}><option value="neutral">All</option><option value="include">Favorites</option><option value="exclude">Not favorites</option></select></label>
    <div>Ratings{([1, 2, 3, 4, 5] as const).map(rating => <label key={rating}><input type="checkbox" checked={value.selectedRatings.includes(rating)} onChange={event => onChange({ ...value, selectedRatings: event.target.checked ? [...value.selectedRatings, rating] : value.selectedRatings.filter(item => item !== rating) })} />{rating}</label>)}</div>
    <label><input type="checkbox" checked={value.includeSubfolders} onChange={event => onChange({ ...value, includeSubfolders: event.target.checked })} />Include subfolders</label>
    <label>Sort<select className="board-input" value={value.sortOrder} onChange={event => onChange({ ...value, sortOrder: event.target.value as LibraryQueryCriteria['sortOrder'] })}>{['date-desc', 'date-asc', 'asc', 'desc', 'random'].map(sort => <option key={sort}>{sort}</option>)}</select></label>
    <AdvancedFilters advancedFilters={value.advancedFilters} availableDimensions={facets?.availableDimensions ?? []}
      onAdvancedFiltersChange={advancedFilters => onChange({ ...value, advancedFilters })} onClearAdvancedFilters={() => onChange({ ...value, advancedFilters: {} })} />
  </fieldset>;
}

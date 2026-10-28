import { useEffect, useState } from 'react';
import type { LibraryQueryCriteria, LibraryQueryFacets } from '../../services/libraryQuery/types';
import AdvancedFilters from '../AdvancedFilters';

function ListInput({ label, values, suggestions, disabled, change }: { label: string; values: string[]; suggestions?: string[]; disabled: boolean; change(value: string[]): void }) {
  const [text, setText] = useState(values.join(', '));
  const signature = values.join(', ');
  useEffect(() => setText(signature), [signature]);
  return <label>{label}<input className="board-input" aria-label={label} disabled={disabled} value={text}
    title={suggestions?.slice(0, 30).join(', ')} placeholder="Comma-separated values" onChange={event => setText(event.target.value)}
    onBlur={() => change([...new Set(text.split(',').map(value => value.trim()).filter(Boolean))])} /></label>;
}
const dimensions = [
  ['Checkpoints', 'Models', 'availableModels'], ['LoRAs', 'Loras', 'availableLoras'], ['Samplers', 'Samplers', 'availableSamplers'],
  ['Schedulers', 'Schedulers', 'availableSchedulers'], ['Generators', 'Generators', 'availableGenerators'], ['GPU devices', 'GpuDevices', 'availableGpuDevices'],
] as const;
export default function BoardQueryFilterEditor({ value, facets, onChange, disabled }: {
  value: LibraryQueryCriteria; facets?: LibraryQueryFacets; onChange(value: LibraryQueryCriteria): void; disabled: boolean;
}) {
  return <fieldset disabled={disabled} className="board-query-filters">
    <label>Search<input className="board-input" aria-label="Query search" value={value.searchQuery} onChange={event => onChange({ ...value, searchQuery: event.target.value })} /></label>
    {dimensions.map(([label, suffix, facet]) => <div key={suffix}>
      <ListInput label={label} values={value[`selected${suffix}`]} suggestions={facets?.[facet]} disabled={disabled} change={values => onChange({ ...value, [`selected${suffix}`]: values })} />
      <ListInput label={`Exclude ${label.toLowerCase()}`} values={value[`excluded${suffix}`]} disabled={disabled} change={values => onChange({ ...value, [`excluded${suffix}`]: values })} />
    </div>)}
    {(['selectedTags', 'excludedTags', 'selectedAutoTags', 'excludedAutoTags', 'selectedFolders', 'excludedFolders'] as const).map(key =>
      <ListInput key={key} label={{ selectedTags: 'Tags', excludedTags: 'Exclude tags', selectedAutoTags: 'Auto-tags', excludedAutoTags: 'Exclude auto-tags', selectedFolders: 'Folders', excludedFolders: 'Exclude folders' }[key]}
        values={value[key]} disabled={disabled} change={values => onChange({ ...value, [key]: values })} />)}
    <label>Tag matching<select className="board-input" value={value.selectedTagsMatchMode} onChange={event => onChange({ ...value, selectedTagsMatchMode: event.target.value as 'any' | 'all' })}><option value="any">Any</option><option value="all">All</option></select></label>
    <label>Favorites<select className="board-input" value={value.favoriteFilterMode} onChange={event => onChange({ ...value, favoriteFilterMode: event.target.value as LibraryQueryCriteria['favoriteFilterMode'] })}><option value="neutral">All</option><option value="include">Favorites</option><option value="exclude">Not favorites</option></select></label>
    <div>Ratings{([1, 2, 3, 4, 5] as const).map(rating => <label key={rating}><input type="checkbox" checked={value.selectedRatings.includes(rating)} onChange={event => onChange({ ...value, selectedRatings: event.target.checked ? [...value.selectedRatings, rating] : value.selectedRatings.filter(item => item !== rating) })} />{rating}</label>)}</div>
    <label><input type="checkbox" checked={value.includeSubfolders} onChange={event => onChange({ ...value, includeSubfolders: event.target.checked })} />Include subfolders</label>
    <label>Sort<select className="board-input" value={value.sortOrder} onChange={event => onChange({ ...value, sortOrder: event.target.value as LibraryQueryCriteria['sortOrder'] })}>{['date-desc', 'date-asc', 'asc', 'desc', 'random'].map(sort => <option key={sort}>{sort}</option>)}</select></label>
    <AdvancedFilters advancedFilters={value.advancedFilters} availableDimensions={facets?.availableDimensions ?? []}
      onAdvancedFiltersChange={advancedFilters => onChange({ ...value, advancedFilters })} onClearAdvancedFilters={() => onChange({ ...value, advancedFilters: {} })} />
  </fieldset>;
}

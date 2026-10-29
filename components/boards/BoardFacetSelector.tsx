import { useMemo, useState } from 'react';
import { FixedSizeList } from 'react-window';

export default function BoardFacetSelector({ label, choices, counts, included, excluded, disabled, change }: {
  label: string; choices: string[]; counts?: Array<[string, number]>; included: string[]; excluded: string[]; disabled: boolean;
  change(name: string, mode: 'include' | 'exclude' | 'neutral'): void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const countByName = useMemo(() => new Map(counts), [counts]);
  const available = useMemo(() => new Set(choices), [choices]);
  const items = useMemo(() => [...new Set([...included, ...excluded, ...choices])].filter(name => name.toLowerCase().includes(query.toLowerCase())).sort((a, b) =>
    Number(included.includes(b) || excluded.includes(b)) - Number(included.includes(a) || excluded.includes(a)) || (countByName.get(b) ?? 0) - (countByName.get(a) ?? 0) || a.localeCompare(b)), [included, excluded, choices, query, countByName]);
  return <section className="board-facet" onKeyDown={event => event.stopPropagation()}>
    <button type="button" className="board-section-trigger" aria-expanded={open} onClick={() => setOpen(!open)}>{label}<span>{included.length + excluded.length || ''} {open ? '−' : '+'}</span></button>
    <div className="board-filter-chips">{[...new Set([...included, ...excluded])].map(name => <button className="board-filter-chip" type="button" key={name} disabled={disabled} title={`${name}${available.has(name) ? '' : ' (not available in source)'}`} aria-label={`Remove ${label}: ${name}`} onClick={() => change(name, 'neutral')}>
      {excluded.includes(name) ? '− ' : '+ '}{name}{!available.has(name) && ' (unavailable)'} ×
    </button>)}</div>
    {open && <><input className="board-input" aria-label={`Search ${label}`} placeholder={`Search ${label.toLowerCase()}…`} value={query} onChange={event => setQuery(event.target.value)} />
      {items.length ? <FixedSizeList height={Math.min(224, items.length * 44)} width="100%" itemCount={items.length} itemSize={44} itemKey={index => items[index]}>
        {({ index, style }) => { const name = items[index]; return <div style={style} className="board-facet-row">
          <span title={name}>{name}<small>{countByName.has(name) ? `${countByName.get(name)} in source` : available.has(name) ? '' : 'Unavailable'}</small></span>
          <button type="button" className="board-button" disabled={disabled} aria-label={`Include ${label}: ${name}`} aria-pressed={included.includes(name)} onClick={() => change(name, included.includes(name) ? 'neutral' : 'include')}>+</button>
          <button type="button" className="board-button" disabled={disabled} aria-label={`Exclude ${label}: ${name}`} aria-pressed={excluded.includes(name)} onClick={() => change(name, excluded.includes(name) ? 'neutral' : 'exclude')}>−</button>
        </div>; }}
      </FixedSizeList> : <small>No matching values in the source.</small>}
    </>}
  </section>;
}

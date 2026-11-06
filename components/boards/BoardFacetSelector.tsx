import FacetFilterSection from '../FacetFilterSection';

export default function BoardFacetSelector({ label, choices, counts, included, excluded, disabled, change, clear }: {
  label: string; choices: string[]; counts?: Array<[string, number]>; included: string[]; excluded: string[]; disabled: boolean;
  change(name: string, mode: 'include' | 'exclude' | 'neutral'): void;
  clear(): void;
}) {
  return <fieldset disabled={disabled}><FacetFilterSection title={label} items={choices} counts={new Map(counts)} selectedValues={included} excludedValues={excluded}
    onIncludeToggle={name => change(name, included.includes(name) ? 'neutral' : 'include')}
    onExcludeToggle={name => change(name, excluded.includes(name) ? 'neutral' : 'exclude')}
    onClear={clear} />
  </fieldset>;
}

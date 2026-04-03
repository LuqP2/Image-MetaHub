import React, { useMemo, useState } from 'react';
import { ChevronDown, Minus, Plus, Search, X } from 'lucide-react';

interface FacetFilterSectionProps {
  title: string;
  items: string[];
  counts?: Map<string, number>;
  selectedValues: string[];
  excludedValues: string[];
  onIncludeToggle: (value: string) => void;
  onExcludeToggle: (value: string) => void;
  onClear: () => void;
  emptyLabel?: string;
  searchPlaceholder?: string;
  defaultExpanded?: boolean;
}

const sortAlpha = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());

const FacetFilterSection: React.FC<FacetFilterSectionProps> = ({
  title,
  items,
  counts,
  selectedValues,
  excludedValues,
  onIncludeToggle,
  onExcludeToggle,
  onClear,
  emptyLabel = 'No items available.',
  searchPlaceholder,
  defaultExpanded = true,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [query, setQuery] = useState('');

  const mergedItems = useMemo(() => {
    const deduped = new Set<string>();
    [...selectedValues, ...excludedValues, ...items]
      .filter((item) => typeof item === 'string' && item.trim() !== '')
      .forEach((item) => deduped.add(item));

    return Array.from(deduped).sort((a, b) => {
      const aActive = selectedValues.includes(a) || excludedValues.includes(a);
      const bActive = selectedValues.includes(b) || excludedValues.includes(b);
      if (aActive !== bActive) return aActive ? -1 : 1;

      const aCount = counts?.get(a) ?? 0;
      const bCount = counts?.get(b) ?? 0;
      if (aCount !== bCount) return bCount - aCount;

      return sortAlpha(a, b);
    });
  }, [counts, excludedValues, items, selectedValues]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return mergedItems;

    return mergedItems.filter((item) => item.toLowerCase().includes(normalizedQuery));
  }, [mergedItems, query]);

  const showSearch = mergedItems.length > 6 || query.length > 0;
  const activeCount = selectedValues.length + excludedValues.length;

  return (
    <div className="rounded-xl border border-gray-800/80 bg-gray-900/40">
      <div className="flex items-start gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex min-w-0 flex-1 items-start justify-between rounded-xl text-left hover:bg-gray-800/50 transition-colors"
        >
          <div className="min-w-0 py-0.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-100">{title}</span>
              <span className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-[11px] text-gray-400">
                {mergedItems.length}
              </span>
              {selectedValues.length > 0 && (
                <span className="rounded border border-emerald-700/60 bg-emerald-950/60 px-2 py-0.5 text-[11px] text-emerald-300">
                  {selectedValues.length} include
                </span>
              )}
              {excludedValues.length > 0 && (
                <span className="rounded border border-rose-700/60 bg-rose-950/60 px-2 py-0.5 text-[11px] text-rose-300">
                  {excludedValues.length} exclude
                </span>
              )}
            </div>
          </div>
          <div className="ml-3 flex items-center gap-2 py-1">
            <ChevronDown
              className={`h-4 w-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
          </div>
        </button>
        <div className="flex items-center py-1">
          {activeCount > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onClear();
              }}
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-800 hover:text-rose-300 transition-colors"
              title={`Clear ${title.toLowerCase()} filters`}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-gray-800/80 px-4 pb-4 pt-3">
          {showSearch && (
            <label className="mb-3 flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2">
              <Search className="h-4 w-4 text-gray-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder ?? `Filter ${title.toLowerCase()}...`}
                className="w-full bg-transparent text-sm text-gray-200 outline-none placeholder:text-gray-500"
              />
            </label>
          )}

          <div className="max-h-64 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {filteredItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-800 px-3 py-4 text-center text-xs text-gray-500">
                {emptyLabel}
              </div>
            ) : (
              filteredItems.map((item) => {
                const isIncluded = selectedValues.includes(item);
                const isExcluded = excludedValues.includes(item);

                return (
                  <div
                    key={item}
                    className={`rounded-lg border px-3 py-2 transition-colors ${
                      isIncluded
                        ? 'border-emerald-500/30 bg-emerald-500/8'
                        : isExcluded
                          ? 'border-rose-500/30 bg-rose-500/8'
                          : 'border-gray-800/80 bg-gray-950/30'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div
                          className="text-sm leading-5 text-gray-200 whitespace-normal break-all"
                          title={item}
                        >
                          {item}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                          <span>{counts?.get(item) ?? 0} results</span>
                          {isIncluded && (
                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-emerald-300">
                              IN
                            </span>
                          )}
                          {isExcluded && (
                            <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-rose-300">
                              OUT
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onIncludeToggle(item)}
                          className={`rounded-md border p-1.5 transition-colors ${
                            isIncluded
                              ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                              : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-emerald-500/40 hover:text-emerald-200'
                          }`}
                          title={isIncluded ? `Remove ${item} from included filters` : `Include ${item}`}
                          aria-label={isIncluded ? `Remove ${item} from included filters` : `Include ${item}`}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onExcludeToggle(item)}
                          className={`rounded-md border p-1.5 transition-colors ${
                            isExcluded
                              ? 'border-rose-500/60 bg-rose-500/15 text-rose-200'
                              : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-rose-500/40 hover:text-rose-200'
                          }`}
                          title={isExcluded ? `Remove ${item} from excluded filters` : `Exclude ${item}`}
                          aria-label={isExcluded ? `Remove ${item} from excluded filters` : `Exclude ${item}`}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {filteredItems.length > 0 && filteredItems.length !== mergedItems.length && (
            <p className="pt-2 text-center text-[11px] text-gray-500">
              Showing {filteredItems.length} of {mergedItems.length}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default React.memo(FacetFilterSection);


import React, { useMemo } from 'react';
import { ChevronLeft, Plus, RefreshCw, SlidersHorizontal } from 'lucide-react';
import SearchBar from './SearchBar';
import AdvancedFilters from './AdvancedFilters';
import TagsAndFavorites from './TagsAndFavorites';
import ActiveFilters from './ActiveFilters';
import FacetFilterSection from './FacetFilterSection';
import { useImageStore } from '../store/useImageStore';
import type { ImageRating } from '../types';

interface SidebarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  availableModels: string[];
  availableLoras: string[];
  availableSamplers: string[];
  availableSchedulers: string[];
  availableDimensions: string[];
  selectedModels: string[];
  selectedLoras: string[];
  selectedSamplers: string[];
  selectedSchedulers: string[];
  onModelChange: (models: string[]) => void;
  onLoraChange: (loras: string[]) => void;
  onSamplerChange: (samplers: string[]) => void;
  onSchedulerChange: (schedulers: string[]) => void;
  onClearAllFilters: () => void;
  advancedFilters: any;
  onAdvancedFiltersChange: (filters: any) => void;
  onClearAdvancedFilters: () => void;
  selectedRatings: ImageRating[];
  onSelectedRatingsChange: (ratings: ImageRating[]) => void;
  children?: React.ReactNode;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  isResizing: boolean;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onAddFolder?: () => void;
  isIndexing: boolean;
  scanSubfolders: boolean;
  excludedFolders: Set<string>;
  onExcludeFolder: (path: string) => void;
  onIncludeFolder?: (path: string) => void;
  sortOrder: string;
  onSortOrderChange: (value: string) => void;
  onReshuffle?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  searchQuery,
  onSearchChange,
  availableModels,
  availableLoras,
  availableSamplers,
  availableSchedulers,
  availableDimensions,
  selectedModels,
  selectedLoras,
  selectedSamplers,
  selectedSchedulers,
  onClearAllFilters,
  advancedFilters,
  onAdvancedFiltersChange,
  onClearAdvancedFilters,
  selectedRatings,
  onSelectedRatingsChange,
  children,
  isCollapsed,
  onToggleCollapse,
  width,
  isResizing,
  onResizeStart,
  onAddFolder,
  isIndexing = false,
  scanSubfolders,
  excludedFolders,
  onExcludeFolder,
  onIncludeFolder,
  sortOrder,
  onSortOrderChange,
  onReshuffle
}) => {
  const selectedTags = useImageStore((state) => state.selectedTags);
  const excludedTags = useImageStore((state) => state.excludedTags);
  const selectedAutoTags = useImageStore((state) => state.selectedAutoTags);
  const excludedAutoTags = useImageStore((state) => state.excludedAutoTags);
  const favoriteFilterMode = useImageStore((state) => state.favoriteFilterMode);
  const allImages = useImageStore((state) => state.images);
  const filteredImages = useImageStore((state) => state.filteredImages);
  const excludedModels = useImageStore((state) => state.excludedModels);
  const excludedLoras = useImageStore((state) => state.excludedLoras);
  const excludedSamplers = useImageStore((state) => state.excludedSamplers);
  const excludedSchedulers = useImageStore((state) => state.excludedSchedulers);
  const setSelectedFilters = useImageStore((state) => state.setSelectedFilters);
  const countFacetValues = useMemo(() => {
    if (isIndexing) {
      return {
        modelCounts: new Map<string, number>(),
        loraCounts: new Map<string, number>(),
        samplerCounts: new Map<string, number>(),
        schedulerCounts: new Map<string, number>(),
      };
    }

    const modelCounts = new Map<string, number>();
    const loraCounts = new Map<string, number>();
    const samplerCounts = new Map<string, number>();
    const schedulerCounts = new Map<string, number>();

    for (const image of filteredImages) {
      image.models?.forEach((value) => {
        if (value) modelCounts.set(value, (modelCounts.get(value) ?? 0) + 1);
      });

      image.loras?.forEach((value) => {
        const label = typeof value === 'string' ? value : value?.name;
        if (label) loraCounts.set(label, (loraCounts.get(label) ?? 0) + 1);
      });

      if (image.sampler) {
        samplerCounts.set(image.sampler, (samplerCounts.get(image.sampler) ?? 0) + 1);
      }

      if (image.scheduler) {
        schedulerCounts.set(image.scheduler, (schedulerCounts.get(image.scheduler) ?? 0) + 1);
      }
    }

    return { modelCounts, loraCounts, samplerCounts, schedulerCounts };
  }, [filteredImages, isIndexing]);

  const facetUniverse = useMemo(() => {
    const models = new Set<string>();
    const loras = new Set<string>();
    const samplers = new Set<string>();
    const schedulers = new Set<string>();

    for (const image of allImages) {
      image.models?.forEach((value) => {
        if (value) models.add(value);
      });

      image.loras?.forEach((value) => {
        const label = typeof value === 'string' ? value : value?.name;
        if (label) loras.add(label);
      });

      if (image.sampler) {
        samplers.add(image.sampler);
      }

      if (image.scheduler) {
        schedulers.add(image.scheduler);
      }
    }

    return {
      models: Array.from(models).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
      loras: Array.from(loras).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
      samplers: Array.from(samplers).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
      schedulers: Array.from(schedulers).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    };
  }, [allImages]);

  const toggleExplicitFacet = (
    value: string,
    selectedValues: string[],
    excludedValues: string[],
    mode: 'include' | 'exclude',
    keys: {
      selected: 'models' | 'loras' | 'samplers' | 'schedulers';
      excluded: 'excludedModels' | 'excludedLoras' | 'excludedSamplers' | 'excludedSchedulers';
    }
  ) => {
    const nextSelected = mode === 'include'
      ? (selectedValues.includes(value) ? selectedValues.filter((item) => item !== value) : [...selectedValues, value])
      : selectedValues.filter((item) => item !== value);

    const nextExcluded = mode === 'exclude'
      ? (excludedValues.includes(value) ? excludedValues.filter((item) => item !== value) : [...excludedValues, value])
      : excludedValues.filter((item) => item !== value);

    setSelectedFilters({
      [keys.selected]: nextSelected,
      [keys.excluded]: nextExcluded,
    });
  };

  const generationFacets = [
    {
      title: 'Checkpoints',
      items: facetUniverse.models,
      selectedValues: selectedModels,
      excludedValues: excludedModels,
      counts: countFacetValues.modelCounts,
      onIncludeToggle: (value: string) => toggleExplicitFacet(value, selectedModels, excludedModels, 'include', { selected: 'models', excluded: 'excludedModels' }),
      onExcludeToggle: (value: string) => toggleExplicitFacet(value, selectedModels, excludedModels, 'exclude', { selected: 'models', excluded: 'excludedModels' }),
      onClear: () => setSelectedFilters({ models: [], excludedModels: [] }),
    },
    {
      title: 'LoRAs',
      items: facetUniverse.loras,
      selectedValues: selectedLoras,
      excludedValues: excludedLoras,
      counts: countFacetValues.loraCounts,
      onIncludeToggle: (value: string) => toggleExplicitFacet(value, selectedLoras, excludedLoras, 'include', { selected: 'loras', excluded: 'excludedLoras' }),
      onExcludeToggle: (value: string) => toggleExplicitFacet(value, selectedLoras, excludedLoras, 'exclude', { selected: 'loras', excluded: 'excludedLoras' }),
      onClear: () => setSelectedFilters({ loras: [], excludedLoras: [] }),
    },
    {
      title: 'Samplers',
      items: facetUniverse.samplers,
      selectedValues: selectedSamplers,
      excludedValues: excludedSamplers,
      counts: countFacetValues.samplerCounts,
      onIncludeToggle: (value: string) => toggleExplicitFacet(value, selectedSamplers, excludedSamplers, 'include', { selected: 'samplers', excluded: 'excludedSamplers' }),
      onExcludeToggle: (value: string) => toggleExplicitFacet(value, selectedSamplers, excludedSamplers, 'exclude', { selected: 'samplers', excluded: 'excludedSamplers' }),
      onClear: () => setSelectedFilters({ samplers: [], excludedSamplers: [] }),
    },
    {
      title: 'Schedulers',
      items: facetUniverse.schedulers,
      selectedValues: selectedSchedulers,
      excludedValues: excludedSchedulers,
      counts: countFacetValues.schedulerCounts,
      onIncludeToggle: (value: string) => toggleExplicitFacet(value, selectedSchedulers, excludedSchedulers, 'include', { selected: 'schedulers', excluded: 'excludedSchedulers' }),
      onExcludeToggle: (value: string) => toggleExplicitFacet(value, selectedSchedulers, excludedSchedulers, 'exclude', { selected: 'schedulers', excluded: 'excludedSchedulers' }),
      onClear: () => setSelectedFilters({ schedulers: [], excludedSchedulers: [] }),
    },
  ].filter((facet) =>
    facet.items.length > 0 || facet.selectedValues.length > 0 || facet.excludedValues.length > 0
  );

  const hasAnyActiveFilters =
    Boolean(searchQuery) ||
    selectedModels.length > 0 ||
    excludedModels.length > 0 ||
    selectedLoras.length > 0 ||
    excludedLoras.length > 0 ||
    selectedSamplers.length > 0 ||
    excludedSamplers.length > 0 ||
    selectedSchedulers.length > 0 ||
    excludedSchedulers.length > 0 ||
    selectedTags.length > 0 ||
    excludedTags.length > 0 ||
    selectedAutoTags.length > 0 ||
    excludedAutoTags.length > 0 ||
    favoriteFilterMode !== 'neutral' ||
    selectedRatings.length > 0 ||
    Object.keys(advancedFilters || {}).length > 0;

  if (isCollapsed) {
    return (
      <div
        data-area="sidebar"
        tabIndex={-1}
        className="fixed left-0 top-0 h-full w-16 bg-gray-900/90 backdrop-blur-md border-r border-gray-800/60 z-40 flex flex-col items-center py-6 transition-all duration-300 ease-in-out shadow-lg shadow-black/20">
        <button
          onClick={onToggleCollapse}
          className="mt-4 mb-6 relative group"
          title="Expand sidebar"
        >
           <div className="absolute inset-0 bg-blue-500/20 blur-md rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
           <img src="logo1.png" alt="Expand" className="h-10 w-10 rounded-xl shadow-lg relative z-10 transition-transform duration-200 group-hover:scale-105" />
        </button>
        <div className="flex flex-col space-y-3">
          {(selectedModels.length > 0 ||
            excludedModels.length > 0 ||
            selectedLoras.length > 0 ||
            excludedLoras.length > 0 ||
            selectedSamplers.length > 0 ||
            excludedSamplers.length > 0 ||
            selectedSchedulers.length > 0 ||
            excludedSchedulers.length > 0 ||
            selectedTags.length > 0 ||
            excludedTags.length > 0 ||
            selectedAutoTags.length > 0 ||
            excludedAutoTags.length > 0 ||
            searchQuery ||
            favoriteFilterMode !== 'neutral' ||
            selectedRatings.length > 0 ||
            Object.keys(advancedFilters || {}).length > 0) && (
            <div className="w-2 h-2 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.6)] animate-pulse" title="Active filters"></div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-area="sidebar"
      tabIndex={-1}
      style={{ width }}
      className={`fixed left-0 top-0 h-full bg-gray-950/92 backdrop-blur-md border-r border-slate-800/80 z-40 flex flex-col shadow-2xl shadow-black/40 ${isResizing ? 'transition-none' : 'transition-[width] duration-300 ease-in-out'}`}>
      <div
        role="separator"
        aria-label="Resize filters sidebar"
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
        className="absolute right-0 top-0 z-50 flex h-full w-3 translate-x-1/2 cursor-col-resize items-center justify-center"
        title="Drag to resize filters sidebar"
      >
        <div className={`h-16 w-1 rounded-full transition-colors duration-150 ${isResizing ? 'bg-blue-400/90 shadow-[0_0_16px_rgba(96,165,250,0.55)]' : 'bg-gray-600/70 hover:bg-blue-400/80'}`} />
      </div>
      {/* Header with collapse button */}
      <div className="flex flex-col border-b border-slate-800/70 bg-gradient-to-b from-slate-950 via-slate-900/95 to-slate-900/75">
        <div className="flex items-center gap-3 p-4 pb-2">
            <div className="relative flex-shrink-0">
                <div className="absolute inset-0 rounded-full bg-cyan-500/20 blur-xl opacity-60" />
                <img src="logo1.png" alt="Image MetaHub" className="h-10 w-10 rounded-xl shadow-2xl relative z-10" />
            </div>
            <div className="flex flex-col overflow-hidden">
                <h1 className="text-lg font-bold tracking-tight text-white/90 truncate">Image MetaHub</h1>
                <span className="text-[10px] font-mono font-normal text-slate-500">v0.14.0</span>
            </div>
        </div>

        <div className="flex items-center justify-between px-4 pb-3 pt-1">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-[0.18em]">Library Controls</h2>
          <button
            onClick={onToggleCollapse}
            className="rounded-lg border border-slate-700/70 bg-slate-900/70 p-1.5 text-slate-400 transition-all duration-200 hover:border-cyan-500/30 hover:bg-slate-800/80 hover:text-white"
            title="Collapse sidebar"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="border-b border-slate-800/80 px-4 py-4">
        <div className="rounded-2xl border border-cyan-500/10 bg-slate-950/70 p-3 shadow-[0_8px_30px_rgba(0,0,0,0.18)]">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300/70">Search</div>
          <SearchBar
            value={searchQuery}
            onChange={onSearchChange}
          />
        </div>
      </div>

      {/* Scrollable Content - includes DirectoryList AND Filters */}
      <div className="flex-1 overflow-y-auto scrollbar-sidebar">
        <div className="border-b border-slate-800/80 bg-slate-950/35 px-4 py-3">
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/45 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Active Filters</div>
            <ActiveFilters />
          </div>
        </div>

        <div className="border-b border-slate-800/80 px-4 py-3">
          <div className="rounded-2xl border border-violet-500/10 bg-slate-950/60 p-3">
            <label htmlFor="sidebar-sort" className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300/70">Sort & View</label>
            <div className="flex items-center">
            <select
              id="sidebar-sort"
              value={sortOrder}
              onChange={(e) => onSortOrderChange(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 text-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="date-desc">Newest First</option>
              <option value="date-asc">Oldest First</option>
              <option value="asc">A-Z</option>
              <option value="desc">Z-A</option>
              <option value="random">Random</option>
            </select>
            {sortOrder === 'random' && onReshuffle && (
              <button
                  onClick={onReshuffle}
                  className="ml-2 rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-400 transition-colors hover:border-cyan-500/30 hover:text-white"
                  title="Reshuffle Random Order"
              >
                  <RefreshCw className="h-5 w-5" />
              </button>
            )}
            </div>
          </div>
        </div>

        {/* Add Folder Button - Subtle and discrete */}
        {onAddFolder && (
          <div className="border-b border-slate-800/80 px-4 py-3">
            <button
              onClick={onAddFolder}
              disabled={isIndexing}
              className={`w-full flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all duration-200 ${
                isIndexing
                  ? 'border-slate-800 bg-slate-900/60 text-slate-600 cursor-not-allowed' 
                  : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100 hover:border-emerald-400/35 hover:bg-emerald-500/15 hover:text-white'
              }`}
              title={isIndexing ? "Cannot add folder during indexing" : "Add a new folder"}
            >
              <Plus size={14} />
              <span>Add Folder</span>
            </button>
          </div>
        )}

        {/* Render children, which will be the DirectoryList */}
        {children && React.isValidElement(children) ? (
          React.cloneElement(children as React.ReactElement<any>, {
            isIndexing,
            scanSubfolders,
            excludedFolders,
            onExcludeFolder,
            onIncludeFolder
          })
        ) : (
          children
        )}

        {/* Tags and Favorites Section */}
        <TagsAndFavorites />

        {generationFacets.length > 0 && (
          <section className="border-y border-slate-800/80 bg-slate-950/25 px-4 py-4">
            <div className="mb-4 flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-cyan-300/70" />
              <div>
                <h3 className="text-sm font-semibold text-gray-100">Generation Facets</h3>
                <p className="text-xs text-slate-500">Build include/exclude combinations without losing the full option list.</p>
              </div>
            </div>
            <div className="space-y-3">
              {generationFacets.map((facet) => (
                <FacetFilterSection
                  key={facet.title}
                  title={facet.title}
                  items={facet.items}
                  counts={facet.counts}
                  selectedValues={facet.selectedValues}
                  excludedValues={facet.excludedValues}
                  onIncludeToggle={facet.onIncludeToggle}
                  onExcludeToggle={facet.onExcludeToggle}
                  onClear={facet.onClear}
                />
              ))}
            </div>
          </section>
        )}

        <AdvancedFilters
          advancedFilters={advancedFilters}
          onAdvancedFiltersChange={onAdvancedFiltersChange}
          onClearAdvancedFilters={onClearAdvancedFilters}
          availableDimensions={availableDimensions}
          selectedRatings={selectedRatings}
          onSelectedRatingsChange={onSelectedRatingsChange}
        />
      </div>

      {/* Clear All Filters */}
      {hasAnyActiveFilters && (
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={onClearAllFilters}
            className="w-full text-red-400 hover:text-white hover:bg-red-900/30 border border-red-900/30 hover:border-red-500/50 px-4 py-2 rounded-lg text-sm transition-all duration-200"
          >
            Clear All Filters
          </button>
        </div>
      )}
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export default React.memo(Sidebar);

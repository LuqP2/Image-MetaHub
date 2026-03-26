import React from 'react';
import { Calendar, CheckCircle, Settings, X } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';

const ActiveFilters: React.FC = () => {
  const selectedModels = useImageStore((state) => state.selectedModels);
  const excludedModels = useImageStore((state) => state.excludedModels);
  const selectedLoras = useImageStore((state) => state.selectedLoras);
  const excludedLoras = useImageStore((state) => state.excludedLoras);
  const selectedSamplers = useImageStore((state) => state.selectedSamplers);
  const excludedSamplers = useImageStore((state) => state.excludedSamplers);
  const selectedSchedulers = useImageStore((state) => state.selectedSchedulers);
  const excludedSchedulers = useImageStore((state) => state.excludedSchedulers);
  const selectedTags = useImageStore((state) => state.selectedTags);
  const excludedTags = useImageStore((state) => state.excludedTags);
  const selectedAutoTags = useImageStore((state) => state.selectedAutoTags);
  const excludedAutoTags = useImageStore((state) => state.excludedAutoTags);
  const searchQuery = useImageStore((state) => state.searchQuery);
  const favoriteFilterMode = useImageStore((state) => state.favoriteFilterMode);
  const advancedFilters = useImageStore((state) => state.advancedFilters);

  const setSelectedFilters = useImageStore((state) => state.setSelectedFilters);
  const setSelectedTags = useImageStore((state) => state.setSelectedTags);
  const setExcludedTags = useImageStore((state) => state.setExcludedTags);
  const setSelectedAutoTags = useImageStore((state) => state.setSelectedAutoTags);
  const setExcludedAutoTags = useImageStore((state) => state.setExcludedAutoTags);
  const setSearchQuery = useImageStore((state) => state.setSearchQuery);
  const setFavoriteFilterMode = useImageStore((state) => state.setFavoriteFilterMode);
  const setAdvancedFilters = useImageStore((state) => state.setAdvancedFilters);

  const hasActiveFilters =
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
    !!searchQuery ||
    favoriteFilterMode !== 'neutral' ||
    (advancedFilters && Object.keys(advancedFilters).length > 0);

  if (!hasActiveFilters) {
    return null;
  }

  const chipClass =
    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium';

  const removeAdvancedFilter = (key: string) => {
    const nextFilters = { ...advancedFilters };
    delete nextFilters[key];
    setAdvancedFilters(nextFilters);
  };

  return (
    <div className="px-4 pb-3 pt-2">
      <div className="mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
          Active Filters
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {searchQuery && (
          <div className={`${chipClass} border-gray-700 bg-gray-800/70 text-gray-200`}>
            <span className="opacity-70">Search</span>
            <span className="max-w-[180px] truncate">"{searchQuery}"</span>
            <button onClick={() => setSearchQuery('')} className="rounded p-0.5 hover:bg-gray-700 hover:text-white">
              <X size={12} />
            </button>
          </div>
        )}

        {favoriteFilterMode === 'include' && (
          <div className={`${chipClass} border-yellow-700/50 bg-yellow-950/50 text-yellow-200`}>
            <span>Favorites only</span>
            <button onClick={() => setFavoriteFilterMode('neutral')} className="rounded p-0.5 hover:bg-yellow-900/70">
              <X size={12} />
            </button>
          </div>
        )}

        {favoriteFilterMode === 'exclude' && (
          <div className={`${chipClass} border-rose-700/50 bg-rose-950/50 text-rose-200`}>
            <span>Exclude favorites</span>
            <button onClick={() => setFavoriteFilterMode('neutral')} className="rounded p-0.5 hover:bg-rose-900/70">
              <X size={12} />
            </button>
          </div>
        )}

        {advancedFilters?.hasVerifiedTelemetry && (
          <div className={`${chipClass} border-emerald-700/50 bg-emerald-950/50 text-emerald-200`}>
            <CheckCircle size={12} />
            <span>Verified telemetry</span>
            <button onClick={() => removeAdvancedFilter('hasVerifiedTelemetry')} className="rounded p-0.5 hover:bg-emerald-900/70">
              <X size={12} />
            </button>
          </div>
        )}

        {advancedFilters?.dimension && (
          <div className={`${chipClass} border-indigo-700/50 bg-indigo-950/50 text-indigo-200`}>
            <Settings size={12} />
            <span>{advancedFilters.dimension}</span>
            <button onClick={() => removeAdvancedFilter('dimension')} className="rounded p-0.5 hover:bg-indigo-900/70">
              <X size={12} />
            </button>
          </div>
        )}

        {advancedFilters?.steps && (
          <div className={`${chipClass} border-indigo-700/50 bg-indigo-950/50 text-indigo-200`}>
            <Settings size={12} />
            <span>Steps {advancedFilters.steps.min}-{advancedFilters.steps.max}</span>
            <button onClick={() => removeAdvancedFilter('steps')} className="rounded p-0.5 hover:bg-indigo-900/70">
              <X size={12} />
            </button>
          </div>
        )}

        {advancedFilters?.cfg && (
          <div className={`${chipClass} border-indigo-700/50 bg-indigo-950/50 text-indigo-200`}>
            <Settings size={12} />
            <span>CFG {advancedFilters.cfg.min}-{advancedFilters.cfg.max}</span>
            <button onClick={() => removeAdvancedFilter('cfg')} className="rounded p-0.5 hover:bg-indigo-900/70">
              <X size={12} />
            </button>
          </div>
        )}

        {advancedFilters?.date && (
          <div className={`${chipClass} border-indigo-700/50 bg-indigo-950/50 text-indigo-200`}>
            <Calendar size={12} />
            <span>{advancedFilters.date.from || '...'} - {advancedFilters.date.to || '...'}</span>
            <button onClick={() => removeAdvancedFilter('date')} className="rounded p-0.5 hover:bg-indigo-900/70">
              <X size={12} />
            </button>
          </div>
        )}

        {selectedModels.map((value) => (
          <FacetChip key={`checkpoint-${value}`} label="Checkpoint" value={value} tone="blue" onRemove={() => setSelectedFilters({ models: selectedModels.filter((item) => item !== value) })} />
        ))}
        {excludedModels.map((value) => (
          <FacetChip key={`checkpoint-ex-${value}`} label="Exclude checkpoint" value={value} tone="rose" onRemove={() => setSelectedFilters({ excludedModels: excludedModels.filter((item) => item !== value) })} />
        ))}

        {selectedLoras.map((value) => (
          <FacetChip key={`lora-${value}`} label="LoRA" value={value} tone="violet" onRemove={() => setSelectedFilters({ loras: selectedLoras.filter((item) => item !== value) })} />
        ))}
        {excludedLoras.map((value) => (
          <FacetChip key={`lora-ex-${value}`} label="Exclude LoRA" value={value} tone="rose" onRemove={() => setSelectedFilters({ excludedLoras: excludedLoras.filter((item) => item !== value) })} />
        ))}

        {selectedSamplers.map((value) => (
          <FacetChip key={`sampler-${value}`} label="Sampler" value={value} tone="amber" onRemove={() => setSelectedFilters({ samplers: selectedSamplers.filter((item) => item !== value) })} />
        ))}
        {excludedSamplers.map((value) => (
          <FacetChip key={`sampler-ex-${value}`} label="Exclude sampler" value={value} tone="rose" onRemove={() => setSelectedFilters({ excludedSamplers: excludedSamplers.filter((item) => item !== value) })} />
        ))}

        {selectedSchedulers.map((value) => (
          <FacetChip key={`scheduler-${value}`} label="Scheduler" value={value} tone="teal" onRemove={() => setSelectedFilters({ schedulers: selectedSchedulers.filter((item) => item !== value) })} />
        ))}
        {excludedSchedulers.map((value) => (
          <FacetChip key={`scheduler-ex-${value}`} label="Exclude scheduler" value={value} tone="rose" onRemove={() => setSelectedFilters({ excludedSchedulers: excludedSchedulers.filter((item) => item !== value) })} />
        ))}

        {selectedTags.map((value) => (
          <FacetChip key={`tag-${value}`} label="Tag" value={value} tone="gray" onRemove={() => setSelectedTags(selectedTags.filter((item) => item !== value))} />
        ))}
        {excludedTags.map((value) => (
          <FacetChip key={`tag-ex-${value}`} label="Exclude tag" value={value} tone="rose" onRemove={() => setExcludedTags(excludedTags.filter((item) => item !== value))} />
        ))}

        {selectedAutoTags.map((value) => (
          <FacetChip key={`auto-${value}`} label="Auto tag" value={value} tone="sky" onRemove={() => setSelectedAutoTags(selectedAutoTags.filter((item) => item !== value))} />
        ))}
        {excludedAutoTags.map((value) => (
          <FacetChip key={`auto-ex-${value}`} label="Exclude auto tag" value={value} tone="rose" onRemove={() => setExcludedAutoTags(excludedAutoTags.filter((item) => item !== value))} />
        ))}
      </div>
    </div>
  );
};

interface FacetChipProps {
  label: string;
  value: string;
  tone: 'blue' | 'violet' | 'amber' | 'teal' | 'gray' | 'sky' | 'rose';
  onRemove: () => void;
}

const toneClasses: Record<FacetChipProps['tone'], string> = {
  blue: 'border-blue-700/50 bg-blue-950/50 text-blue-200',
  violet: 'border-violet-700/50 bg-violet-950/50 text-violet-200',
  amber: 'border-amber-700/50 bg-amber-950/50 text-amber-200',
  teal: 'border-teal-700/50 bg-teal-950/50 text-teal-200',
  gray: 'border-gray-700/50 bg-gray-800/70 text-gray-200',
  sky: 'border-sky-700/50 bg-sky-950/50 text-sky-200',
  rose: 'border-rose-700/50 bg-rose-950/50 text-rose-200',
};

const FacetChip: React.FC<FacetChipProps> = ({ label, value, tone, onRemove }) => (
  <div className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium ${toneClasses[tone]}`}>
    <span className="opacity-70">{label}</span>
    <span className="max-w-[180px] truncate">{value}</span>
    <button onClick={onRemove} className="rounded p-0.5 hover:bg-black/10">
      <X size={12} />
    </button>
  </div>
);

export default ActiveFilters;

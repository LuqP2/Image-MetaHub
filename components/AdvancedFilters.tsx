import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle, ChevronDown, Settings, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

interface AdvancedFiltersProps {
  advancedFilters: any;
  onAdvancedFiltersChange: (filters: any) => void;
  onClearAdvancedFilters: () => void;
  availableDimensions: string[];
}

const AdvancedFilters: React.FC<AdvancedFiltersProps> = ({
  advancedFilters,
  onAdvancedFiltersChange,
  onClearAdvancedFilters,
  availableDimensions
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [localFilters, setLocalFilters] = useState(advancedFilters || {});

  useEffect(() => {
    setLocalFilters(advancedFilters || {});
  }, [advancedFilters]);

  const normalizeFilters = (filters: Record<string, any>) => {
    const nextFilters = { ...filters };

    Object.keys(nextFilters).forEach((key) => {
      const value = nextFilters[key];
      if (value === null || value === undefined || value === '') {
        delete nextFilters[key];
        return;
      }

      if (key === 'date' && typeof value === 'object') {
        if ((!value.from || value.from === '') && (!value.to || value.to === '')) {
          delete nextFilters[key];
        }
        return;
      }

      if ((key === 'steps' || key === 'cfg') && typeof value === 'object') {
        const minMissing = value.min === null || value.min === undefined || value.min === '';
        const maxMissing = value.max === null || value.max === undefined || value.max === '';
        if (minMissing && maxMissing) {
          delete nextFilters[key];
        }
      }
    });

    return nextFilters;
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const normalized = normalizeFilters(localFilters);
      if (JSON.stringify(normalized) !== JSON.stringify(advancedFilters)) {
        onAdvancedFiltersChange(normalized);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [advancedFilters, localFilters, onAdvancedFiltersChange]);

  const updateFilter = (key: string, value: any) => {
    setLocalFilters((prev: Record<string, any>) => normalizeFilters({ ...prev, [key]: value }));
  };

  const hasActiveFilters = Object.keys(advancedFilters || {}).length > 0;
  const generationSummary = useMemo(() => {
    const parts: string[] = [];
    if (localFilters.steps) {
      parts.push(`Steps ${localFilters.steps.min ?? '...'}-${localFilters.steps.max ?? '...'}`);
    }
    if (localFilters.cfg) {
      parts.push(`CFG ${localFilters.cfg.min ?? '...'}-${localFilters.cfg.max ?? '...'}`);
    }
    return parts.join(' • ') || 'Ranges for generation parameters.';
  }, [localFilters.cfg, localFilters.steps]);

  const imageSummary = localFilters.dimension
    ? `Pinned to ${localFilters.dimension}.`
    : 'Resolution and aspect focused filters.';

  const fileSummary = localFilters.date?.from || localFilters.date?.to
    ? `${localFilters.date?.from || '...'} to ${localFilters.date?.to || '...'}`
    : 'Filter by file date range.';

  const metaHubSummary = localFilters.hasVerifiedTelemetry
    ? 'Only images with verified telemetry.'
    : 'MetaHub-specific metadata filters.';

  const renderNumberRange = (
    label: string,
    key: 'steps' | 'cfg',
    options: { minPlaceholder: string; maxPlaceholder: string; step?: string; max?: string }
  ) => (
    <div className="rounded-xl border border-gray-800/80 bg-gray-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-100">{label}</h4>
          <p className="text-xs text-gray-500">
            {localFilters[key] ? `${localFilters[key].min ?? '...'} to ${localFilters[key].max ?? '...'}` : 'Any value'}
          </p>
        </div>
        {localFilters[key] && (
          <button
            type="button"
            onClick={() => updateFilter(key, null)}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-800 hover:text-rose-300 transition-colors"
            title={`Clear ${label.toLowerCase()} filter`}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          placeholder={options.minPlaceholder}
          step={options.step}
          min="0"
          max={options.max}
          value={localFilters[key]?.min ?? ''}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === '') {
              updateFilter(key, localFilters[key]?.max !== undefined ? { min: null, max: localFilters[key].max } : null);
              return;
            }
            const parsed = key === 'cfg' ? parseFloat(raw) : parseInt(raw, 10);
            if (Number.isNaN(parsed) || parsed < 0) return;
            const currentMax = localFilters[key]?.max;
            updateFilter(key, {
              min: parsed,
              max: currentMax === null || currentMax === undefined ? null : Math.max(parsed, currentMax),
            });
          }}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
        />
        <input
          type="number"
          placeholder={options.maxPlaceholder}
          step={options.step}
          min="0"
          max={options.max}
          value={localFilters[key]?.max ?? ''}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === '') {
              updateFilter(key, localFilters[key]?.min !== undefined ? { min: localFilters[key].min, max: null } : null);
              return;
            }
            const parsed = key === 'cfg' ? parseFloat(raw) : parseInt(raw, 10);
            if (Number.isNaN(parsed) || parsed < 0) return;
            const currentMin = localFilters[key]?.min;
            updateFilter(key, {
              min: currentMin === null || currentMin === undefined ? null : Math.min(currentMin, parsed),
              max: parsed,
            });
          }}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
        />
      </div>
    </div>
  );

  return (
    <div className="border-t border-gray-800/80">
      <div className="w-full flex items-center justify-between p-4">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 flex items-center justify-between hover:bg-gray-800/50 transition-colors -m-4 p-4"
        >
          <div className="flex items-center space-x-2">
            <Settings className="h-4 w-4 text-gray-400" />
            <span className="text-gray-200 font-medium">Metadata & File Filters</span>
            {hasActiveFilters && (
              <span className="rounded border border-blue-700/50 bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300">
                {Object.keys(advancedFilters).length} active
              </span>
            )}
          </div>
          <ChevronDown
            className={`w-4 h-4 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>
        {hasActiveFilters && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClearAdvancedFilters();
            }}
            className="ml-2 text-xs text-gray-400 hover:text-red-400 p-1"
            title="Clear advanced filters"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-4 px-4 pb-4">
              <div className="rounded-xl border border-gray-800/80 bg-gray-900/30 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-100">Generation</h3>
                    <p className="mt-1 text-xs text-gray-500">{generationSummary}</p>
                  </div>
                  {(localFilters.steps || localFilters.cfg) && (
                    <button
                      type="button"
                      onClick={() => setLocalFilters((prev: Record<string, any>) => normalizeFilters({ ...prev, steps: null, cfg: null }))}
                      className="rounded-lg p-1 text-gray-400 hover:bg-gray-800 hover:text-rose-300 transition-colors"
                      title="Clear generation filters"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {renderNumberRange('Steps', 'steps', { minPlaceholder: 'Min', maxPlaceholder: 'Max', max: '100' })}
                  {renderNumberRange('CFG', 'cfg', { minPlaceholder: 'Min', maxPlaceholder: 'Max', step: '0.1', max: '20' })}
                </div>
              </div>

              <div className="rounded-xl border border-gray-800/80 bg-gray-900/30 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-100">Image</h3>
                    <p className="mt-1 text-xs text-gray-500">{imageSummary}</p>
                  </div>
                  {localFilters.dimension && (
                    <button
                      type="button"
                      onClick={() => updateFilter('dimension', null)}
                      className="rounded-lg p-1 text-gray-400 hover:bg-gray-800 hover:text-rose-300 transition-colors"
                      title="Clear dimensions filter"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <select
                  value={localFilters.dimension || ''}
                  onChange={(event) => updateFilter('dimension', event.target.value || null)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                >
                  <option value="">All dimensions</option>
                  {availableDimensions.map((dimension) => (
                    <option key={dimension} value={dimension}>{dimension}</option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-gray-800/80 bg-gray-900/30 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-100">
                      <Calendar className="h-4 w-4 text-gray-400" />
                      File
                    </h3>
                    <p className="mt-1 text-xs text-gray-500">{fileSummary}</p>
                  </div>
                  {(localFilters.date?.from || localFilters.date?.to) && (
                    <button
                      type="button"
                      onClick={() => updateFilter('date', null)}
                      className="rounded-lg p-1 text-gray-400 hover:bg-gray-800 hover:text-rose-300 transition-colors"
                      title="Clear date range"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    type="date"
                    value={localFilters.date?.from || ''}
                    onChange={(event) => updateFilter('date', {
                      from: event.target.value || '',
                      to: localFilters.date?.to || '',
                    })}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                  />
                  <input
                    type="date"
                    value={localFilters.date?.to || ''}
                    onChange={(event) => updateFilter('date', {
                      from: localFilters.date?.from || '',
                      to: event.target.value || '',
                    })}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-gray-800/80 bg-gray-900/30 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-100">
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                      MetaHub
                    </h3>
                    <p className="mt-1 text-xs text-gray-500">{metaHubSummary}</p>
                  </div>
                  {localFilters.hasVerifiedTelemetry && (
                    <button
                      type="button"
                      onClick={() => updateFilter('hasVerifiedTelemetry', null)}
                      className="rounded-lg p-1 text-gray-400 hover:bg-gray-800 hover:text-rose-300 transition-colors"
                      title="Clear MetaHub filters"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <label className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-950/30 p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={localFilters.hasVerifiedTelemetry === true}
                    onChange={(event) => updateFilter('hasVerifiedTelemetry', event.target.checked ? true : null)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-700 text-green-600 focus:ring-green-500 focus:ring-offset-gray-800"
                  />
                  <div>
                    <div className="text-sm text-gray-200">Verified telemetry only</div>
                    <p className="mt-1 text-xs text-gray-500">
                      Restrict to images with VRAM, device, and runtime metadata from the MetaHub Save Node.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdvancedFilters;

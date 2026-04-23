import React, { useEffect, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AdvancedFilters } from '../types';

interface AdvancedFiltersProps {
  advancedFilters: AdvancedFilters;
  onAdvancedFiltersChange: (filters: AdvancedFilters) => void;
  onClearAdvancedFilters: () => void;
  availableDimensions: string[];
}

type MultiSelectFilterKey = 'generationModes' | 'mediaTypes';
type MultiSelectFilterValues = {
  generationModes: NonNullable<AdvancedFilters['generationModes']>;
  mediaTypes: NonNullable<AdvancedFilters['mediaTypes']>;
};

const AdvancedFilters: React.FC<AdvancedFiltersProps> = ({
  advancedFilters,
  onAdvancedFiltersChange,
  onClearAdvancedFilters,
  availableDimensions,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [localFilters, setLocalFilters] = useState<AdvancedFilters>(advancedFilters || {});

  useEffect(() => {
    setLocalFilters(advancedFilters || {});
  }, [advancedFilters]);

  const isNumericRangeKey = (
    key: keyof AdvancedFilters
  ): key is 'steps' | 'cfg' | 'generationTimeMs' | 'stepsPerSecond' | 'vramPeakMb' => (
    key === 'steps' ||
    key === 'cfg' ||
    key === 'generationTimeMs' ||
    key === 'stepsPerSecond' ||
    key === 'vramPeakMb'
  );

  const normalizeFilters = (filters: AdvancedFilters): AdvancedFilters => {
    const nextFilters = { ...filters };

    (Object.keys(nextFilters) as Array<keyof AdvancedFilters>).forEach((key) => {
      const value = nextFilters[key];
      if (value === null || value === undefined || value === '') {
        delete nextFilters[key];
        return;
      }

      if (key === 'date' && typeof value === 'object') {
        const dateValue = value as NonNullable<AdvancedFilters['date']>;
        if ((!dateValue.from || dateValue.from === '') && (!dateValue.to || dateValue.to === '')) {
          delete nextFilters[key];
        }
        return;
      }

      if (isNumericRangeKey(key) && typeof value === 'object') {
        const rangeValue = value as NonNullable<AdvancedFilters[typeof key]>;
        const minMissing = rangeValue.min === null || rangeValue.min === undefined;
        const maxMissing = rangeValue.max === null || rangeValue.max === undefined;
        if (minMissing && maxMissing) {
          delete nextFilters[key];
        }
        return;
      }

      if ((key === 'generationModes' || key === 'mediaTypes') && Array.isArray(value) && value.length === 0) {
        delete nextFilters[key];
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

  const updateFilter = <K extends keyof AdvancedFilters>(key: K, value: AdvancedFilters[K]) => {
    setLocalFilters((prev) => normalizeFilters({ ...prev, [key]: value }));
  };

  const advancedFilterCount = Object.keys(advancedFilters || {}).length;
  const hasActiveFilters = advancedFilterCount > 0;
  const generationModes = Array.isArray(localFilters.generationModes) ? localFilters.generationModes : [];
  const mediaTypes = Array.isArray(localFilters.mediaTypes) ? localFilters.mediaTypes : [];

  const toggleMultiSelectFilter = <K extends MultiSelectFilterKey>(key: K, value: MultiSelectFilterValues[K][number]) => {
    const currentValues = (Array.isArray(localFilters[key]) ? localFilters[key] : []) as string[];
    const nextValues = currentValues.includes(value)
      ? currentValues.filter((item) => item !== value)
      : [...currentValues, value];

    updateFilter(key, nextValues as AdvancedFilters[K]);
  };

  const renderNumberRange = (
    label: string,
    key: 'steps' | 'cfg' | 'generationTimeMs' | 'stepsPerSecond' | 'vramPeakMb',
    options: { step?: string; max?: string; compactHeader?: boolean }
  ) => (
    <div className="rounded-xl border border-gray-800/80 bg-gray-900/40 p-4">
      <div className={`mb-3 flex items-start justify-between gap-2 ${options.compactHeader ? 'min-h-0' : 'min-h-[4.5rem]'}`}>
        <h4 className="text-sm font-semibold leading-5 text-gray-100">{label}</h4>
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
            <span className="text-gray-200 font-medium">Metadata & File Filters</span>
            {hasActiveFilters && (
              <span className="rounded border border-blue-700/50 bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300">
                {advancedFilterCount} active
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
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-300">Generation</h3>
                  {(localFilters.steps || localFilters.cfg) && (
                    <button
                      type="button"
                      onClick={() => setLocalFilters((prev) => normalizeFilters({ ...prev, steps: undefined, cfg: undefined }))}
                      className="rounded-lg p-1 text-gray-400 hover:bg-gray-800 hover:text-rose-300 transition-colors"
                      title="Clear generation filters"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {renderNumberRange('Steps', 'steps', { max: '100', compactHeader: true })}
                  {renderNumberRange('CFG', 'cfg', { step: '0.1', max: '20', compactHeader: true })}
                </div>
              </div>

              <div className="rounded-xl border border-gray-800/80 bg-gray-900/30 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-300">Dimensions</h3>
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
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-300">Date</h3>
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
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-300">Type</h3>
                  {(generationModes.length > 0 || mediaTypes.length > 0) && (
                    <button
                      type="button"
                      onClick={() => setLocalFilters((prev) => normalizeFilters({
                        ...prev,
                        generationModes: [],
                        mediaTypes: [],
                      }))}
                      className="rounded-lg p-1 text-gray-400 hover:bg-gray-800 hover:text-rose-300 transition-colors"
                      title="Clear metadata and file type filters"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-gray-800/80 bg-gray-900/40 p-4">
                    <h4 className="min-h-[2.5rem] text-sm font-semibold leading-5 text-gray-100">Generation Mode</h4>
                    <div className="mt-3 space-y-2">
                      {([
                        ['txt2img', 'txt2img'],
                        ['img2img', 'img2img'],
                      ] as const).map(([value, label]) => (
                        <label key={value} className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-950/30 p-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={generationModes.includes(value)}
                            onChange={() => toggleMultiSelectFilter('generationModes', value)}
                            className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800"
                          />
                          <div className="text-sm text-gray-200">{label}</div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-800/80 bg-gray-900/40 p-4">
                    <h4 className="min-h-[2.5rem] text-sm font-semibold leading-5 text-gray-100">Media Type</h4>
                    <div className="mt-3 space-y-2">
                      {([
                        ['image', 'Images'],
                        ['video', 'Videos'],
                        ['audio', 'Audio'],
                      ] as const).map(([value, label]) => (
                        <label key={value} className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-950/30 p-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={mediaTypes.includes(value)}
                            onChange={() => toggleMultiSelectFilter('mediaTypes', value)}
                            className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800"
                          />
                          <div className="text-sm text-gray-200">{label}</div>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-800/80 bg-gray-900/30 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-300">MetaHub</h3>
                  {(localFilters.hasVerifiedTelemetry || localFilters.telemetryState || localFilters.generationTimeMs || localFilters.stepsPerSecond || localFilters.vramPeakMb) && (
                    <button
                      type="button"
                      onClick={() => setLocalFilters((prev) => normalizeFilters({
                        ...prev,
                        telemetryState: undefined,
                        hasVerifiedTelemetry: undefined,
                        generationTimeMs: undefined,
                        stepsPerSecond: undefined,
                        vramPeakMb: undefined,
                      }))}
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
                    onChange={(event) => setLocalFilters((prev) => normalizeFilters({
                      ...prev,
                      telemetryState: undefined,
                      hasVerifiedTelemetry: event.target.checked ? true : undefined,
                    }))}
                    className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-700 text-green-600 focus:ring-green-500 focus:ring-offset-gray-800"
                  />
                  <div>
                    <div className="text-sm text-gray-200">MetaHub Save Node only</div>
                  </div>
                </label>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {renderNumberRange('Generation Time (ms)', 'generationTimeMs', { step: '50' })}
                  {renderNumberRange('Speed (it/s)', 'stepsPerSecond', { step: '0.1' })}
                  {renderNumberRange('VRAM Peak (MB)', 'vramPeakMb', { step: '1' })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdvancedFilters;

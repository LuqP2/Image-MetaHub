import { useTranslation } from '../i18n/useTranslation';
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
  const { t } = useTranslation();
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
    options: { step?: string; max?: string }
  ) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-300">{label}</span>
        {localFilters[key] && (
          <button
            type="button"
            onClick={() => updateFilter(key, null)}
            className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-rose-300"
            title={t('librarySearch.clearNamedFilter', { label: label.toLowerCase() })}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
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
          className="ui-input tabular-nums"
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
          className="ui-input tabular-nums"
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
            <span className="text-gray-200 font-medium">{t('librarySearch.metadataFileFilters')}</span>
            {hasActiveFilters && (
              <span className="rounded border border-blue-700/50 bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300">
                {t('librarySearch.activeCount', { count: advancedFilterCount })}
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
            title={t('librarySearch.clearAdvancedFilters')}
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
            <div className="space-y-4 px-3 pb-4 pt-1">
              {/* Generation */}
              <div className="space-y-2.5 border-t border-gray-700/40 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{t('librarySearch.generation')}</h3>
                  {(localFilters.steps || localFilters.cfg) && (
                    <button
                      type="button"
                      onClick={() => setLocalFilters((prev) => normalizeFilters({ ...prev, steps: undefined, cfg: undefined }))}
                      className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-rose-300"
                      title={t('librarySearch.clearGenerationFilters')}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <div className="space-y-2.5">
                  {renderNumberRange(t('librarySearch.steps'), 'steps', { max: '100' })}
                  {renderNumberRange('CFG', 'cfg', { step: '0.1', max: '20' })}
                </div>
              </div>

              {/* Dimensions */}
              <div className="space-y-2 border-t border-gray-700/40 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{t('librarySearch.dimensions')}</h3>
                  {localFilters.dimension && (
                    <button
                      type="button"
                      onClick={() => updateFilter('dimension', null)}
                      className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-rose-300"
                      title={t('librarySearch.clearDimensionsFilter')}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <select
                  value={localFilters.dimension || ''}
                  onChange={(event) => updateFilter('dimension', event.target.value || null)}
                  className="ui-select w-full"
                >
                  <option value="">{t('librarySearch.allDimensions')}</option>
                  {availableDimensions.map((dimension) => (
                    <option key={dimension} value={dimension}>{dimension}</option>
                  ))}
                </select>
              </div>

              {/* Date */}
              <div className="space-y-2 border-t border-gray-700/40 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{t('librarySearch.date')}</h3>
                  {(localFilters.date?.from || localFilters.date?.to) && (
                    <button
                      type="button"
                      onClick={() => updateFilter('date', null)}
                      className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-rose-300"
                      title={t('librarySearch.clearDateRange')}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="date"
                    value={localFilters.date?.from || ''}
                    onChange={(event) => updateFilter('date', {
                      from: event.target.value || '',
                      to: localFilters.date?.to || '',
                    })}
                    className="ui-input"
                  />
                  <input
                    type="date"
                    value={localFilters.date?.to || ''}
                    onChange={(event) => updateFilter('date', {
                      from: localFilters.date?.from || '',
                      to: event.target.value || '',
                    })}
                    className="ui-input"
                  />
                </div>
              </div>

              {/* Type: Generation Mode + Media Type as clean toggle pills */}
              <div className="space-y-2.5 border-t border-gray-700/40 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{t('librarySearch.type')}</h3>
                  {(generationModes.length > 0 || mediaTypes.length > 0) && (
                    <button
                      type="button"
                      onClick={() => setLocalFilters((prev) => normalizeFilters({
                        ...prev,
                        generationModes: [],
                        mediaTypes: [],
                      }))}
                      className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-rose-300"
                      title={t('librarySearch.clearMetadataAndFileTypeFilters')}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-gray-400">{t('librarySearch.generationMode')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      ['txt2img', 'txt2img'],
                      ['img2img', 'img2img'],
                    ] as const).map(([value, label]) => {
                      const active = generationModes.includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleMultiSelectFilter('generationModes', value)}
                          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                            active
                              ? 'border-accent/50 bg-accent/15 text-accent'
                              : 'border-gray-700/60 bg-gray-800/50 text-gray-300 hover:border-gray-600 hover:text-gray-100'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-gray-400">{t('librarySearch.mediaType')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      ['image', t('librarySearch.images')],
                      ['video', t('librarySearch.videos')],
                      ['audio', t('librarySearch.audio')],
                      ['model3d', t('librarySearch.3dModels')],
                    ] as const).map(([value, label]) => {
                      const active = mediaTypes.includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleMultiSelectFilter('mediaTypes', value)}
                          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                            active
                              ? 'border-accent/50 bg-accent/15 text-accent'
                              : 'border-gray-700/60 bg-gray-800/50 text-gray-300 hover:border-gray-600 hover:text-gray-100'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* MetaHub */}
              <div className="space-y-2.5 border-t border-gray-700/40 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">MetaHub</h3>
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
                      className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-rose-300"
                      title={t('librarySearch.clearMetahubFilters')}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <label className="flex cursor-pointer items-center gap-2 py-0.5 text-xs text-gray-300 hover:text-gray-100">
                  <input
                    type="checkbox"
                    checked={localFilters.hasVerifiedTelemetry === true}
                    onChange={(event) => setLocalFilters((prev) => normalizeFilters({
                      ...prev,
                      telemetryState: undefined,
                      hasVerifiedTelemetry: event.target.checked ? true : undefined,
                    }))}
                    className="ui-checkbox"
                  />
                  <span>{t('librarySearch.metahubSaveNodeOnly')}</span>
                </label>
                <div className="space-y-2.5">
                  {renderNumberRange(t('librarySearch.generationTimeMs'), 'generationTimeMs', { step: '50' })}
                  {renderNumberRange(t('librarySearch.speedItS'), 'stepsPerSecond', { step: '0.1' })}
                  {renderNumberRange(t('librarySearch.vramPeakMb'), 'vramPeakMb', { step: '1' })}
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

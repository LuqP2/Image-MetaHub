import { useTranslation } from '../i18n/useTranslation';
import { translatePresentationMessage } from '../i18n/presentationMessages';
import React, { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, Calendar, CheckCircle2, Cpu, Filter, Heart, Layers, Sparkles, Timer, X, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import type { AdvancedFilters } from '../types';
import {
  buildAnalyticsExplorerData,
  formatGenerationTime,
  getCompareDimensionOptions,
  type AnalyticsCompareConfig,
  type AnalyticsCompareDimension,
  type AnalyticsExplorerData,
  type AnalyticsFacetItem,
  type AnalyticsNumericBucket,
  type AnalyticsScopeMode,
} from '../utils/analyticsUtils';
import { formatLocalDateKey } from '../utils/dateFilterUtils';

interface AnalyticsProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExplorerTab = 'overview' | 'resources' | 'time' | 'performance' | 'curation';
type ResourceFacetKind = 'generator' | 'model' | 'lora' | 'sampler' | 'scheduler' | 'gpu';
type NumericFacetKind = 'generationTimeMs' | 'stepsPerSecond' | 'vramPeakMb';

const TABS: ExplorerTab[] = ['overview', 'resources', 'time', 'performance', 'curation'];
const ALL_RATINGS = [1, 2, 3, 4, 5] as const;
const card = 'rounded-2xl border border-gray-700/70 bg-gray-900/75 backdrop-blur-sm';
const EMPTY_COMPARE_OPTIONS: Record<AnalyticsCompareDimension, string[]> = {
  generator: [],
  model: [],
  lora: [],
  sampler: [],
  scheduler: [],
  gpu: [],
  rating: [],
  telemetry: [],
};
const COMPARE_LABELS: Record<AnalyticsCompareDimension, string> = {
  generator: 'Generator',
  model: 'Model',
  lora: 'LoRA',
  sampler: 'Sampler',
  scheduler: 'Scheduler',
  gpu: 'GPU',
  rating: 'Rating',
  telemetry: 'Performance Data',
};

const percent = (value: number) => `${(value * 100).toFixed(0)}%`;
const compact = (value: number) => Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const sameRange = (current: AdvancedFilters['steps'], min?: number, max?: number) =>
  (current?.min ?? null) === (min ?? null) &&
  (current?.max ?? null) === (max ?? null) &&
  Boolean(current?.maxExclusive) === Boolean(max !== undefined);
const compareSelectClass = 'min-w-0 w-full truncate rounded-xl border border-gray-700 bg-gray-950/70 px-3 py-2 pr-8 text-sm text-gray-200';

const StatCard = ({ label, value, meta, icon: Icon }: { label: string; value: string; meta?: string; icon: LucideIcon }) => {
  const { t } = useTranslation();
  return (
  <div className={`${card} min-w-0 p-4`}>
    <div className="mb-3 flex items-center gap-3">
      <div className="rounded-xl border border-gray-700 bg-gray-950/70 p-2"><Icon size={18} className="text-cyan-300" /></div>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</div>
    </div>
    <div className="min-w-0 break-words text-2xl font-bold leading-tight text-gray-100">{value}</div>
    {meta && <div className="mt-1 text-sm text-gray-400">{meta ? translatePresentationMessage(meta, t) : meta}</div>}
  </div>
);
};

const FacetButton = ({
  label,
  meta,
  count,
  maxCount,
  activeMode,
  onClick,
}: {
  label: string;
  meta: string;
  count: number;
  maxCount: number;
  activeMode?: 'include' | 'exclude' | null;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}) => {
  const { t } = useTranslation();
  return (
  <button
    type="button"
    onClick={onClick}
    title={t('analytics.facetHelp')}
    className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
      activeMode === 'include' ? 'border-blue-500/60 bg-blue-500/15 text-blue-100' :
      activeMode === 'exclude' ? 'border-rose-500/50 bg-rose-500/10 text-rose-100' :
      'border-gray-800 bg-gray-950/40 text-gray-200 hover:border-gray-700 hover:bg-gray-900/80'
    }`}
  >
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{label}</div>
        <div className="mt-1 text-xs text-gray-400">{meta}</div>
      </div>
      <div className="h-2 w-24 rounded-full bg-gray-800">
        <div className={`h-2 rounded-full ${activeMode === 'exclude' ? 'bg-rose-400' : 'bg-cyan-400'}`} style={{ width: `${maxCount > 0 ? (count / maxCount) * 100 : 0}%` }} />
      </div>
      <div className="w-12 shrink-0 text-right text-sm font-semibold">{count}</div>
    </div>
  </button>
);
};

const NumericButton = ({
  bucket,
  maxCount,
  active,
  onClick,
}: {
  bucket: AnalyticsNumericBucket;
  maxCount: number;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
      active ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-100' : 'border-gray-800 bg-gray-950/40 text-gray-200 hover:border-gray-700 hover:bg-gray-900/80'
    }`}
  >
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 text-xs font-medium">{bucket.label}</div>
      <div className="h-2 flex-1 rounded-full bg-gray-800">
        <div className={`h-2 rounded-full ${active ? 'bg-emerald-400' : 'bg-amber-400'}`} style={{ width: `${maxCount > 0 ? (bucket.count / maxCount) * 100 : 0}%` }} />
      </div>
      <div className="w-12 shrink-0 text-right text-sm font-semibold">{bucket.count}</div>
    </div>
  </button>
);

const Analytics: React.FC<AnalyticsProps> = ({ isOpen, onClose }) => {
  const { t, language } = useTranslation();
  const weekdayName = (key: string) => { const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(key.toLowerCase().slice(0, 3)); return day < 0 ? key : new Intl.DateTimeFormat(language, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + day))); };
  const compareLabel = (value: string) => compareDimension === 'telemetry' ? t(value === 'present' ? 'analytics.hasPerformance' : 'analytics.missingPerformance') : value;

  const { canUseAnalytics } = useFeatureAccess();
  const allImages = useImageStore((state) => state.images);
  const filteredImages = useImageStore((state) => state.filteredImages);
  const setSelectedImage = useImageStore((state) => state.setSelectedImage);
  const setSelectedFilters = useImageStore((state) => state.setSelectedFilters);
  const setAdvancedFilters = useImageStore((state) => state.setAdvancedFilters);
  const setFavoriteFilterMode = useImageStore((state) => state.setFavoriteFilterMode);
  const setSelectedRatings = useImageStore((state) => state.setSelectedRatings);
  const selectedModels = useImageStore((state) => state.selectedModels);
  const excludedModels = useImageStore((state) => state.excludedModels);
  const selectedLoras = useImageStore((state) => state.selectedLoras);
  const excludedLoras = useImageStore((state) => state.excludedLoras);
  const selectedSamplers = useImageStore((state) => state.selectedSamplers);
  const excludedSamplers = useImageStore((state) => state.excludedSamplers);
  const selectedSchedulers = useImageStore((state) => state.selectedSchedulers);
  const excludedSchedulers = useImageStore((state) => state.excludedSchedulers);
  const selectedGenerators = useImageStore((state) => state.selectedGenerators);
  const excludedGenerators = useImageStore((state) => state.excludedGenerators);
  const selectedGpuDevices = useImageStore((state) => state.selectedGpuDevices);
  const excludedGpuDevices = useImageStore((state) => state.excludedGpuDevices);
  const selectedRatingsState = useImageStore((state) => state.selectedRatings);
  const favoriteFilterMode = useImageStore((state) => state.favoriteFilterMode);
  const advancedFilters = useImageStore((state) => state.advancedFilters);

  const filterState = {
    selectedModels,
    excludedModels,
    selectedLoras,
    excludedLoras,
    selectedSamplers,
    excludedSamplers,
    selectedSchedulers,
    excludedSchedulers,
    selectedGenerators,
    excludedGenerators,
    selectedGpuDevices,
    excludedGpuDevices,
    selectedRatings: selectedRatingsState,
    favoriteFilterMode,
    advancedFilters,
  };

  const [tab, setTab] = useState<ExplorerTab>('overview');
  const [scopeMode, setScopeMode] = useState<AnalyticsScopeMode>('context');
  const [compareDimension, setCompareDimension] = useState<AnalyticsCompareDimension>('generator');
  const [compareLeftKey, setCompareLeftKey] = useState('');
  const [compareRightKey, setCompareRightKey] = useState('');

  useEffect(() => { if (!isOpen) { setTab('overview'); setScopeMode('context'); } }, [isOpen]);

  const scopeImages = scopeMode === 'library' ? allImages : filteredImages;
  const compare = compareLeftKey && compareRightKey && compareLeftKey !== compareRightKey ? { dimension: compareDimension, leftKey: compareLeftKey, rightKey: compareRightKey } as AnalyticsCompareConfig : null;
  const analytics = useMemo(() => {
    if (!isOpen || !canUseAnalytics) {
      return null;
    }
    return buildAnalyticsExplorerData({ scopeImages, allImages, scopeMode, compare });
  }, [allImages, canUseAnalytics, compare, isOpen, scopeImages, scopeMode]);

  // Optimization: Pre-calculate maximum counts for distributions to avoid O(N^2) in render loops.
  const maxCounts = useMemo(() => {
    if (!analytics) return { timeline: 1, weekday: 1, hourly: 1, rating: 1 };

    const getMax = (arr: { count: number }[]) => {
      let max = 0;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].count > max) max = arr[i].count;
      }
      return max > 0 ? max : 1;
    };

    return {
      timeline: getMax(analytics.time.timeline),
      weekday: getMax(analytics.time.weekday),
      hourly: getMax(analytics.time.hourly),
      rating: getMax(analytics.curation.ratingDistribution),
    };
  }, [analytics]);

  const compareOptions = useMemo(
    () => analytics ? getCompareDimensionOptions(analytics) : EMPTY_COMPARE_OPTIONS,
    [analytics]
  );

  useEffect(() => {
    if (!analytics) {
      return;
    }
    const options = compareOptions[compareDimension] || [];
    if (!options.includes(compareLeftKey)) setCompareLeftKey(options[0] || '');
    const fallbackRight = options.find((value) => value !== (options[0] || '')) || '';
    if (!options.includes(compareRightKey) || compareRightKey === compareLeftKey) setCompareRightKey(fallbackRight);
  }, [analytics, compareDimension, compareLeftKey, compareOptions, compareRightKey]);

  if (!isOpen || !canUseAnalytics || !analytics) return null;

  const activeFilterCount = Object.values(filterState).reduce((count, value) => {
    if (Array.isArray(value)) return count + value.length;
    if (typeof value === 'object' && value) return count + Object.keys(value).length;
    return count + (value && value !== 'neutral' ? 1 : 0);
  }, 0);

  const facetMode = (kind: ResourceFacetKind, value: string): 'include' | 'exclude' | null => {
    const mapping = {
      model: [filterState.selectedModels, filterState.excludedModels],
      lora: [filterState.selectedLoras, filterState.excludedLoras],
      sampler: [filterState.selectedSamplers, filterState.excludedSamplers],
      scheduler: [filterState.selectedSchedulers, filterState.excludedSchedulers],
      generator: [filterState.selectedGenerators, filterState.excludedGenerators],
      gpu: [filterState.selectedGpuDevices, filterState.excludedGpuDevices],
    }[kind];
    return mapping[0].includes(value) ? 'include' : mapping[1].includes(value) ? 'exclude' : null;
  };

  const updateFacet = (kind: ResourceFacetKind, value: string, mode: 'include' | 'exclude', accumulate: boolean) => {
    const mapping = {
      model: { selected: 'models', excluded: 'excludedModels', selectedValues: filterState.selectedModels, excludedValues: filterState.excludedModels },
      lora: { selected: 'loras', excluded: 'excludedLoras', selectedValues: filterState.selectedLoras, excludedValues: filterState.excludedLoras },
      sampler: { selected: 'samplers', excluded: 'excludedSamplers', selectedValues: filterState.selectedSamplers, excludedValues: filterState.excludedSamplers },
      scheduler: { selected: 'schedulers', excluded: 'excludedSchedulers', selectedValues: filterState.selectedSchedulers, excludedValues: filterState.excludedSchedulers },
      generator: { selected: 'generators', excluded: 'excludedGenerators', selectedValues: filterState.selectedGenerators, excludedValues: filterState.excludedGenerators },
      gpu: { selected: 'gpuDevices', excluded: 'excludedGpuDevices', selectedValues: filterState.selectedGpuDevices, excludedValues: filterState.excludedGpuDevices },
    }[kind];
    const targetValues = mode === 'include' ? mapping.selectedValues : mapping.excludedValues;
    const otherValues = mode === 'include' ? mapping.excludedValues : mapping.selectedValues;
    const targetKey = mode === 'include' ? mapping.selected : mapping.excluded;
    const otherKey = mode === 'include' ? mapping.excluded : mapping.selected;
    if (targetValues.includes(value)) {
      setSelectedFilters({ [targetKey]: targetValues.filter((item) => item !== value) });
      return;
    }
    setSelectedFilters({ [targetKey]: accumulate ? [...targetValues, value] : [value], [otherKey]: otherValues.filter((item) => item !== value) });
  };

  const clickFacet = (kind: ResourceFacetKind, value: string, event: React.MouseEvent<HTMLButtonElement>) => updateFacet(kind, value, event.altKey ? 'exclude' : 'include', event.shiftKey);
  const clickRating = (value: number, event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.altKey) {
      const complement = ALL_RATINGS.filter((rating) => rating !== value) as Array<(typeof ALL_RATINGS)[number]>;
      const same = complement.length === filterState.selectedRatings.length && complement.every((rating) => filterState.selectedRatings.includes(rating));
      setSelectedRatings(same ? [] : [...complement]);
      return;
    }
    if (event.shiftKey) {
      setSelectedRatings(filterState.selectedRatings.includes(value as (typeof ALL_RATINGS)[number]) ? filterState.selectedRatings.filter((rating) => rating !== value) : [...filterState.selectedRatings, value as (typeof ALL_RATINGS)[number]]);
      return;
    }
    setSelectedRatings(filterState.selectedRatings.length === 1 && filterState.selectedRatings[0] === value ? [] : [value as (typeof ALL_RATINGS)[number]]);
  };
  const clickNumeric = (kind: NumericFacetKind, bucket: AnalyticsNumericBucket) => {
    const next = { ...filterState.advancedFilters };
    if (sameRange(next[kind], bucket.min, bucket.max)) delete next[kind];
    else next[kind] = { min: bucket.min ?? null, max: bucket.max ?? null, maxExclusive: bucket.max !== undefined ? true : undefined };
    setAdvancedFilters(next);
  };
  const clickDay = (day: string) => setAdvancedFilters({ ...filterState.advancedFilters, date: { from: day, to: day } });
  const clickSession = (session: AnalyticsExplorerData['time']['sessions'][number]) => setAdvancedFilters({ ...filterState.advancedFilters, date: { from: formatLocalDateKey(session.start), to: formatLocalDateKey(session.end) } });
  const promoteCompare = (key: string) => {
    switch (compareDimension) {
      case 'generator': setSelectedFilters({ generators: [key], excludedGenerators: [] }); break;
      case 'model': setSelectedFilters({ models: [key], excludedModels: [] }); break;
      case 'lora': setSelectedFilters({ loras: [key], excludedLoras: [] }); break;
      case 'sampler': setSelectedFilters({ samplers: [key], excludedSamplers: [] }); break;
      case 'scheduler': setSelectedFilters({ schedulers: [key], excludedSchedulers: [] }); break;
      case 'gpu': setSelectedFilters({ gpuDevices: [key], excludedGpuDevices: [] }); break;
      case 'rating': setSelectedRatings([Number(key) as 1 | 2 | 3 | 4 | 5]); break;
      case 'telemetry': setAdvancedFilters({ ...filterState.advancedFilters, telemetryState: key === 'present' ? 'present' : 'missing', hasVerifiedTelemetry: undefined }); break;
    }
  };

  const resourceSection = (title: string, items: AnalyticsFacetItem[], kind: ResourceFacetKind) => {
    const maxCount = items[0]?.count || 1;
    return (
      <section className={`${card} p-4`}>
        <div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">{translatePresentationMessage(title, t)}</h3></div>
        <div className="space-y-2">
          {items.length > 0 ? items.map((item) => (
            <FacetButton key={`${kind}-${item.key}`} label={item.label} meta={t('analytics.resourceStats', { count: item.count, share: percent(item.share), keepers: percent(item.keeperRate) }) + (item.ratingCount ? t('analytics.ratingSuffix', { value: item.averageRating.toFixed(1) }) : '')} count={item.count} maxCount={maxCount} activeMode={facetMode(kind, item.key)} onClick={(event) => clickFacet(kind, item.key, event)} />
          )) : <div className="rounded-xl border border-dashed border-gray-800 bg-gray-950/40 p-6 text-sm text-gray-500">{t('analytics.noData')}</div>}
        </div>
      </section>
    );
  };

  const numericSection = (title: string, buckets: AnalyticsNumericBucket[], kind: NumericFacetKind) => {
    // Optimization: Calculate max count in a single O(N) pass to avoid spread syntax overhead and extra allocations.
    let maxCount = 1;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].count > maxCount) maxCount = buckets[i].count;
    }

    return (
      <section className={`${card} p-4`}>
        <div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">{translatePresentationMessage(title, t)}</h3></div>
        <div className="space-y-2">
          {buckets.map((bucket) => <NumericButton key={bucket.key} bucket={bucket} maxCount={maxCount} active={sameRange(filterState.advancedFilters[kind], bucket.min, bucket.max)} onClick={() => clickNumeric(kind, bucket)} />)}
        </div>
      </section>
    );
  };

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/85 backdrop-blur-sm">
      <div className="min-h-screen p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          <div className={`${card} sticky top-4 z-20 mb-6 p-5 shadow-2xl shadow-black/40`}>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-3"><BarChart3 size={26} className="text-cyan-300" /></div>
                <div><h2 className="text-3xl font-bold text-gray-100">{t('analytics.title')}</h2></div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-full border border-gray-700 bg-gray-950/70 p-1">
                  {(['context', 'library'] as AnalyticsScopeMode[]).map((mode) => <button key={mode} type="button" onClick={() => setScopeMode(mode)} className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${scopeMode === mode ? 'bg-cyan-500/15 text-cyan-100' : 'text-gray-400 hover:text-white'}`}>{mode === 'context' ? t('analytics.currentScope') : t('analytics.fullLibrary')}</button>)}
                </div>
                <button type="button" onClick={onClose} className="rounded-full border border-gray-700 bg-gray-950/70 p-2 text-gray-400 transition-colors hover:border-gray-600 hover:text-white" aria-label={t('analytics.close')}><X size={18} /></button>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3 border-t border-gray-800 pt-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                {TABS.map((value) => <button key={value} type="button" onClick={() => setTab(value)} className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${tab === value ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-100' : 'border-gray-700 bg-gray-950/60 text-gray-400 hover:border-gray-600 hover:text-white'}`}>{t(({ overview: 'analytics.tabOverview', resources: 'analytics.tabResources', time: 'analytics.tabTime', performance: 'analytics.tabPerformance', curation: 'analytics.tabCuration' } as const)[value])}</button>)}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                <span>{t('analytics.inView', { count: analytics.totalImages.toLocaleString(language) })}</span><span className="text-gray-600">/</span><span>{t('analytics.indexed', { count: analytics.allImagesCount.toLocaleString(language) })}</span><span className="text-gray-600">/</span><span>{t('analytics.activeFilters', { count: activeFilterCount })}</span>
              </div>
            </div>
          </div>

          {analytics.totalImages === 0 ? <div className={`${card} p-10 text-center`}><div className="text-xl font-semibold text-gray-100">{t('analytics.noImages')}</div><div className="mt-2 text-sm text-gray-500">{t('analytics.adjustScope')}</div></div> : (
            <div className="space-y-6">
              {tab === 'overview' && (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <StatCard label={t('analytics.imagesScope')} value={analytics.totalImages.toLocaleString()} meta={t('analytics.libraryTotal', { count: analytics.allImagesCount.toLocaleString(language) })} icon={BarChart3} />
                    <StatCard label={t('analytics.dominantModel')} value={analytics.dominantModel || 'N/A'} meta={analytics.resources.models[0] ? t('analytics.share', { value: percent(analytics.resources.models[0].share) }) : 'No model metadata'} icon={Layers} />
                    <StatCard label={t('analytics.dominantGenerator')} value={analytics.dominantGenerator || 'N/A'} meta={analytics.resources.generators[0] ? t('analytics.share', { value: percent(analytics.resources.generators[0].share) }) : 'No generator metadata'} icon={Sparkles} />
                    <StatCard label={t('analytics.metricsCoverage')} value={percent(analytics.telemetryCoverage)} meta={t('analytics.performanceImages', { count: analytics.performance.averages.imagesWithTelemetry })} icon={CheckCircle2} />
                  </div>
                  <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
                    <section className={`${card} p-5`}>
                      <div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">{t('analytics.insights')}</h3></div>
                      <div className="space-y-3">{analytics.insights.map((insight, index) => <div key={`${insight.text}-${index}`} className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"><div className="flex items-start gap-3"><div className="text-xl">{insight.icon}</div><div className="text-sm text-gray-200">{insight.message ? t(insight.message.key, { ...insight.message.values, ...(insight.message.key === 'analytics.insightActivity' ? { period: translatePresentationMessage(insight.message.values.period as string, t) } : {}) }) : insight.text}</div></div></div>)}</div>
                    </section>
                    <section className={`${card} p-5`}>
                      <div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">{t('analytics.compareCohorts')}</h3></div>
                      <div className="space-y-3">
                        <select value={compareDimension} onChange={(event) => setCompareDimension(event.target.value as AnalyticsCompareDimension)} className={compareSelectClass}>{(Object.keys(compareOptions) as AnalyticsCompareDimension[]).map((value) => <option key={value} value={value}>{translatePresentationMessage(COMPARE_LABELS[value], t)}</option>)}</select>
                        <div className="grid grid-cols-2 gap-3">
                          <select value={compareLeftKey} onChange={(event) => setCompareLeftKey(event.target.value)} className={compareSelectClass} title={compareLeftKey}>{(compareOptions[compareDimension] || []).map((value) => <option key={`left-${value}`} value={value}>{compareLabel(value)}</option>)}</select>
                          <select value={compareRightKey} onChange={(event) => setCompareRightKey(event.target.value)} className={compareSelectClass} title={compareRightKey}>{(compareOptions[compareDimension] || []).map((value) => <option key={`right-${value}`} value={value}>{value}</option>)}</select>
                        </div>
                        {analytics.compare ? <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{[analytics.compare.left, analytics.compare.right].map((cohort) => <div key={cohort.key} className="min-w-0 rounded-xl border border-gray-800 bg-gray-950/50 p-4"><div className="truncate text-sm font-semibold text-gray-100" title={compareLabel(cohort.key)}>{compareLabel(cohort.key)}</div><div className="mt-2 text-2xl font-bold text-cyan-200">{cohort.count}</div><div className="mt-2 space-y-1 text-xs text-gray-400"><div>{t('analytics.favoriteRate', { value: percent(cohort.favoriteRate) })}</div><div>{t('analytics.avgRating', { value: cohort.averageRating > 0 ? cohort.averageRating.toFixed(1) : 'N/A' })}</div><div>{t('analytics.performanceCoverage', { value: percent(cohort.telemetryCoverage) })}</div></div><button type="button" onClick={() => promoteCompare(cohort.key)} className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/50 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-100 transition-colors hover:bg-cyan-500/20"><Filter size={14} />{t('analytics.promote')}</button></div>)}</div> : <div className="rounded-xl border border-dashed border-gray-800 bg-gray-950/40 p-5 text-sm text-gray-500">{t('analytics.pickTwo')}</div>}
                      </div>
                    </section>
                  </div>
                  <section className={`${card} p-5`}>
                    <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-lg font-semibold text-gray-100">{t('analytics.sampleTray')}</h3></div><button type="button" onClick={onClose} className="inline-flex items-center gap-2 rounded-full border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20"><Filter size={16} />{t('analytics.viewImages', { count: analytics.totalImages.toLocaleString(language) })}</button></div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">{analytics.samples.map((image) => <button key={image.id} type="button" onClick={() => setSelectedImage(image)} className="group overflow-hidden rounded-2xl border border-gray-800 bg-gray-950/70 text-left transition-colors hover:border-gray-600" title={image.name}><div className="aspect-square overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-gray-950">{image.thumbnailUrl ? <img src={image.thumbnailUrl} alt={image.name} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" /> : <div className="flex h-full items-center justify-center px-4 text-center text-xs text-gray-500">{image.name}</div>}</div><div className="border-t border-gray-800 px-3 py-2"><div className="truncate text-xs font-medium text-gray-200">{image.name}</div><div className="mt-1 truncate text-[11px] text-gray-500">{image.models[0] || image.scheduler || t('analytics.noMetadata')}</div></div></button>)}</div>
                  </section>
                </>
              )}

              {tab === 'resources' && <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">{resourceSection('Generators', analytics.resources.generators, 'generator')}{resourceSection('Models', analytics.resources.models, 'model')}{resourceSection('LoRAs', analytics.resources.loras, 'lora')}{resourceSection('Samplers', analytics.resources.samplers, 'sampler')}{resourceSection('Schedulers', analytics.resources.schedulers, 'scheduler')}{resourceSection('GPU Devices', analytics.performance.byGPU.map((item) => ({ key: item.name, label: item.name, count: item.count, share: analytics.totalImages > 0 ? item.count / analytics.totalImages : 0, favorites: 0, keeperRate: 0, averageRating: 0, ratingCount: 0 })), 'gpu')}</div>}

              {tab === 'time' && <div className="grid grid-cols-1 gap-6 xl:grid-cols-2"><section className={`${card} p-4 xl:col-span-2`}><div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">{t('analytics.timeline')}</h3></div><div className="space-y-2">{analytics.time.timeline.map((item) => <FacetButton key={item.key} label={new Date(item.key + 'T00:00:00').toLocaleDateString(language)} meta={t('analytics.imageCount', { count: item.count })} count={item.count} maxCount={maxCounts.timeline} activeMode={filterState.advancedFilters.date?.from === item.key && filterState.advancedFilters.date?.to === item.key ? 'include' : null} onClick={() => clickDay(item.key)} />)}</div></section><section className={`${card} p-4`}><div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">{t('analytics.weekdays')}</h3></div><div className="space-y-2">{analytics.time.weekday.map((item) => <FacetButton key={item.key} label={weekdayName(item.key)} meta={t('analytics.imageCount', { count: item.count })} count={item.count} maxCount={maxCounts.weekday} />)}</div></section><section className={`${card} p-4`}><div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">{t('analytics.hours')}</h3></div><div className="space-y-2">{analytics.time.hourly.map((item) => <FacetButton key={item.key} label={item.label} meta={t('analytics.imageCount', { count: item.count })} count={item.count} maxCount={maxCounts.hourly} />)}</div></section><section className={`${card} p-4 xl:col-span-2`}><div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">{t('analytics.sessions')}</h3></div><div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{analytics.time.sessions.map((session) => <button key={session.id} type="button" onClick={() => clickSession(session)} className="rounded-xl border border-gray-800 bg-gray-950/50 p-4 text-left transition-colors hover:border-gray-700 hover:bg-gray-900/80"><div className="flex items-center justify-between gap-3"><div className="text-sm font-semibold text-gray-100">{new Date(session.start).toLocaleDateString(language) + ' ' + new Date(session.start).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}</div><div className="rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5 text-xs text-gray-300">{t('analytics.imageCount', { count: session.count })}</div></div><div className="mt-2 text-xs text-gray-400">{t('analytics.timeRange', { start: new Date(session.start).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }), end: new Date(session.end).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }) })}</div><div className="mt-2 text-xs text-cyan-300">{session.dominantModel || t('analytics.noDominant')}</div></button>)}</div></section></div>}

              {tab === 'performance' && <div className="space-y-6"><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"><StatCard label={t('analytics.avgSpeed')} value={analytics.performance.averages.avgStepsPerSecond > 0 ? `${analytics.performance.averages.avgStepsPerSecond.toFixed(1)} it/s` : 'N/A'} meta={t('analytics.acrossPerformance')} icon={Zap} /><StatCard label={t('analytics.avgVram')} value={analytics.performance.averages.avgVramPeak > 0 ? `${(analytics.performance.averages.avgVramPeak / 1024).toFixed(1)} GB` : 'N/A'} meta={t('analytics.peakUsage')} icon={Cpu} /><StatCard label={t('analytics.avgTime')} value={analytics.performance.averages.avgGenerationTime > 0 ? formatGenerationTime(analytics.performance.averages.avgGenerationTime) : 'N/A'} meta={t('analytics.perImage')} icon={Timer} /><StatCard label={t('analytics.trackedImages')} value={compact(analytics.performance.averages.imagesWithTelemetry)} meta={t('analytics.currentScopeShare', { value: percent(analytics.telemetryCoverage) })} icon={CheckCircle2} /></div><div className="grid grid-cols-1 gap-6 xl:grid-cols-3">{numericSection('Generation Time', analytics.performance.generationTime, 'generationTimeMs')}{numericSection('Speed Buckets', analytics.performance.speed, 'stepsPerSecond')}{numericSection('VRAM Buckets', analytics.performance.vram, 'vramPeakMb')}</div></div>}

              {tab === 'curation' && <div className="space-y-6"><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"><StatCard label={t('promptLibrary.favorites')} value={compact(analytics.curation.favoritesCount)} meta={t('analytics.scopeShare', { value: percent(analytics.curation.favoriteRate) })} icon={Heart} /><StatCard label={t('analytics.unratedBacklog')} value={compact(analytics.curation.unratedCount)} meta={t('analytics.withoutRating')} icon={Calendar} /><StatCard label={t('analytics.keeperModel')} value={analytics.curation.keeperModels[0]?.label || 'N/A'} meta={analytics.curation.keeperModels[0] ? t('analytics.keeperRate', { value: percent(analytics.curation.keeperModels[0].keeperRate) }) : 'No model metadata'} icon={Layers} /><StatCard label={t('analytics.keeperLora')} value={analytics.curation.keeperLoras[0]?.label || 'N/A'} meta={analytics.curation.keeperLoras[0] ? t('analytics.keeperRate', { value: percent(analytics.curation.keeperLoras[0].keeperRate) }) : 'No LoRA metadata'} icon={Activity} /></div><section className={`${card} p-4`}><div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-lg font-semibold text-gray-100">{t('analytics.ratings')}</h3></div><div className="flex gap-2"><button type="button" onClick={() => setFavoriteFilterMode(filterState.favoriteFilterMode === 'include' ? 'neutral' : 'include')} className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filterState.favoriteFilterMode === 'include' ? 'border-amber-500/60 bg-amber-500/15 text-amber-100' : 'border-gray-700 bg-gray-950/60 text-gray-300 hover:border-gray-600'}`}>{t('promptLibrary.favoritesOnly')}</button><button type="button" onClick={() => setFavoriteFilterMode(filterState.favoriteFilterMode === 'exclude' ? 'neutral' : 'exclude')} className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filterState.favoriteFilterMode === 'exclude' ? 'border-rose-500/60 bg-rose-500/15 text-rose-100' : 'border-gray-700 bg-gray-950/60 text-gray-300 hover:border-gray-600'}`}>{t('analytics.excludeFavorites')}</button></div></div><div className="space-y-2">{analytics.curation.ratingDistribution.map((item) => item.key === 'unrated' ? <FacetButton key={item.key} label={translatePresentationMessage('Unrated', t)} meta={t('analytics.imageCount', { count: item.count })} count={item.count} maxCount={maxCounts.rating} /> : <FacetButton key={item.key} label={item.label} meta={t('analytics.imageCount', { count: item.count })} count={item.count} maxCount={maxCounts.rating} activeMode={filterState.selectedRatings.includes(Number(item.key) as (typeof ALL_RATINGS)[number]) ? 'include' : null} onClick={(event) => clickRating(Number(item.key), event)} />)}</div></section><div className="grid grid-cols-1 gap-6 xl:grid-cols-2">{resourceSection('Top Keeper Models', analytics.curation.keeperModels, 'model')}{resourceSection('Top Keeper LoRAs', analytics.curation.keeperLoras, 'lora')}</div></div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Analytics;

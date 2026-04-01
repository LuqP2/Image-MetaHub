import React, { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, Calendar, CheckCircle2, Cpu, Filter, Layers, Sparkles, Star, Timer, X, Zap } from 'lucide-react';
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
const sameRange = (current: AdvancedFilters['steps'], min?: number, max?: number) => (current?.min ?? null) === (min ?? null) && (current?.max ?? null) === (max ?? null);

const StatCard = ({ label, value, meta, icon: Icon }: { label: string; value: string; meta?: string; icon: React.ComponentType<any> }) => (
  <div className={`${card} min-w-0 p-4`}>
    <div className="mb-3 flex items-center gap-3">
      <div className="rounded-xl border border-gray-700 bg-gray-950/70 p-2"><Icon size={18} className="text-cyan-300" /></div>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</div>
    </div>
    <div className="min-w-0 break-words text-2xl font-bold leading-tight text-gray-100">{value}</div>
    {meta && <div className="mt-1 text-sm text-gray-400">{meta}</div>}
  </div>
);

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
}) => (
  <button
    type="button"
    onClick={onClick}
    title="Click to include. Shift+click accumulates. Alt/Option+click excludes."
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
    else next[kind] = { min: bucket.min ?? null, max: bucket.max ?? null };
    setAdvancedFilters(next);
  };
  const clickDay = (day: string) => setAdvancedFilters({ ...filterState.advancedFilters, date: { from: day, to: day } });
  const clickSession = (session: AnalyticsExplorerData['time']['sessions'][number]) => setAdvancedFilters({ ...filterState.advancedFilters, date: { from: new Date(session.start).toISOString().slice(0, 10), to: new Date(session.end).toISOString().slice(0, 10) } });
  const promoteCompare = (key: string) => {
    switch (compareDimension) {
      case 'generator': setSelectedFilters({ generators: [key], excludedGenerators: [] }); break;
      case 'model': setSelectedFilters({ models: [key], excludedModels: [] }); break;
      case 'lora': setSelectedFilters({ loras: [key], excludedLoras: [] }); break;
      case 'sampler': setSelectedFilters({ samplers: [key], excludedSamplers: [] }); break;
      case 'scheduler': setSelectedFilters({ schedulers: [key], excludedSchedulers: [] }); break;
      case 'gpu': setSelectedFilters({ gpuDevices: [key], excludedGpuDevices: [] }); break;
      case 'rating': setSelectedRatings([Number(key) as 1 | 2 | 3 | 4 | 5]); break;
      case 'telemetry': setAdvancedFilters({ ...filterState.advancedFilters, hasVerifiedTelemetry: key === 'verified' ? true : undefined }); break;
    }
  };

  const resourceSection = (title: string, items: AnalyticsFacetItem[], kind: ResourceFacetKind) => {
    const maxCount = items[0]?.count || 1;
    return (
      <section className={`${card} p-4`}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-100">{title}</h3>
          <p className="text-sm text-gray-400">Filter-first exploration with include, accumulate, and exclude.</p>
        </div>
        <div className="space-y-2">
          {items.length > 0 ? items.map((item) => (
            <FacetButton key={`${kind}-${item.key}`} label={item.label} meta={`${item.count} images · ${percent(item.share)} share · ${percent(item.keeperRate)} keepers${item.ratingCount ? ` · ${item.averageRating.toFixed(1)} avg rating` : ''}`} count={item.count} maxCount={maxCount} activeMode={facetMode(kind, item.key)} onClick={(event) => clickFacet(kind, item.key, event)} />
          )) : <div className="rounded-xl border border-dashed border-gray-800 bg-gray-950/40 p-6 text-sm text-gray-500">No data in this scope.</div>}
        </div>
      </section>
    );
  };

  const numericSection = (title: string, buckets: AnalyticsNumericBucket[], kind: NumericFacetKind) => {
    const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1);
    return (
      <section className={`${card} p-4`}>
        <div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">{title}</h3></div>
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
                <div><h2 className="text-3xl font-bold text-gray-100">Analytics Explorer</h2><p className="mt-1 text-sm text-gray-400">Interactive analysis that refines the global library, instead of a dead-end dashboard.</p></div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-full border border-gray-700 bg-gray-950/70 p-1">
                  {(['context', 'library'] as AnalyticsScopeMode[]).map((mode) => <button key={mode} type="button" onClick={() => setScopeMode(mode)} className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${scopeMode === mode ? 'bg-cyan-500/15 text-cyan-100' : 'text-gray-400 hover:text-white'}`}>{mode === 'context' ? 'Current Scope' : 'Full Library'}</button>)}
                </div>
                <button type="button" onClick={onClose} className="rounded-full border border-gray-700 bg-gray-950/70 p-2 text-gray-400 transition-colors hover:border-gray-600 hover:text-white"><X size={18} /></button>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3 border-t border-gray-800 pt-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                {TABS.map((value) => <button key={value} type="button" onClick={() => setTab(value)} className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${tab === value ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-100' : 'border-gray-700 bg-gray-950/60 text-gray-400 hover:border-gray-600 hover:text-white'}`}>{value}</button>)}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                <span>{analytics.totalImages.toLocaleString()} images in view</span><span className="text-gray-600">/</span><span>{analytics.allImagesCount.toLocaleString()} indexed</span><span className="text-gray-600">/</span><span>{activeFilterCount} global filters active</span>
              </div>
            </div>
          </div>

          {analytics.totalImages === 0 ? <div className={`${card} p-10 text-center`}><div className="text-xl font-semibold text-gray-100">Nothing in this scope</div><div className="mt-2 text-sm text-gray-500">Switch to full library or relax the current filters.</div></div> : (
            <div className="space-y-6">
              {tab === 'overview' && (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <StatCard label="Images In Scope" value={analytics.totalImages.toLocaleString()} meta={`Library total: ${analytics.allImagesCount.toLocaleString()}`} icon={BarChart3} />
                    <StatCard label="Dominant Model" value={analytics.dominantModel || 'N/A'} meta={analytics.resources.models[0] ? `${percent(analytics.resources.models[0].share)} share` : 'No model metadata'} icon={Layers} />
                    <StatCard label="Dominant Generator" value={analytics.dominantGenerator || 'N/A'} meta={analytics.resources.generators[0] ? `${percent(analytics.resources.generators[0].share)} share` : 'No generator metadata'} icon={Sparkles} />
                    <StatCard label="Metrics Coverage" value={percent(analytics.telemetryCoverage)} meta={`${analytics.performance.averages.imagesWithTelemetry} images with performance data`} icon={CheckCircle2} />
                  </div>
                  <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
                    <section className={`${card} p-5`}>
                      <div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">Actionable Insights</h3><p className="text-sm text-gray-400">Each click should shrink the library into something you can actually inspect.</p></div>
                      <div className="space-y-3">{analytics.insights.map((insight, index) => <div key={`${insight.text}-${index}`} className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"><div className="flex items-start gap-3"><div className="text-xl">{insight.icon}</div><div className="text-sm text-gray-200">{insight.text}</div></div></div>)}</div>
                    </section>
                    <section className={`${card} p-5`}>
                      <div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">Compare Cohorts</h3><p className="text-sm text-gray-400">Keep comparison local, then promote the winning cohort into the global filter state.</p></div>
                      <div className="space-y-3">
                        <select value={compareDimension} onChange={(event) => setCompareDimension(event.target.value as AnalyticsCompareDimension)} className="w-full rounded-xl border border-gray-700 bg-gray-950/70 px-3 py-2 text-sm text-gray-200">{(Object.keys(compareOptions) as AnalyticsCompareDimension[]).map((value) => <option key={value} value={value}>{COMPARE_LABELS[value]}</option>)}</select>
                        <div className="grid grid-cols-2 gap-3">
                          <select value={compareLeftKey} onChange={(event) => setCompareLeftKey(event.target.value)} className="w-full rounded-xl border border-gray-700 bg-gray-950/70 px-3 py-2 text-sm text-gray-200">{(compareOptions[compareDimension] || []).map((value) => <option key={`left-${value}`} value={value}>{value}</option>)}</select>
                          <select value={compareRightKey} onChange={(event) => setCompareRightKey(event.target.value)} className="w-full rounded-xl border border-gray-700 bg-gray-950/70 px-3 py-2 text-sm text-gray-200">{(compareOptions[compareDimension] || []).map((value) => <option key={`right-${value}`} value={value}>{value}</option>)}</select>
                        </div>
                        {analytics.compare ? <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{[analytics.compare.left, analytics.compare.right].map((cohort) => <div key={cohort.key} className="rounded-xl border border-gray-800 bg-gray-950/50 p-4"><div className="text-sm font-semibold text-gray-100">{cohort.label}</div><div className="mt-2 text-2xl font-bold text-cyan-200">{cohort.count}</div><div className="mt-2 space-y-1 text-xs text-gray-400"><div>{percent(cohort.favoriteRate)} favorite rate</div><div>{cohort.averageRating > 0 ? cohort.averageRating.toFixed(1) : 'N/A'} avg rating</div><div>{percent(cohort.telemetryCoverage)} performance data coverage</div></div><button type="button" onClick={() => promoteCompare(cohort.key)} className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/50 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-100 transition-colors hover:bg-cyan-500/20"><Filter size={14} />Promote to global filter</button></div>)}</div> : <div className="rounded-xl border border-dashed border-gray-800 bg-gray-950/40 p-5 text-sm text-gray-500">Pick two different values to compare them side by side.</div>}
                      </div>
                    </section>
                  </div>
                  <section className={`${card} p-5`}>
                    <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-lg font-semibold text-gray-100">Live Sample Tray</h3><p className="text-sm text-gray-400">Always connect the analysis back to actual files.</p></div><button type="button" onClick={onClose} className="inline-flex items-center gap-2 rounded-full border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20"><Filter size={16} />View {analytics.totalImages.toLocaleString()} images</button></div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">{analytics.samples.map((image) => <button key={image.id} type="button" onClick={() => setSelectedImage(image)} className="group overflow-hidden rounded-2xl border border-gray-800 bg-gray-950/70 text-left transition-colors hover:border-gray-600" title={image.name}><div className="aspect-square overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-gray-950">{image.thumbnailUrl ? <img src={image.thumbnailUrl} alt={image.name} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" /> : <div className="flex h-full items-center justify-center px-4 text-center text-xs text-gray-500">{image.name}</div>}</div><div className="border-t border-gray-800 px-3 py-2"><div className="truncate text-xs font-medium text-gray-200">{image.name}</div><div className="mt-1 truncate text-[11px] text-gray-500">{image.models[0] || image.scheduler || 'No metadata'}</div></div></button>)}</div>
                  </section>
                </>
              )}

              {tab === 'resources' && <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">{resourceSection('Generators', analytics.resources.generators, 'generator')}{resourceSection('Models', analytics.resources.models, 'model')}{resourceSection('LoRAs', analytics.resources.loras, 'lora')}{resourceSection('Samplers', analytics.resources.samplers, 'sampler')}{resourceSection('Schedulers', analytics.resources.schedulers, 'scheduler')}{resourceSection('GPU Devices', analytics.performance.byGPU.map((item) => ({ key: item.name, label: item.name, count: item.count, share: analytics.totalImages > 0 ? item.count / analytics.totalImages : 0, favorites: 0, keeperRate: 0, averageRating: 0, ratingCount: 0 })), 'gpu')}</div>}

              {tab === 'time' && <div className="grid grid-cols-1 gap-6 xl:grid-cols-2"><section className={`${card} p-4 xl:col-span-2`}><div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">Timeline</h3><p className="text-sm text-gray-400">Click a day to narrow the library to that exact date.</p></div><div className="space-y-2">{analytics.time.timeline.map((item) => <FacetButton key={item.key} label={item.label} meta={`${item.count} images`} count={item.count} maxCount={Math.max(...analytics.time.timeline.map((entry) => entry.count), 1)} activeMode={filterState.advancedFilters.date?.from === item.key && filterState.advancedFilters.date?.to === item.key ? 'include' : null} onClick={() => clickDay(item.key)} />)}</div></section><section className={`${card} p-4`}><div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">Weekday Distribution</h3></div><div className="space-y-2">{analytics.time.weekday.map((item) => <FacetButton key={item.key} label={item.label} meta={`${item.count} images`} count={item.count} maxCount={Math.max(...analytics.time.weekday.map((entry) => entry.count), 1)} />)}</div></section><section className={`${card} p-4`}><div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">Hourly Distribution</h3></div><div className="space-y-2">{analytics.time.hourly.map((item) => <FacetButton key={item.key} label={item.label} meta={`${item.count} images`} count={item.count} maxCount={Math.max(...analytics.time.hourly.map((entry) => entry.count), 1)} />)}</div></section><section className={`${card} p-4 xl:col-span-2`}><div className="mb-4"><h3 className="text-lg font-semibold text-gray-100">Sessions</h3><p className="text-sm text-gray-400">Reopen a burst of work as a date-bounded slice.</p></div><div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{analytics.time.sessions.map((session) => <button key={session.id} type="button" onClick={() => clickSession(session)} className="rounded-xl border border-gray-800 bg-gray-950/50 p-4 text-left transition-colors hover:border-gray-700 hover:bg-gray-900/80"><div className="flex items-center justify-between gap-3"><div className="text-sm font-semibold text-gray-100">{session.label}</div><div className="rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5 text-xs text-gray-300">{session.count} images</div></div><div className="mt-2 text-xs text-gray-400">{new Date(session.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} to {new Date(session.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div><div className="mt-2 text-xs text-cyan-300">{session.dominantModel || 'No dominant model'}</div></button>)}</div></section></div>}

              {tab === 'performance' && <div className="space-y-6"><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"><StatCard label="Avg Speed" value={analytics.performance.averages.avgStepsPerSecond > 0 ? `${analytics.performance.averages.avgStepsPerSecond.toFixed(1)} it/s` : 'N/A'} meta="Across images with performance data" icon={Zap} /><StatCard label="Avg VRAM" value={analytics.performance.averages.avgVramPeak > 0 ? `${(analytics.performance.averages.avgVramPeak / 1024).toFixed(1)} GB` : 'N/A'} meta="Peak usage" icon={Cpu} /><StatCard label="Avg Time" value={analytics.performance.averages.avgGenerationTime > 0 ? formatGenerationTime(analytics.performance.averages.avgGenerationTime) : 'N/A'} meta="Per image" icon={Timer} /><StatCard label="Tracked Images" value={compact(analytics.performance.averages.imagesWithTelemetry)} meta={`${percent(analytics.telemetryCoverage)} of current scope`} icon={CheckCircle2} /></div><div className="grid grid-cols-1 gap-6 xl:grid-cols-3">{numericSection('Generation Time', analytics.performance.generationTime, 'generationTimeMs')}{numericSection('Speed Buckets', analytics.performance.speed, 'stepsPerSecond')}{numericSection('VRAM Buckets', analytics.performance.vram, 'vramPeakMb')}</div></div>}

              {tab === 'curation' && <div className="space-y-6"><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"><StatCard label="Favorites" value={compact(analytics.curation.favoritesCount)} meta={`${percent(analytics.curation.favoriteRate)} of this scope`} icon={Star} /><StatCard label="Unrated Backlog" value={compact(analytics.curation.unratedCount)} meta="Images without a rating" icon={Calendar} /><StatCard label="Keeper Model" value={analytics.curation.keeperModels[0]?.label || 'N/A'} meta={analytics.curation.keeperModels[0] ? `${percent(analytics.curation.keeperModels[0].keeperRate)} keeper rate` : 'No model metadata'} icon={Layers} /><StatCard label="Keeper LoRA" value={analytics.curation.keeperLoras[0]?.label || 'N/A'} meta={analytics.curation.keeperLoras[0] ? `${percent(analytics.curation.keeperLoras[0].keeperRate)} keeper rate` : 'No LoRA metadata'} icon={Activity} /></div><section className={`${card} p-4`}><div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-lg font-semibold text-gray-100">Rating Distribution</h3><p className="text-sm text-gray-400">Ratings are now part of the explorer, not buried in side panels.</p></div><div className="flex gap-2"><button type="button" onClick={() => setFavoriteFilterMode(filterState.favoriteFilterMode === 'include' ? 'neutral' : 'include')} className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filterState.favoriteFilterMode === 'include' ? 'border-amber-500/60 bg-amber-500/15 text-amber-100' : 'border-gray-700 bg-gray-950/60 text-gray-300 hover:border-gray-600'}`}>Favorites only</button><button type="button" onClick={() => setFavoriteFilterMode(filterState.favoriteFilterMode === 'exclude' ? 'neutral' : 'exclude')} className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filterState.favoriteFilterMode === 'exclude' ? 'border-rose-500/60 bg-rose-500/15 text-rose-100' : 'border-gray-700 bg-gray-950/60 text-gray-300 hover:border-gray-600'}`}>Exclude favorites</button></div></div><div className="space-y-2">{analytics.curation.ratingDistribution.map((item) => item.key === 'unrated' ? <FacetButton key={item.key} label={item.label} meta={`${item.count} images`} count={item.count} maxCount={Math.max(...analytics.curation.ratingDistribution.map((entry) => entry.count), 1)} /> : <FacetButton key={item.key} label={item.label} meta={`${item.count} images`} count={item.count} maxCount={Math.max(...analytics.curation.ratingDistribution.map((entry) => entry.count), 1)} activeMode={filterState.selectedRatings.includes(Number(item.key) as (typeof ALL_RATINGS)[number]) ? 'include' : null} onClick={(event) => clickRating(Number(item.key), event)} />)}</div></section><div className="grid grid-cols-1 gap-6 xl:grid-cols-2">{resourceSection('Top Keeper Models', analytics.curation.keeperModels, 'model')}{resourceSection('Top Keeper LoRAs', analytics.curation.keeperLoras, 'lora')}</div></div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Analytics;

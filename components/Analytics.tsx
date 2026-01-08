import React, { useMemo, useState } from 'react';
import { X, TrendingUp, Calendar, Package, Layers, Clock, Zap, Cpu, Timer } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import InsightsBox from './InsightsBox';
import PeriodSelector, { PeriodPreset } from './PeriodSelector';
import {
  calculatePeriodStats,
  getUniquePeriodCount,
  calculateAverageSessionGap,
  generateTimelineComparison,
  calculateTopItems,
  analyzeCreationHabits,
  generateInsights,
  formatDuration,
  formatVariation,
  truncateName,
  periodPresetToDays,
  filterImagesByPeriod,
  getPeriodLabel,
  calculatePerformanceAverages,
  calculatePerformanceByGPU,
  calculateGenerationTimeDistribution,
  calculatePerformanceTimeline,
  formatGenerationTime,
} from '../utils/analyticsUtils';

interface AnalyticsProps {
  isOpen: boolean;
  onClose: () => void;
}

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#6366f1', '#f43f5e'];

const EmptyChart: React.FC<{ message?: string }> = ({ message = 'No data available for this period' }) => (
  <div className="w-full h-[300px] flex items-center justify-center">
    <p className="text-gray-500 text-sm">{message}</p>
  </div>
);

const Analytics: React.FC<AnalyticsProps> = ({ isOpen, onClose }) => {
  // Feature access safety check
  const { canUseAnalytics } = useFeatureAccess();

  const allImages = useImageStore((state) => state.images);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodPreset>('7days');
  const [telemetryPromoDismissed, setTelemetryPromoDismissed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('analytics-telemetry-promo-dismissed') === 'true';
    }
    return false;
  });

  const handleDismissTelemetryPromo = () => {
    setTelemetryPromoDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('analytics-telemetry-promo-dismissed', 'true');
    }
  };

  const analytics = useMemo(() => {
    // Short-circuit calculations when closed or feature not allowed
    if (!isOpen || !canUseAnalytics) {
      return null;
    }

    if (!allImages || allImages.length === 0) {
      return null;
    }

    // ========== FILTER IMAGES BY PERIOD ==========
    const daysBack = periodPresetToDays(selectedPeriod);
    const images = filterImagesByPeriod(allImages, daysBack);
    const periodLabel = getPeriodLabel(selectedPeriod);

    // ========== PERIOD STATS ==========
    const periodStats = daysBack ? calculatePeriodStats(allImages, daysBack) : {
      current: images.length,
      previous: 0,
      variation: 0,
      variationAbsolute: 0,
    };

    const uniqueModels = daysBack ? getUniquePeriodCount(allImages, 'models', daysBack) : new Set(images.flatMap(img => img.models || [])).size;
    const uniqueLoras = daysBack ? getUniquePeriodCount(allImages, 'loras', daysBack) : new Set(images.flatMap(img => img.loras || [])).size;
    const avgSessionGap = daysBack ? calculateAverageSessionGap(images) : calculateAverageSessionGap(allImages);

    // ========== GENERATOR DISTRIBUTION ==========
    const generatorCounts = new Map<string, number>();
    images.forEach((img) => {
      const generator = (img.metadata?.normalizedMetadata?.generator as string | undefined) || 'Unknown';
      generatorCounts.set(generator, (generatorCounts.get(generator) || 0) + 1);
    });

    const generatorData = Array.from(generatorCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // ========== TOP MODELS / LORAS / SAMPLERS (from filtered images) ==========
    const topModels = calculateTopItems(images, 'models', 10);
    const topLoras = calculateTopItems(images, 'loras', 10);
    const topSamplers = calculateTopItems(images, 'scheduler', 10);

    // ========== RESOLUTION DISTRIBUTION ==========
    const resolutions = new Map<string, number>();
    images.forEach((img) => {
      if (img.dimensions && img.dimensions !== '0x0') {
        resolutions.set(img.dimensions, (resolutions.get(img.dimensions) || 0) + 1);
      }
    });

    const resolutionData = Array.from(resolutions.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const topResolution = resolutionData.length > 0 ? resolutionData[0].name : undefined;

    // ========== TIMELINE WITH PERIOD COMPARISON ==========
    const timelineData = daysBack ? generateTimelineComparison(allImages, daysBack, 'day') : [];

    // ========== CREATION HABITS ==========
    const habits = analyzeCreationHabits(images);

    // ========== AUTO INSIGHTS ==========
    const insights = generateInsights(allImages, periodStats, topModels, topResolution, periodLabel, images.length);

    // ========== PERFORMANCE ANALYTICS ==========
    const performanceAverages = calculatePerformanceAverages(images);
    const performanceByGPU = calculatePerformanceByGPU(images);
    const generationTimeDistribution = calculateGenerationTimeDistribution(images);
    const performanceTimeline = calculatePerformanceTimeline(images, 'day');

    // ========== FIRST/LAST IMAGE DATES ==========
    let firstImageDate = Infinity;
    let lastImageDate = 0;
    images.forEach((img) => {
      if (img.lastModified) {
        if (img.lastModified < firstImageDate) firstImageDate = img.lastModified;
        if (img.lastModified > lastImageDate) lastImageDate = img.lastModified;
      }
    });

    return {
      // Period stats
      periodStats,
      uniqueModels,
      uniqueLoras,
      avgSessionGap,
      periodLabel,
      // Charts
      generatorData,
      topModels,
      topLoras,
      topSamplers,
      resolutionData,
      timelineData,
      habits,
      insights,
      // Performance
      performanceAverages,
      performanceByGPU,
      generationTimeDistribution,
      performanceTimeline,
      // Dates
      firstImageDate: firstImageDate !== Infinity ? new Date(firstImageDate).toLocaleDateString() : 'N/A',
      lastImageDate: lastImageDate !== 0 ? new Date(lastImageDate).toLocaleDateString() : 'N/A',
      totalImages: images.length,
      allImagesCount: allImages.length,
    };
  }, [allImages, canUseAnalytics, isOpen, selectedPeriod]);

  // Don't render anything if modal is closed
  if (!isOpen) {
    return null;
  }

  // Safety check: Don't render if feature is not available
  if (!canUseAnalytics) {
    console.warn('[IMH] Analytics accessed without permission');
    return null;
  }

  if (!analytics || analytics.allImagesCount === 0) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full mx-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gray-200">Analytics</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-gray-700 transition-colors"
              title="Close"
            >
              <X size={24} />
            </button>
          </div>
          <p className="text-gray-400 text-center">No images available for analytics. Add some folders to get started!</p>
        </div>
      </div>
    );
  }

  const hasData = analytics.totalImages > 0;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 overflow-y-auto">
      <div className="min-h-screen p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 mb-6 sticky top-4 z-10 shadow-lg border border-gray-700">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <TrendingUp size={32} className="text-blue-400" />
                <div>
                  <h2 className="text-3xl font-bold text-gray-200">Analytics Dashboard</h2>
                  <p className="text-sm text-gray-400 mt-1">Professional insights into your creative workflow</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-gray-700 transition-colors hover:shadow-lg hover:shadow-accent/30"
                title="Close Analytics"
              >
                <X size={24} />
              </button>
            </div>

            {/* Period Selector */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-700">
              <PeriodSelector selectedPeriod={selectedPeriod} onChange={setSelectedPeriod} />
              {!hasData && (
                <p className="text-sm text-orange-400">No images in selected period</p>
              )}
            </div>
          </div>

          {!hasData ? (
            <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-12 border border-gray-700 text-center">
              <p className="text-gray-400 text-lg">No images found in the selected period.</p>
              <p className="text-gray-500 text-sm mt-2">Try selecting a different time range.</p>
            </div>
          ) : (
            <>
              {/* Performance Analytics Promo (when no telemetry) */}
              {analytics.performanceAverages.imagesWithTelemetry === 0 && !telemetryPromoDismissed && (
                <div className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 backdrop-blur-sm rounded-lg p-5 border border-purple-500/30 mb-6 relative">
                  <button
                    onClick={handleDismissTelemetryPromo}
                    className="absolute top-3 right-3 p-1 rounded-full hover:bg-purple-700/30 transition-colors"
                    title="Dismiss"
                  >
                    <X size={18} className="text-gray-400 hover:text-gray-200" />
                  </button>
                  <div className="flex items-start gap-4 pr-8">
                    <div className="flex-shrink-0">
                      <Zap className="text-purple-400" size={28} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-gray-200 mb-1.5">
                        Unlock Performance Analytics
                      </h3>
                      <p className="text-gray-400 text-sm mb-3">
                        Track generation speed, VRAM usage, and performance metrics by using the{' '}
                        <span className="text-purple-300 font-semibold">MetaHub Save Node</span> for ComfyUI.
                        Get detailed insights like steps/second, GPU device info, and generation times.
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <a
                          href="https://registry.comfy.org/publishers/image-metahub/nodes/imagemetahub-comfyui-save"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-600/80 hover:bg-purple-600 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          <Package size={14} />
                          ComfyUI Registry
                        </a>
                        <a
                          href="https://github.com/LuqP2/ImageMetaHub-ComfyUI-Save"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-700/80 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                          </svg>
                          GitHub
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Insights Box */}
              <div className="mb-6">
                <InsightsBox insights={analytics.insights} />
              </div>

              {/* Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                  <div className="flex items-center gap-3 mb-2">
                    <Calendar className="text-blue-400" size={24} />
                    <h3 className="text-gray-400 text-sm font-medium">Period Activity</h3>
                  </div>
                  <p className="text-3xl font-bold text-gray-200">{analytics.periodStats.current.toLocaleString()}</p>
                  <p className={`text-sm mt-2 flex items-center gap-1 ${
                    analytics.periodStats.variation > 0 ? 'text-green-400' :
                    analytics.periodStats.variation < 0 ? 'text-red-400' : 'text-gray-400'
                  }`}>
                    {formatVariation(analytics.periodStats.variation)} vs previous period
                  </p>
                </div>

                <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                  <div className="flex items-center gap-3 mb-2">
                    <Package className="text-purple-400" size={24} />
                    <h3 className="text-gray-400 text-sm font-medium">Unique Models</h3>
                  </div>
                  <p className="text-3xl font-bold text-gray-200">{analytics.uniqueModels}</p>
                  <p className="text-sm text-gray-400 mt-2">Used in {analytics.periodLabel}</p>
                </div>

                <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                  <div className="flex items-center gap-3 mb-2">
                    <Layers className="text-pink-400" size={24} />
                    <h3 className="text-gray-400 text-sm font-medium">Unique LoRAs</h3>
                  </div>
                  <p className="text-3xl font-bold text-gray-200">{analytics.uniqueLoras}</p>
                  <p className="text-sm text-gray-400 mt-2">Used in {analytics.periodLabel}</p>
                </div>

                <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                  <div className="flex items-center gap-3 mb-2">
                    <Clock className="text-orange-400" size={24} />
                    <h3 className="text-gray-400 text-sm font-medium">Avg Session Gap</h3>
                  </div>
                  <p className="text-3xl font-bold text-gray-200">
                    {analytics.avgSessionGap > 0 ? formatDuration(analytics.avgSessionGap) : 'N/A'}
                  </p>
                  <p className="text-sm text-gray-400 mt-2">Time between sessions</p>
                </div>
              </div>

              {/* Performance Overview Cards */}
              {analytics.performanceAverages.imagesWithTelemetry > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <div className="flex items-center gap-3 mb-2">
                      <Zap className="text-yellow-400" size={24} />
                      <h3 className="text-gray-400 text-sm font-medium">Avg Speed</h3>
                    </div>
                    <p className="text-3xl font-bold text-gray-200">
                      {analytics.performanceAverages.avgStepsPerSecond > 0
                        ? `${analytics.performanceAverages.avgStepsPerSecond.toFixed(1)} it/s`
                        : 'N/A'}
                    </p>
                    <p className="text-sm text-gray-400 mt-2">Generation speed</p>
                  </div>

                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <div className="flex items-center gap-3 mb-2">
                      <Cpu className="text-cyan-400" size={24} />
                      <h3 className="text-gray-400 text-sm font-medium">Avg VRAM</h3>
                    </div>
                    <p className="text-3xl font-bold text-gray-200">
                      {analytics.performanceAverages.avgVramPeak > 0
                        ? `${(analytics.performanceAverages.avgVramPeak / 1024).toFixed(1)} GB`
                        : 'N/A'}
                    </p>
                    <p className="text-sm text-gray-400 mt-2">VRAM usage</p>
                  </div>

                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <div className="flex items-center gap-3 mb-2">
                      <Timer className="text-green-400" size={24} />
                      <h3 className="text-gray-400 text-sm font-medium">Avg Time</h3>
                    </div>
                    <p className="text-3xl font-bold text-gray-200">
                      {analytics.performanceAverages.avgGenerationTime > 0
                        ? formatGenerationTime(analytics.performanceAverages.avgGenerationTime)
                        : 'N/A'}
                    </p>
                    <p className="text-sm text-gray-400 mt-2">Per image</p>
                  </div>

                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <div className="flex items-center gap-3 mb-2">
                      <TrendingUp className="text-emerald-400" size={24} />
                      <h3 className="text-gray-400 text-sm font-medium">Telemetry Coverage</h3>
                    </div>
                    <p className="text-3xl font-bold text-gray-200">
                      {analytics.performanceAverages.telemetryPercentage.toFixed(0)}%
                    </p>
                    <p className="text-sm text-gray-400 mt-2">
                      {analytics.performanceAverages.imagesWithTelemetry} of {analytics.performanceAverages.totalImages} images
                    </p>
                  </div>
                </div>
              )}

              {/* Charts Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Timeline with Period Comparison */}
                {analytics.timelineData.length > 0 ? (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700 lg:col-span-2">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Activity Timeline (vs Previous Period)</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={analytics.timelineData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis
                          dataKey="period"
                          stroke="#9ca3af"
                          tick={{ fontSize: 12 }}
                          angle={-45}
                          textAnchor="end"
                          height={80}
                        />
                        <YAxis stroke="#9ca3af" />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                          labelStyle={{ color: '#e5e7eb' }}
                        />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="current"
                          stroke="#06b6d4"
                          fill="#06b6d4"
                          fillOpacity={0.6}
                          name="Current Period"
                        />
                        <Area
                          type="monotone"
                          dataKey="previous"
                          stroke="#9ca3af"
                          fill="#9ca3af"
                          fillOpacity={0.3}
                          strokeDasharray="5 5"
                          name="Previous Period"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : null}

                {/* Generator Distribution */}
                {analytics.generatorData.length > 0 ? (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Images by Generator</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={analytics.generatorData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis
                          dataKey="name"
                          stroke="#9ca3af"
                          tick={{ fontSize: 11 }}
                          angle={-45}
                          textAnchor="end"
                          height={100}
                        />
                        <YAxis stroke="#9ca3af" />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                          labelStyle={{ color: '#e5e7eb' }}
                        />
                        <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Images by Generator</h3>
                    <EmptyChart />
                  </div>
                )}

                {/* Top Models */}
                {analytics.topModels.length > 0 ? (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Top 10 Models</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart
                        data={analytics.topModels.map(m => ({
                          ...m,
                          shortName: truncateName(m.name, 15)
                        }))}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis
                          dataKey="shortName"
                          stroke="#9ca3af"
                          tick={{ fontSize: 11 }}
                          angle={-45}
                          textAnchor="end"
                          height={100}
                        />
                        <YAxis stroke="#9ca3af" />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                          labelStyle={{ color: '#e5e7eb' }}
                          formatter={(value, name, props) => {
                            if (name === 'total') {
                              return [value, props.payload.name];
                            }
                            return [value, name];
                          }}
                        />
                        <Bar dataKey="total" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Top 10 Models</h3>
                    <EmptyChart message="No models found in this period" />
                  </div>
                )}

                {/* Top LoRAs */}
                {analytics.topLoras.length > 0 ? (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Top 10 LoRAs</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart
                        data={analytics.topLoras.map(l => ({
                          ...l,
                          shortName: truncateName(l.name, 15)
                        }))}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis
                          dataKey="shortName"
                          stroke="#9ca3af"
                          tick={{ fontSize: 11 }}
                          angle={-45}
                          textAnchor="end"
                          height={100}
                        />
                        <YAxis stroke="#9ca3af" />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                          labelStyle={{ color: '#e5e7eb' }}
                          formatter={(value, name, props) => {
                            if (name === 'total') {
                              return [value, props.payload.name];
                            }
                            return [value, name];
                          }}
                        />
                        <Bar dataKey="total" fill="#ec4899" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Top 10 LoRAs</h3>
                    <EmptyChart message="No LoRAs found in this period" />
                  </div>
                )}

                {/* Top Samplers */}
                {analytics.topSamplers.length > 0 ? (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Top 10 Samplers</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart
                        data={analytics.topSamplers.map(s => ({
                          ...s,
                          shortName: truncateName(s.name, 15)
                        }))}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis
                          dataKey="shortName"
                          stroke="#9ca3af"
                          tick={{ fontSize: 11 }}
                          angle={-45}
                          textAnchor="end"
                          height={100}
                        />
                        <YAxis stroke="#9ca3af" />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                          labelStyle={{ color: '#e5e7eb' }}
                          formatter={(value, name, props) => {
                            if (name === 'total') {
                              return [value, props.payload.name];
                            }
                            return [value, name];
                          }}
                        />
                        <Bar dataKey="total" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Top 10 Samplers</h3>
                    <EmptyChart message="No samplers found in this period" />
                  </div>
                )}

                {/* Resolution Distribution */}
                {analytics.resolutionData.length > 0 ? (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Resolution Distribution</h3>
                    <div className="flex flex-col lg:flex-row items-center gap-6">
                      {/* Pie Chart */}
                      <div className="flex-shrink-0">
                        <ResponsiveContainer width={280} height={280}>
                          <PieChart>
                            <Pie
                              data={analytics.resolutionData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              outerRadius={90}
                              fill="#8884d8"
                              dataKey="value"
                            >
                              {analytics.resolutionData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                              labelStyle={{ color: '#e5e7eb' }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Percentage List */}
                      <div className="flex-1 w-full">
                        <div className="space-y-2">
                          {analytics.resolutionData.map((item, index) => {
                            const total = analytics.resolutionData.reduce((sum, d) => sum + d.value, 0);
                            const percentage = ((item.value / total) * 100).toFixed(1);
                            return (
                              <div
                                key={index}
                                className="flex items-center justify-between p-2 bg-gray-700/30 rounded hover:bg-gray-700/50 transition-colors"
                              >
                                <div className="flex items-center gap-3">
                                  <div
                                    className="w-4 h-4 rounded-sm flex-shrink-0"
                                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                  />
                                  <span className="text-gray-300 text-sm font-medium">{item.name}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-gray-400 text-sm">{item.value} images</span>
                                  <span className="text-gray-200 text-sm font-bold min-w-[3rem] text-right">
                                    {percentage}%
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Resolution Distribution</h3>
                    <EmptyChart message="No resolutions found in this period" />
                  </div>
                )}

                {/* Weekday Distribution */}
                {analytics.habits.weekdayDistribution.some(d => d.count > 0) ? (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Creation by Day of Week</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={analytics.habits.weekdayDistribution}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="day" stroke="#9ca3af" />
                        <YAxis stroke="#9ca3af" />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                          labelStyle={{ color: '#e5e7eb' }}
                        />
                        <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Creation by Day of Week</h3>
                    <EmptyChart />
                  </div>
                )}

                {/* Hourly Distribution */}
                {analytics.habits.hourlyDistribution.some(h => h.count > 0) ? (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Creation by Hour of Day</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={analytics.habits.hourlyDistribution}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis
                          dataKey="hour"
                          stroke="#9ca3af"
                          tickFormatter={(hour) => `${hour}:00`}
                        />
                        <YAxis stroke="#9ca3af" />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                          labelStyle={{ color: '#e5e7eb' }}
                          labelFormatter={(hour) => `${hour}:00`}
                        />
                        <Line
                          type="monotone"
                          dataKey="count"
                          stroke="#06b6d4"
                          strokeWidth={2}
                          dot={{ fill: '#06b6d4', r: 4 }}
                          activeDot={{ r: 6 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Creation by Hour of Day</h3>
                    <EmptyChart />
                  </div>
                )}

                {/* ========== PERFORMANCE CHARTS ========== */}

                {/* Generation Time Distribution */}
                {analytics.generationTimeDistribution.length > 0 && (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Generation Time Distribution</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={analytics.generationTimeDistribution}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="range" stroke="#9ca3af" tick={{ fontSize: 12 }} />
                        <YAxis stroke="#9ca3af" />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                          labelStyle={{ color: '#e5e7eb' }}
                        />
                        <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Performance by GPU */}
                {analytics.performanceByGPU.length > 0 && (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Performance by GPU Device</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={analytics.performanceByGPU}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis
                          dataKey="shortName"
                          stroke="#9ca3af"
                          tick={{ fontSize: 11 }}
                          angle={-45}
                          textAnchor="end"
                          height={100}
                        />
                        <YAxis yAxisId="left" stroke="#9ca3af" label={{ value: 'it/s', angle: -90, position: 'insideLeft' }} />
                        <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" label={{ value: 'GB', angle: 90, position: 'insideRight' }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                          labelStyle={{ color: '#e5e7eb' }}
                          formatter={(value: number, name: string, props: { payload: { name: string } }) => {
                            if (name === 'avgSpeed') return [value.toFixed(2), props.payload.name];
                            if (name === 'avgVram') return [value.toFixed(2), props.payload.name];
                            return [value, name];
                          }}
                        />
                        <Legend />
                        <Bar yAxisId="left" dataKey="avgSpeed" fill="#f59e0b" name="Avg Speed (it/s)" radius={[4, 4, 0, 0]} />
                        <Bar yAxisId="right" dataKey="avgVram" fill="#06b6d4" name="Avg VRAM (GB)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Performance Timeline */}
                {analytics.performanceTimeline.length > 0 && (
                  <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700 lg:col-span-2">
                    <h3 className="text-xl font-bold text-gray-200 mb-4">Performance Over Time</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={analytics.performanceTimeline}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis
                          dataKey="date"
                          stroke="#9ca3af"
                          tick={{ fontSize: 11 }}
                          angle={-45}
                          textAnchor="end"
                          height={80}
                        />
                        <YAxis yAxisId="left" stroke="#9ca3af" label={{ value: 'it/s', angle: -90, position: 'insideLeft' }} />
                        <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" label={{ value: 'GB', angle: 90, position: 'insideRight' }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                          labelStyle={{ color: '#e5e7eb' }}
                          formatter={(value: number) => value.toFixed(2)}
                        />
                        <Legend />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="avgSpeed"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          name="Avg Speed (it/s)"
                          dot={{ fill: '#f59e0b', r: 4 }}
                          activeDot={{ r: 6 }}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="avgVram"
                          stroke="#06b6d4"
                          strokeWidth={2}
                          name="Avg VRAM (GB)"
                          dot={{ fill: '#06b6d4', r: 4 }}
                          activeDot={{ r: 6 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Footer Stats */}
              <div className="mt-6 bg-gray-800/80 backdrop-blur-sm rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between text-sm text-gray-400 flex-wrap gap-2">
                  <span>Showing: {analytics.totalImages.toLocaleString()} images</span>
                  <span>Library total: {analytics.allImagesCount.toLocaleString()} images</span>
                  <span>First: {analytics.firstImageDate}</span>
                  <span>Latest: {analytics.lastImageDate}</span>
                </div>
                {analytics.performanceAverages.imagesWithTelemetry === 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-700/50 text-xs text-gray-500 text-center">
                    Want performance analytics? Try{' '}
                    <a
                      href="https://registry.comfy.org/publishers/image-metahub/nodes/imagemetahub-comfyui-save"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-purple-400 hover:text-purple-300 underline transition-colors"
                    >
                      MetaHub Save Node
                    </a>
                    {' '}(
                    <a
                      href="https://github.com/LuqP2/ImageMetaHub-ComfyUI-Save"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-gray-300 underline transition-colors"
                    >
                      GitHub
                    </a>
                    )
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Analytics;

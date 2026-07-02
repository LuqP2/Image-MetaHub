import { IndexedImage } from '../types';
import { DATE_PADDING, formatLocalDateKey, formatLocalMonthKey } from './dateFilterUtils';
import { getImageAnalytics } from './imageMetadata';

export type PeriodPreset = '7days' | '30days' | '90days' | 'thisMonth' | 'all';

export interface PeriodStats {
  current: number;
  previous: number;
  variation: number; // percentage
  variationAbsolute: number;
}

export interface TimelineData {
  period: string;
  current: number;
  previous: number;
}

export interface TopItemStats {
  name: string;
  total: number;
  favorites: number;
  keeperRate: number; // percentage of favorites
  averageRating: number;
  ratingCount: number;
}

export interface CreationHabits {
  weekdayDistribution: { day: string; count: number }[];
  hourlyDistribution: { hour: number; count: number }[];
}

const normalizeItemName = (item: unknown): string | null => {
  if (item === null || item === undefined) {
    return null;
  }

  if (typeof item === 'string') {
    const trimmed = item.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof item === 'number') {
    return String(item);
  }

  if (typeof item === 'object' && 'name' in (item as Record<string, unknown>)) {
    const possibleName = (item as Record<string, unknown>).name;
    if (typeof possibleName === 'string') {
      const trimmed = possibleName.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }

  return null;
};

/**
 * Convert period preset to days back number
 */
export function periodPresetToDays(preset: PeriodPreset): number | null {
  switch (preset) {
    case '7days':
      return 7;
    case '30days':
      return 30;
    case '90days':
      return 90;
    case 'thisMonth': {
      // Calculate days from start of current month
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return Math.ceil((now.getTime() - startOfMonth.getTime()) / (24 * 60 * 60 * 1000));
    }
    case 'all':
      return null; // null means no filter
    default:
      return 30;
  }
}

/**
 * Filter images by period
 */
export function filterImagesByPeriod(
  images: IndexedImage[],
  daysBack: number | null
): IndexedImage[] {
  if (daysBack === null) {
    return images; // Return all images
  }

  const now = Date.now();
  const periodStart = now - daysBack * 24 * 60 * 60 * 1000;

  return images.filter((img) => img.lastModified >= periodStart);
}

/**
 * Get period label for display
 */
export function getPeriodLabel(preset: PeriodPreset): string {
  switch (preset) {
    case '7days':
      return 'last 7 days';
    case '30days':
      return 'last 30 days';
    case '90days':
      return 'last 90 days';
    case 'thisMonth':
      return 'this month';
    case 'all':
      return 'all time';
    default:
      return 'selected period';
  }
}

/**
 * Calculate statistics for a given period with comparison to previous period
 */
export function calculatePeriodStats(
  images: IndexedImage[],
  daysBack: number = 30
): PeriodStats {
  const now = Date.now();
  const periodMs = daysBack * 24 * 60 * 60 * 1000;
  const currentPeriodStart = now - periodMs;
  const previousPeriodStart = currentPeriodStart - periodMs;

  let currentCount = 0;
  let previousCount = 0;

  // Optimization: Single-pass loop to calculate counts for both periods,
  // avoiding multiple O(N) filter passes and intermediate array allocations.
  for (let i = 0; i < images.length; i++) {
    const lastModified = images[i].lastModified;
    if (lastModified >= currentPeriodStart) {
      currentCount++;
    } else if (lastModified >= previousPeriodStart) {
      previousCount++;
    }
  }

  const variationAbsolute = currentCount - previousCount;
  const variation =
    previousCount > 0 ? (variationAbsolute / previousCount) * 100 : 100;

  return {
    current: currentCount,
    previous: previousCount,
    variation,
    variationAbsolute,
  };
}

/**
 * Get unique count of items in a period
 */
export function getUniquePeriodCount(
  images: IndexedImage[],
  field: 'models' | 'loras',
  daysBack: number = 30
): number {
  const now = Date.now();
  const periodStart = now - daysBack * 24 * 60 * 60 * 1000;

  const uniqueItems = new Set<string>();
  images
    .filter((img) => img.lastModified >= periodStart)
    .forEach((img) => {
      const items = Array.isArray(img[field]) ? img[field] : [img[field]];
      items.forEach((item) => {
        const normalizedItem = normalizeItemName(item);
        if (normalizedItem) uniqueItems.add(normalizedItem);
      });
    });

  return uniqueItems.size;
}

/**
 * Calculate average time between creation sessions
 */
export function calculateAverageSessionGap(images: IndexedImage[]): number {
  if (images.length < 2) return 0;

  // Sort by date
  const sorted = [...images].sort((a, b) => a.lastModified - b.lastModified);

  // Group images into sessions (images within 1 hour are same session)
  const SESSION_GAP_MS = 60 * 60 * 1000; // 1 hour
  const sessionStarts: number[] = [];
  let currentSessionStart = sorted[0].lastModified;
  sessionStarts.push(currentSessionStart);

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].lastModified - sorted[i - 1].lastModified;
    if (gap > SESSION_GAP_MS) {
      currentSessionStart = sorted[i].lastModified;
      sessionStarts.push(currentSessionStart);
    }
  }

  if (sessionStarts.length < 2) return 0;

  // Calculate average gap between sessions
  let totalGap = 0;
  for (let i = 1; i < sessionStarts.length; i++) {
    totalGap += sessionStarts[i] - sessionStarts[i - 1];
  }

  return totalGap / (sessionStarts.length - 1);
}

/**
 * Generate timeline data with current and previous period comparison
 */
export function generateTimelineComparison(
  images: IndexedImage[],
  daysBack: number = 30,
  groupBy: 'day' | 'week' | 'month' = 'day'
): TimelineData[] {
  const now = Date.now();
  const periodMs = daysBack * 24 * 60 * 60 * 1000;
  const currentPeriodStart = now - periodMs;
  const previousPeriodStart = currentPeriodStart - periodMs;

  const currentData = new Map<string, number>();
  const previousData = new Map<string, number>();
  const date = new Date();

  // Optimization: Standard for loop and Date reuse to minimize allocations.
  // Impact: Reduces GC pressure by avoiding N Date object creations.
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    date.setTime(img.lastModified);
    let key: string;

    if (groupBy === 'day') {
      key = formatLocalDateKey(date);
    } else if (groupBy === 'week') {
      const weekNum = getWeekNumber(date);
      // Optimization: Using pre-allocated DATE_PADDING for week number formatting.
      key = `${date.getFullYear()}-W${DATE_PADDING[weekNum] || String(weekNum).padStart(2, '0')}`;
    } else {
      // month
      key = formatLocalMonthKey(date);
    }

    if (img.lastModified >= currentPeriodStart) {
      currentData.set(key, (currentData.get(key) || 0) + 1);
    } else if (img.lastModified >= previousPeriodStart) {
      previousData.set(key, (previousData.get(key) || 0) + 1);
    }
  }

  // Merge and align periods
  const allKeys = new Set([...currentData.keys(), ...previousData.keys()]);
  const result: TimelineData[] = Array.from(allKeys)
    .sort()
    .map((period) => ({
      period,
      current: currentData.get(period) || 0,
      previous: previousData.get(period) || 0,
    }));

  return result;
}

/**
 * Calculate top items with keeper rate
 */
export function calculateTopItems(
  images: IndexedImage[],
  field: 'models' | 'loras' | 'scheduler',
  limit: number = 10
): TopItemStats[] {
  const itemStats = new Map<string, { total: number; favorites: number; ratingTotal: number; ratingCount: number }>();

  // Optimization: Standard for loop to avoid callback overhead in hot paths.
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const isFavorite = img.isFavorite === true;
    const rating = img.rating;

    if (field === 'scheduler') {
      const scheduler = normalizeItemName(img.scheduler);
      if (scheduler) {
        const stats = itemStats.get(scheduler) || { total: 0, favorites: 0, ratingTotal: 0, ratingCount: 0 };
        stats.total++;
        if (isFavorite) stats.favorites++;
        if (typeof rating === 'number') {
          stats.ratingTotal += rating;
          stats.ratingCount++;
        }
        itemStats.set(scheduler, stats);
      }
    } else {
      const items = Array.isArray(img[field]) ? img[field] : [img[field]];
      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        const normalizedItem = normalizeItemName(item);
        if (normalizedItem) {
          const stats = itemStats.get(normalizedItem) || { total: 0, favorites: 0, ratingTotal: 0, ratingCount: 0 };
          stats.total++;
          if (isFavorite) stats.favorites++;
          if (typeof rating === 'number') {
            stats.ratingTotal += rating;
            stats.ratingCount++;
          }
          itemStats.set(normalizedItem, stats);
        }
      }
    }
  }

  return Array.from(itemStats.entries())
    .map(([name, stats]) => ({
      name,
      total: stats.total,
      favorites: stats.favorites,
      keeperRate: stats.total > 0 ? (stats.favorites / stats.total) * 100 : 0,
      averageRating: stats.ratingCount > 0 ? stats.ratingTotal / stats.ratingCount : 0,
      ratingCount: stats.ratingCount,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * Analyze creation habits
 */
export function analyzeCreationHabits(images: IndexedImage[]): CreationHabits {
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekdayCounts = new Uint32Array(7);
  const hourlyCounts = new Uint32Array(24);
  const date = new Date();

  // Optimization: Standard for loop and Date reuse to minimize allocations.
  // Impact: Reduces GC pressure by avoiding N Date object creations and Map lookups.
  for (let i = 0; i < images.length; i++) {
    date.setTime(images[i].lastModified);
    weekdayCounts[date.getDay()]++;
    hourlyCounts[date.getHours()]++;
  }

  const weekdayDistribution = new Array(7);
  for (let i = 0; i < 7; i++) {
    weekdayDistribution[i] = {
      day: weekdays[i],
      count: weekdayCounts[i],
    };
  }

  const hourlyDistribution = new Array(24);
  for (let i = 0; i < 24; i++) {
    hourlyDistribution[i] = {
      hour: i,
      count: hourlyCounts[i],
    };
  }

  return { weekdayDistribution, hourlyDistribution };
}

/**
 * Generate automatic insights from data
 */
export interface AutoInsight {
  icon: string;
  text: string;
  trend?: 'up' | 'down' | 'neutral';
}

export function generateInsights(
  images: IndexedImage[],
  periodStats: PeriodStats,
  topModels: TopItemStats[],
  topResolution?: string,
  periodLabel: string = 'last 30 days',
  totalImages: number = 0
): AutoInsight[] {
  const insights: AutoInsight[] = [];

  // Insight 1: Period activity
  if (periodStats.current > 0) {
    const trend =
      periodStats.variation > 0 ? 'up' : periodStats.variation < 0 ? 'down' : 'neutral';
    const changeText =
      periodStats.variation > 0
        ? `${Math.abs(periodStats.variation).toFixed(0)}% increase`
        : periodStats.variation < 0
        ? `${Math.abs(periodStats.variation).toFixed(0)}% decrease`
        : 'no change';

    insights.push({
      icon: '📊',
      text: `Created ${periodStats.current} images in the ${periodLabel} (${changeText} from previous period)`,
      trend,
    });
  }

  // Insight 2: Most used model
  if (topModels.length > 0) {
    const topModel = topModels[0];
    const percentage = totalImages > 0 ? ((topModel.total / totalImages) * 100).toFixed(0) : '0';
    insights.push({
      icon: '🎨',
      text: `${truncateName(topModel.name, 30)} is your go-to model (${percentage}% of period images)`,
    });
  }

  // Insight 3: Best keeper rate
  // const bestKeeper = topModels.find((m) => m.favorites > 0 && m.keeperRate > 0);
  // if (bestKeeper) {
  //   insights.push({
  //     icon: '⭐',
  //     text: `${truncateName(bestKeeper.name, 30)} has the best keeper rate (${bestKeeper.keeperRate.toFixed(0)}%)`,
  //     trend: 'up',
  //   });
  // }

  // Insight 4: Most common resolution
  if (topResolution && topResolution !== '0x0') {
    insights.push({
      icon: '📐',
      text: `${topResolution} is your most used resolution`,
    });
  }

  // Insight 5: Total library size (only if period is filtered)
  if (totalImages < images.length) {
    insights.push({
      icon: '🗂️',
      text: `Showing ${totalImages.toLocaleString()} of ${images.length.toLocaleString()} total images`,
    });
  } else {
    insights.push({
      icon: '🗂️',
      text: `Your library contains ${images.length.toLocaleString()} total images`,
    });
  }

  return insights;
}

/**
 * Truncate long names for display
 */
export function truncateName(name: unknown, maxLength: number): string {
  const safeMaxLength = Math.max(0, maxLength);
  const safeName = typeof name === 'string'
    ? name
    : name === null || name === undefined
    ? ''
    : String(name);

  if (safeName.length <= safeMaxLength) {
    return safeName;
  }

  if (safeMaxLength <= 3) {
    return safeName.substring(0, safeMaxLength);
  }

  return safeName.substring(0, safeMaxLength - 3) + '...';
}

/**
 * Format milliseconds to human readable duration
 */
export function formatDuration(ms: number): string {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h`;
  } else {
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    return `${minutes}m`;
  }
}

/**
 * Get week number for a date
 */
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Format variation percentage with sign
 */
export function formatVariation(variation: number): string {
  if (variation > 0) return `+${variation.toFixed(0)}%`;
  if (variation < 0) return `${variation.toFixed(0)}%`;
  return '0%';
}

// ========== PERFORMANCE ANALYTICS ==========

export interface PerformanceAverages {
  avgStepsPerSecond: number;
  avgVramPeak: number; // in MB
  avgGenerationTime: number; // in MS
  imagesWithTelemetry: number;
  totalImages: number;
  telemetryPercentage: number;
}

export interface GPUPerformanceStats {
  name: string;
  shortName: string;
  avgSpeed: number; // steps/s
  avgVram: number; // GB
  avgTime: number; // seconds
  count: number;
}

export interface GenerationTimeBucket {
  range: string;
  min: number;
  max: number;
  count: number;
}

export interface PerformanceTimelinePoint {
  date: string;
  avgSpeed: number;
  avgVram: number; // GB
  avgTime: number; // seconds
  count: number;
}

/**
 * Calculate average performance metrics across images
 */
export function calculatePerformanceAverages(images: IndexedImage[]): PerformanceAverages {
  let totalSpeed = 0;
  let totalVram = 0;
  let totalTime = 0;
  let speedCount = 0;
  let vramCount = 0;
  let timeCount = 0;
  let imagesWithTelemetry = 0;

  // Optimization: Single-pass O(N) loop to calculate all performance metrics.
  // Impact: Eliminates redundant O(N) traversal and intermediate array allocation from .filter().
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const analytics = getImageAnalytics(img);

    if (analytics) {
      let hasAnyTelemetry = false;

      if (typeof analytics.steps_per_second === 'number' && analytics.steps_per_second > 0) {
        totalSpeed += analytics.steps_per_second;
        speedCount++;
        hasAnyTelemetry = true;
      }
      if (typeof analytics.vram_peak_mb === 'number' && analytics.vram_peak_mb > 0) {
        totalVram += analytics.vram_peak_mb;
        vramCount++;
        hasAnyTelemetry = true;
      }
      if (typeof analytics.generation_time_ms === 'number' && analytics.generation_time_ms > 0) {
        totalTime += analytics.generation_time_ms;
        timeCount++;
        hasAnyTelemetry = true;
      }
      if (!hasAnyTelemetry && typeof analytics.gpu_device === 'string' && analytics.gpu_device.trim().length > 0) {
        hasAnyTelemetry = true;
      }

      if (hasAnyTelemetry) {
        imagesWithTelemetry++;
      }
    }
  }

  return {
    avgStepsPerSecond: speedCount > 0 ? totalSpeed / speedCount : 0,
    avgVramPeak: vramCount > 0 ? totalVram / vramCount : 0,
    avgGenerationTime: timeCount > 0 ? totalTime / timeCount : 0,
    imagesWithTelemetry,
    totalImages: images.length,
    telemetryPercentage: images.length > 0 ? (imagesWithTelemetry / images.length) * 100 : 0,
  };
}

/**
 * Calculate performance metrics grouped by GPU device
 */
export function calculatePerformanceByGPU(images: IndexedImage[]): GPUPerformanceStats[] {
  const gpuStats = new Map<string, {
    totalTime: number;
    totalSpeed: number;
    totalVram: number;
    speedCount: number;
    vramCount: number;
    timeCount: number;
  }>();

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const analytics = getImageAnalytics(img);

    if (analytics?.gpu_device && typeof analytics.gpu_device === 'string') {
      const gpuName = analytics.gpu_device;
      const stats = gpuStats.get(gpuName) || {
        totalTime: 0,
        totalSpeed: 0,
        totalVram: 0,
        speedCount: 0,
        vramCount: 0,
        timeCount: 0,
      };

      if (typeof analytics.generation_time_ms === 'number' && analytics.generation_time_ms > 0) {
        stats.totalTime += analytics.generation_time_ms;
        stats.timeCount++;
      }
      if (typeof analytics.steps_per_second === 'number' && analytics.steps_per_second > 0) {
        stats.totalSpeed += analytics.steps_per_second;
        stats.speedCount++;
      }
      if (typeof analytics.vram_peak_mb === 'number' && analytics.vram_peak_mb > 0) {
        stats.totalVram += analytics.vram_peak_mb;
        stats.vramCount++;
      }

      gpuStats.set(gpuName, stats);
    }
  }

  const result: GPUPerformanceStats[] = [];
  for (const [gpu, stats] of gpuStats.entries()) {
    const count = Math.max(stats.speedCount, stats.vramCount, stats.timeCount);
    result.push({
      name: gpu,
      shortName: truncateName(gpu, 25),
      avgSpeed: stats.speedCount > 0 ? stats.totalSpeed / stats.speedCount : 0,
      avgVram: stats.vramCount > 0 ? stats.totalVram / stats.vramCount / 1024 : 0, // Convert to GB
      avgTime: stats.timeCount > 0 ? stats.totalTime / stats.timeCount / 1000 : 0, // Convert to seconds
      count,
    });
  }

  return result.sort((a, b) => b.count - a.count);
}

/**
 * Calculate distribution of generation times into buckets
 */
export function calculateGenerationTimeDistribution(images: IndexedImage[]): GenerationTimeBucket[] {
  const buckets: GenerationTimeBucket[] = [
    { range: '< 1s', min: 0, max: 1000, count: 0 },
    { range: '1-5s', min: 1000, max: 5000, count: 0 },
    { range: '5-10s', min: 5000, max: 10000, count: 0 },
    { range: '10-30s', min: 10000, max: 30000, count: 0 },
    { range: '30s-1m', min: 30000, max: 60000, count: 0 },
    { range: '1-2m', min: 60000, max: 120000, count: 0 },
    { range: '> 2m', min: 120000, max: Infinity, count: 0 },
  ];

  // Optimization: Standard for loop to avoid callback overhead.
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const analytics = getImageAnalytics(img);

    if (analytics?.generation_time_ms && typeof analytics.generation_time_ms === 'number') {
      const genTime = analytics.generation_time_ms;
      // Optimization: Efficient bucket find logic using standard for loop
      for (let j = 0; j < buckets.length; j++) {
        const b = buckets[j];
        if (genTime >= b.min && genTime < b.max) {
          b.count++;
          break;
        }
      }
    }
  }

  return buckets.filter(b => b.count > 0);
}

/**
 * Calculate performance metrics over time (timeline)
 */
export function calculatePerformanceTimeline(
  images: IndexedImage[],
  groupBy: 'day' | 'week' | 'month' = 'day'
): PerformanceTimelinePoint[] {
  const timelineMap = new Map<string, {
    totalSpeed: number;
    totalVram: number;
    totalTime: number;
    speedCount: number;
    vramCount: number;
    timeCount: number;
  }>();

  const date = new Date();

  // Optimization: Standard for loop and Date reuse to minimize allocations.
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img.lastModified) continue;

    date.setTime(img.lastModified);
    let key: string;

    if (groupBy === 'day') {
      key = formatLocalDateKey(date);
    } else if (groupBy === 'week') {
      const weekNum = getWeekNumber(date);
      // Optimization: Using pre-allocated DATE_PADDING for week number formatting.
      key = `${date.getFullYear()}-W${DATE_PADDING[weekNum] || String(weekNum).padStart(2, '0')}`;
    } else {
      key = formatLocalMonthKey(date);
    }

    const analytics = getImageAnalytics(img);

    if (analytics) {
      const entry = timelineMap.get(key) || {
        totalSpeed: 0,
        totalVram: 0,
        totalTime: 0,
        speedCount: 0,
        vramCount: 0,
        timeCount: 0,
      };

      if (typeof analytics.steps_per_second === 'number' && analytics.steps_per_second > 0) {
        entry.totalSpeed += analytics.steps_per_second;
        entry.speedCount++;
      }
      if (typeof analytics.vram_peak_mb === 'number' && analytics.vram_peak_mb > 0) {
        entry.totalVram += analytics.vram_peak_mb;
        entry.vramCount++;
      }
      if (typeof analytics.generation_time_ms === 'number' && analytics.generation_time_ms > 0) {
        entry.totalTime += analytics.generation_time_ms;
        entry.timeCount++;
      }

      timelineMap.set(key, entry);
    }
  }

  return Array.from(timelineMap.entries())
    .map(([date, stats]) => {
      const count = Math.max(stats.speedCount, stats.vramCount, stats.timeCount);
      return {
        date,
        avgSpeed: stats.speedCount > 0 ? stats.totalSpeed / stats.speedCount : 0,
        avgVram: stats.vramCount > 0 ? stats.totalVram / stats.vramCount / 1024 : 0, // Convert to GB
        avgTime: stats.timeCount > 0 ? stats.totalTime / stats.timeCount / 1000 : 0, // Convert to seconds
        count,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Format generation time in milliseconds to human readable
 */
export function formatGenerationTime(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format VRAM in MB with optional GPU device context
 */
export function formatVRAM(vramMb: number, gpuDevice?: string | null): string {
  const vramGb = vramMb / 1024;

  // Known GPU VRAM mappings
  const gpuVramMap: Record<string, number> = {
    '4090': 24, '3090': 24, '3080': 10, '3070': 8, '3060': 12, '3060 Ti': 8,
    'A100': 40, 'A6000': 48, 'V100': 16, 'A4000': 16,
    '4080': 16, '4070': 12, '4060': 8,
  };

  let totalVramGb: number | null = null;
  if (gpuDevice) {
    for (const [model, vram] of Object.entries(gpuVramMap)) {
      if (gpuDevice.includes(model)) {
        totalVramGb = vram;
        break;
      }
    }
  }

  if (totalVramGb !== null && vramGb <= totalVramGb) {
    const percentage = ((vramGb / totalVramGb) * 100).toFixed(0);
    return `${vramGb.toFixed(1)} GB / ${totalVramGb} GB (${percentage}%)`;
  }

  return `${vramGb.toFixed(1)} GB`;
}

export type AnalyticsScopeMode = 'context' | 'library';
export type AnalyticsCompareDimension = 'generator' | 'model' | 'lora' | 'sampler' | 'scheduler' | 'gpu' | 'rating' | 'telemetry';

export interface AnalyticsFacetItem {
  key: string;
  label: string;
  count: number;
  share: number;
  favorites: number;
  keeperRate: number;
  averageRating: number;
  ratingCount: number;
}

export interface AnalyticsTimelinePoint {
  key: string;
  label: string;
  count: number;
}

export interface AnalyticsSession {
  id: string;
  label: string;
  start: number;
  end: number;
  count: number;
  imageIds: string[];
  dominantModel?: string;
}

export interface AnalyticsNumericBucket {
  key: string;
  label: string;
  count: number;
  min?: number;
  max?: number;
}

export interface AnalyticsCompareConfig {
  dimension: AnalyticsCompareDimension;
  leftKey: string;
  rightKey: string;
}

export interface AnalyticsCompareCohort {
  key: string;
  label: string;
  count: number;
  favoriteRate: number;
  averageRating: number;
  telemetryCoverage: number;
  dominantModel?: string;
}

export interface AnalyticsExplorerData {
  scopeMode: AnalyticsScopeMode;
  totalImages: number;
  allImagesCount: number;
  dominantModel?: string;
  dominantGenerator?: string;
  telemetryCoverage: number;
  periodStats: PeriodStats;
  insights: AutoInsight[];
  samples: IndexedImage[];
  resources: {
    generators: AnalyticsFacetItem[];
    models: AnalyticsFacetItem[];
    loras: AnalyticsFacetItem[];
    samplers: AnalyticsFacetItem[];
    schedulers: AnalyticsFacetItem[];
  };
  time: {
    timeline: AnalyticsTimelinePoint[];
    weekday: { key: string; label: string; count: number }[];
    hourly: { key: string; label: string; count: number }[];
    sessions: AnalyticsSession[];
  };
  performance: {
    averages: PerformanceAverages;
    byGPU: GPUPerformanceStats[];
    generationTime: AnalyticsNumericBucket[];
    speed: AnalyticsNumericBucket[];
    vram: AnalyticsNumericBucket[];
  };
  curation: {
    favoritesCount: number;
    favoriteRate: number;
    unratedCount: number;
    ratingDistribution: AnalyticsFacetItem[];
    keeperModels: AnalyticsFacetItem[];
    keeperLoras: AnalyticsFacetItem[];
  };
  compare?: {
    dimension: AnalyticsCompareDimension;
    left: AnalyticsCompareCohort;
    right: AnalyticsCompareCohort;
  };
}

const SESSION_GAP_MS = 60 * 60 * 1000;
const RATING_VALUES = [1, 2, 3, 4, 5] as const;

export const getImageGenerator = (image: IndexedImage): string => {
  const generator = image.metadata?.normalizedMetadata?.generator;
  return typeof generator === 'string' && generator.trim().length > 0 ? generator : 'Unknown';
};

export const getImageGpuDevice = (image: IndexedImage): string | null => {
  const gpuDevice = getImageAnalytics(image)?.gpu_device;
  return typeof gpuDevice === 'string' && gpuDevice.trim().length > 0 ? gpuDevice : null;
};

// Optimization: Avoid chained array methods (.map().filter()) to reduce garbage collection overhead
// Impact: Eliminates creation of intermediate arrays during hot path metadata extraction
const getImageLoraNames = (image: IndexedImage): string[] => {
  if (!image.loras) return [];
  const result: string[] = [];
  for (let i = 0; i < image.loras.length; i++) {
    const lora = image.loras[i];
    const name = typeof lora === 'string' ? lora : lora?.name;
    if (typeof name === 'string' && name.trim().length > 0) {
      result.push(name);
    }
  }
  return result;
};

export const hasTelemetryData = (image: IndexedImage): boolean => {
  const analytics = getImageAnalytics(image);
  return Boolean(
    analytics &&
    (
      typeof analytics.generation_time_ms === 'number' ||
      typeof analytics.steps_per_second === 'number' ||
      typeof analytics.vram_peak_mb === 'number' ||
      typeof analytics.gpu_device === 'string'
    )
  );
};

// Optimization: Avoid chained array methods (.map().filter()) when populating Sets
// Impact: Eliminates creation of intermediate arrays during hot path facet collection
const collectFacetItems = (
  images: IndexedImage[],
  getKeys: (image: IndexedImage) => string[],
  limit = 12
): AnalyticsFacetItem[] => {
  const stats = new Map<string, { count: number; favorites: number; ratingTotal: number; ratingCount: number }>();
  const uniqueKeys = new Set<string>();

  // Optimization: Standard for loop and Set reuse to minimize allocations in hot paths.
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const rawKeys = getKeys(image);
    uniqueKeys.clear();

    for (let j = 0; j < rawKeys.length; j++) {
      const normalized = normalizeItemName(rawKeys[j]);
      if (normalized) {
        uniqueKeys.add(normalized);
      }
    }

    for (const key of uniqueKeys) {
      const entry = stats.get(key) || { count: 0, favorites: 0, ratingTotal: 0, ratingCount: 0 };
      entry.count += 1;
      if (image.isFavorite) {
        entry.favorites += 1;
      }
      if (typeof image.rating === 'number') {
        entry.ratingTotal += image.rating;
        entry.ratingCount += 1;
      }
      stats.set(key, entry);
    }
  }

  const totalImages = images.length || 1;
  const result: AnalyticsFacetItem[] = [];

  for (const [key, value] of stats.entries()) {
    result.push({
      key,
      label: key,
      count: value.count,
      share: value.count / totalImages,
      favorites: value.favorites,
      keeperRate: value.count > 0 ? value.favorites / value.count : 0,
      averageRating: value.ratingCount > 0 ? value.ratingTotal / value.ratingCount : 0,
      ratingCount: value.ratingCount,
    });
  }

  return result
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
};

const buildTimelinePoints = (images: IndexedImage[]): AnalyticsTimelinePoint[] => {
  const counts = new Map<string, number>();
  const date = new Date();

  // Optimization: Standard for loop and Date reuse to minimize allocations.
  for (let i = 0; i < images.length; i++) {
    date.setTime(images[i].lastModified);
    const key = formatLocalDateKey(date);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const result: AnalyticsTimelinePoint[] = [];
  for (const [key, count] of counts.entries()) {
    result.push({ key, label: key, count });
  }

  return result.sort((a, b) => a.key.localeCompare(b.key));
};

const buildSessions = (images: IndexedImage[], limit = 8, isSorted = false): AnalyticsSession[] => {
  if (images.length === 0) {
    return [];
  }

  const sorted = isSorted ? images : [...images].sort((a, b) => a.lastModified - b.lastModified);
  const sessions: IndexedImage[][] = [];
  let currentSession: IndexedImage[] = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const currentImage = sorted[index];
    const previousImage = sorted[index - 1];

    if (currentImage.lastModified - previousImage.lastModified > SESSION_GAP_MS) {
      sessions.push(currentSession);
      currentSession = [currentImage];
      continue;
    }

    currentSession.push(currentImage);
  }

  sessions.push(currentSession);

  // Optimization: Reverse and slice before mapping to expensive derived objects
  // Impact: Reduces CPU and memory usage for large image sets with many sessions
  return sessions
    .reverse()
    .slice(0, limit)
    .map((session, index) => {
      const start = session[0].lastModified;
      const end = session[session.length - 1].lastModified;
      const dominantModel = collectFacetItems(session, (image) => image.models || [], 1)[0]?.label;

      return {
        id: `session-${sessions.length - 1 - index}-${start}`,
        label: `${new Date(start).toLocaleDateString()} ${new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        start,
        end,
        count: session.length,
        imageIds: session.map((image) => image.id),
        dominantModel,
      };
    });
};

const buildNumericBuckets = (
  images: IndexedImage[],
  labelFactory: (entry: { min?: number; max?: number }) => string,
  selector: (image: IndexedImage) => number | null,
  ranges: Array<{ key: string; min?: number; max?: number }>
): AnalyticsNumericBucket[] => {
  // Optimization: Consolidate multiple filter passes into a single O(N) pass.
  // Impact: Reduces full array traversals from K (number of ranges) to 1.
  const counts = new Array(ranges.length).fill(0);

  for (let i = 0; i < images.length; i++) {
    const value = selector(images[i]);
    if (value === null) {
      continue;
    }

    for (let j = 0; j < ranges.length; j++) {
      const range = ranges[j];
      if (
        (range.min === undefined || value >= range.min) &&
        (range.max === undefined || value < range.max)
      ) {
        counts[j]++;
      }
    }
  }

  const buckets: AnalyticsNumericBucket[] = [];
  for (let j = 0; j < ranges.length; j++) {
    const count = counts[j];
    if (count > 0) {
      const range = ranges[j];
      buckets.push({
        key: range.key,
        label: labelFactory(range),
        count,
        min: range.min,
        max: range.max,
      });
    }
  }

  return buckets;
};

const buildCompareCohort = (
  images: IndexedImage[],
  dimension: AnalyticsCompareDimension,
  key: string
): AnalyticsCompareCohort => {
  const cohortImages = images.filter((image) => {
    switch (dimension) {
      case 'generator':
        return getImageGenerator(image) === key;
      case 'model':
        return image.models.includes(key);
      case 'lora':
        return getImageLoraNames(image).includes(key);
      case 'sampler':
        return image.sampler === key;
      case 'scheduler':
        return image.scheduler === key;
      case 'gpu':
        return getImageGpuDevice(image) === key;
      case 'rating':
        return String(image.rating ?? '') === key;
      case 'telemetry':
        return key === 'present' ? hasTelemetryData(image) : !hasTelemetryData(image);
      default:
        return false;
    }
  });

  // Optimization: Consolidate cohort metrics calculation into a single pass.
  // Impact: Reduces O(N) array traversals from 3 passes down to 1, minimizing heap allocations.
  let favoriteCount = 0;
  let ratedCount = 0;
  let ratingSum = 0;
  let telemetryCount = 0;

  for (let i = 0; i < cohortImages.length; i++) {
    const image = cohortImages[i];
    if (image.isFavorite) {
      favoriteCount++;
    }
    if (typeof image.rating === 'number') {
      ratedCount++;
      ratingSum += image.rating;
    }
    if (hasTelemetryData(image)) {
      telemetryCount++;
    }
  }

  const dominantModel = collectFacetItems(cohortImages, (image) => image.models || [], 1)[0]?.label;

  return {
    key,
    label: key === 'present' ? 'Has telemetry' : key === 'missing' ? 'Missing telemetry' : key,
    count: cohortImages.length,
    favoriteRate: cohortImages.length > 0 ? favoriteCount / cohortImages.length : 0,
    averageRating: ratedCount > 0 ? ratingSum / ratedCount : 0,
    telemetryCoverage: cohortImages.length > 0 ? telemetryCount / cohortImages.length : 0,
    dominantModel,
  };
};

export const getCompareDimensionOptions = (
  data: Pick<AnalyticsExplorerData, 'resources' | 'performance' | 'curation'>
): Record<AnalyticsCompareDimension, string[]> => ({
  generator: data.resources.generators.map((item) => item.key),
  model: data.resources.models.map((item) => item.key),
  lora: data.resources.loras.map((item) => item.key),
  sampler: data.resources.samplers.map((item) => item.key),
  scheduler: data.resources.schedulers.map((item) => item.key),
  gpu: data.performance.byGPU.map((item) => item.name),
  rating: data.curation.ratingDistribution.map((item) => item.key).filter((key) => key !== 'unrated'),
  telemetry: ['present', 'missing'],
});

export const buildAnalyticsExplorerData = ({
  scopeImages,
  allImages,
  scopeMode,
  compare,
}: {
  scopeImages: IndexedImage[];
  allImages: IndexedImage[];
  scopeMode: AnalyticsScopeMode;
  compare?: AnalyticsCompareConfig | null;
}): AnalyticsExplorerData => {
  const totalImages = scopeImages.length;
  const averages = calculatePerformanceAverages(scopeImages);

  // Optimization: Pre-calculate resources and periodStats to avoid redundant passes
  // and multiple calls to expensive statistic functions.
  const generators = collectFacetItems(scopeImages, (image) => [getImageGenerator(image)], 10);
  const models = collectFacetItems(scopeImages, (image) => image.models || [], 12);
  const loras = collectFacetItems(scopeImages, getImageLoraNames, 12);
  const samplers = collectFacetItems(scopeImages, (image) => image.sampler ? [image.sampler] : [], 12);
  const schedulers = collectFacetItems(scopeImages, (image) => image.scheduler ? [image.scheduler] : [], 12);

  const dominantModel = models[0]?.label;
  const dominantGenerator = generators[0]?.label;
  const periodStats = calculatePeriodStats(allImages, 30);

  // Optimization: Consolidate curation metrics calculation into a single pass.
  // Impact: Reduces O(N) array traversals from ~13 passes to 1, minimizing heap allocations and GC pressure.
  let favoritesCount = 0;
  let unratedCount = 0;
  let unratedFavoritesCount = 0;
  const ratingStats = new Map<number, { count: number; favorites: number }>();

  for (let i = 0; i < RATING_VALUES.length; i++) {
    ratingStats.set(RATING_VALUES[i], { count: 0, favorites: 0 });
  }

  for (let i = 0; i < scopeImages.length; i++) {
    const image = scopeImages[i];
    const isFavorite = image.isFavorite === true;
    const rating = image.rating;

    if (isFavorite) {
      favoritesCount++;
    }

    if (typeof rating === 'number' && ratingStats.has(rating)) {
      const stats = ratingStats.get(rating)!;
      stats.count++;
      if (isFavorite) {
        stats.favorites++;
      }
    } else {
      unratedCount++;
      if (isFavorite) {
        unratedFavoritesCount++;
      }
    }
  }

  const ratingDistribution: AnalyticsFacetItem[] = [];
  for (let i = 0; i < RATING_VALUES.length; i++) {
    const rating = RATING_VALUES[i];
    const stats = ratingStats.get(rating)!;
    if (stats.count > 0) {
      ratingDistribution.push({
        key: String(rating),
        label: `${rating}★`,
        count: stats.count,
        share: totalImages > 0 ? stats.count / totalImages : 0,
        favorites: stats.favorites,
        keeperRate: stats.count > 0 ? stats.favorites / stats.count : 0,
        averageRating: rating,
        ratingCount: stats.count,
      });
    }
  }

  if (unratedCount > 0) {
    ratingDistribution.push({
      key: 'unrated',
      label: 'Unrated',
      count: unratedCount,
      share: totalImages > 0 ? unratedCount / totalImages : 0,
      favorites: unratedFavoritesCount,
      keeperRate: unratedCount > 0 ? unratedFavoritesCount / unratedCount : 0,
      averageRating: 0,
      ratingCount: 0,
    });
  }

  const habits = analyzeCreationHabits(scopeImages);

  // Optimization: Sort once and reuse for samples and sessions
  // Impact: Eliminates redundant O(N log N) sorts in the analytics generation path
  const sorted = [...scopeImages].sort((a, b) => a.lastModified - b.lastModified);

  const explorerData: AnalyticsExplorerData = {
    scopeMode,
    totalImages,
    allImagesCount: allImages.length,
    dominantModel,
    dominantGenerator,
    telemetryCoverage: averages.telemetryPercentage / 100,
    periodStats,
    insights: generateInsights(
      allImages,
      periodStats,
      models.slice(0, 5).map(m => ({
        name: m.label,
        total: m.count,
        favorites: m.favorites,
        keeperRate: m.keeperRate,
        averageRating: m.averageRating,
        ratingCount: m.ratingCount,
      })),
      undefined,
      scopeMode === 'context' ? 'current scope' : 'library',
      totalImages
    ),
    samples: sorted.slice(-8).reverse(),
    resources: {
      generators,
      models,
      loras,
      samplers,
      schedulers,
    },
    time: {
      timeline: buildTimelinePoints(scopeImages),
      weekday: habits.weekdayDistribution.map((entry) => ({ key: entry.day, label: entry.day, count: entry.count })),
      hourly: habits.hourlyDistribution.map((entry) => ({ key: String(entry.hour), label: `${entry.hour}:00`, count: entry.count })),
      sessions: buildSessions(sorted, 8, true),
    },
    performance: {
      averages,
      byGPU: calculatePerformanceByGPU(scopeImages),
      generationTime: buildNumericBuckets(
        scopeImages,
        ({ min, max }) => min === undefined ? `< ${max}ms` : max === undefined ? `>= ${min}ms` : `${min}-${max}ms`,
        (image) => {
          const value = getImageAnalytics(image)?.generation_time_ms;
          return typeof value === 'number' ? value : null;
        },
        [
          { key: 'lt1000', max: 1000 },
          { key: '1k-5k', min: 1000, max: 5000 },
          { key: '5k-15k', min: 5000, max: 15000 },
          { key: '15k-60k', min: 15000, max: 60000 },
          { key: 'gte60k', min: 60000 },
        ]
      ),
      speed: buildNumericBuckets(
        scopeImages,
        ({ min, max }) => min === undefined ? `< ${max} it/s` : max === undefined ? `>= ${min} it/s` : `${min}-${max} it/s`,
        (image) => {
          const value = getImageAnalytics(image)?.steps_per_second;
          return typeof value === 'number' ? value : null;
        },
        [
          { key: 'lt2', max: 2 },
          { key: '2-5', min: 2, max: 5 },
          { key: '5-10', min: 5, max: 10 },
          { key: '10-20', min: 10, max: 20 },
          { key: 'gte20', min: 20 },
        ]
      ),
      vram: buildNumericBuckets(
        scopeImages,
        ({ min, max }) => min === undefined ? `< ${max} MB` : max === undefined ? `>= ${min} MB` : `${min}-${max} MB`,
        (image) => {
          const value = getImageAnalytics(image)?.vram_peak_mb;
          return typeof value === 'number' ? value : null;
        },
        [
          { key: 'lt2048', max: 2048 },
          { key: '2048-4096', min: 2048, max: 4096 },
          { key: '4096-8192', min: 4096, max: 8192 },
          { key: '8192-12288', min: 8192, max: 12288 },
          { key: 'gte12288', min: 12288 },
        ]
      ),
    },
    curation: {
      favoritesCount,
      favoriteRate: totalImages > 0 ? favoritesCount / totalImages : 0,
      unratedCount,
      ratingDistribution,
      // Optimization: Reuse pre-calculated facets to avoid redundant O(N) traversals.
      // Impact: Saves two full library passes by leveraging already computed models and loras.
      keeperModels: models.slice(0, 8),
      keeperLoras: loras.slice(0, 8),
    },
  };

  if (compare) {
    explorerData.compare = {
      dimension: compare.dimension,
      left: buildCompareCohort(scopeImages, compare.dimension, compare.leftKey),
      right: buildCompareCohort(scopeImages, compare.dimension, compare.rightKey),
    };
  }

  return explorerData;
};

import { IndexedImage } from '../types';

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
  favorites: number; // TODO: Add 'favorite' field to IndexedImage metadata
  keeperRate: number; // percentage of favorites
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
    case 'thisMonth':
      // Calculate days from start of current month
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return Math.ceil((now.getTime() - startOfMonth.getTime()) / (24 * 60 * 60 * 1000));
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

  const currentCount = images.filter(
    (img) => img.lastModified >= currentPeriodStart
  ).length;

  const previousCount = images.filter(
    (img) =>
      img.lastModified >= previousPeriodStart &&
      img.lastModified < currentPeriodStart
  ).length;

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

  images.forEach((img) => {
    const date = new Date(img.lastModified);
    let key: string;

    if (groupBy === 'day') {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    } else if (groupBy === 'week') {
      const weekNum = getWeekNumber(date);
      key = `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    } else {
      // month
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    if (img.lastModified >= currentPeriodStart) {
      currentData.set(key, (currentData.get(key) || 0) + 1);
    } else if (img.lastModified >= previousPeriodStart) {
      previousData.set(key, (previousData.get(key) || 0) + 1);
    }
  });

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
  const itemStats = new Map<string, { total: number; favorites: number }>();

  images.forEach((img) => {
    // TODO: Check if image has 'favorite' flag in metadata
    const isFavorite = false; // Placeholder - implement when favorite system exists

    if (field === 'scheduler') {
      const scheduler = normalizeItemName(img.scheduler);
      if (scheduler) {
        const stats = itemStats.get(scheduler) || { total: 0, favorites: 0 };
        stats.total++;
        if (isFavorite) stats.favorites++;
        itemStats.set(scheduler, stats);
      }
    } else {
      const items = Array.isArray(img[field]) ? img[field] : [img[field]];
      items.forEach((item) => {
        const normalizedItem = normalizeItemName(item);
        if (normalizedItem) {
          const stats = itemStats.get(normalizedItem) || { total: 0, favorites: 0 };
          stats.total++;
          if (isFavorite) stats.favorites++;
          itemStats.set(normalizedItem, stats);
        }
      });
    }
  });

  return Array.from(itemStats.entries())
    .map(([name, stats]) => ({
      name,
      total: stats.total,
      favorites: stats.favorites,
      keeperRate: stats.total > 0 ? (stats.favorites / stats.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * Analyze creation habits
 */
export function analyzeCreationHabits(images: IndexedImage[]): CreationHabits {
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekdayCounts = new Map<number, number>();
  const hourlyCounts = new Map<number, number>();

  images.forEach((img) => {
    const date = new Date(img.lastModified);
    const weekday = date.getDay();
    const hour = date.getHours();

    weekdayCounts.set(weekday, (weekdayCounts.get(weekday) || 0) + 1);
    hourlyCounts.set(hour, (hourlyCounts.get(hour) || 0) + 1);
  });

  const weekdayDistribution = weekdays.map((day, index) => ({
    day,
    count: weekdayCounts.get(index) || 0,
  }));

  const hourlyDistribution = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: hourlyCounts.get(hour) || 0,
  }));

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

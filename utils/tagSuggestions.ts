import type { TagInfo } from '../types';

export const DEFAULT_TAG_SUGGESTION_LIMIT = 10;
export const DEFAULT_RECENT_TAG_CHIP_LIMIT = 10;
export const MIN_TAG_UI_LIMIT = 5;
export const MAX_TAG_UI_LIMIT = 20;
export const MAX_RECENT_TAG_HISTORY = 50;

export type TagInputMode = 'single' | 'csv';

export interface TagSuggestion {
  name: string;
  count: number;
  isRecent: boolean;
  recentIndex: number;
}

interface BuildTagSuggestionsOptions {
  query: string;
  recentTags: string[];
  availableTags: Array<Pick<TagInfo, 'name' | 'count'>>;
  excludedTags?: string[];
  limit: number;
}

interface RecentTagChipOptions {
  recentTags: string[];
  excludedTags?: string[];
  limit: number;
}

const normalizeTag = (tag: string) => tag.trim().toLowerCase();

export const sanitizeTagUiLimit = (value: number | null | undefined, fallback: number): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(MAX_TAG_UI_LIMIT, Math.max(MIN_TAG_UI_LIMIT, Math.round(value as number)));
};

export const getTagSearchToken = (value: string, mode: TagInputMode): string => {
  if (mode === 'csv') {
    const parts = value.split(',');
    return normalizeTag(parts[parts.length - 1] ?? '');
  }

  return normalizeTag(value);
};

export const replaceLastCsvToken = (value: string, nextTag: string): string => {
  const parts = value.split(',');
  parts.pop();
  const preservedParts = parts
    .map((part) => part.trim())
    .filter(Boolean);

  return [...preservedParts, normalizeTag(nextTag)].join(', ') + ', ';
};

export const getRecentTagChips = ({
  recentTags,
  excludedTags = [],
  limit,
}: RecentTagChipOptions): string[] => {
  const normalizedExcluded = new Set(excludedTags.map(normalizeTag).filter(Boolean));
  const normalizedLimit = sanitizeTagUiLimit(limit, DEFAULT_RECENT_TAG_CHIP_LIMIT);
  const suggestions: string[] = [];

  for (const tag of recentTags) {
    const normalizedTag = normalizeTag(tag);
    if (!normalizedTag || normalizedExcluded.has(normalizedTag) || suggestions.includes(normalizedTag)) {
      continue;
    }

    suggestions.push(normalizedTag);

    if (suggestions.length >= normalizedLimit) {
      break;
    }
  }

  return suggestions;
};

export const getTagSuggestions = ({
  query,
  recentTags,
  availableTags,
  excludedTags = [],
  limit,
}: BuildTagSuggestionsOptions): TagSuggestion[] => {
  const normalizedQuery = normalizeTag(query);
  const normalizedExcluded = new Set(excludedTags.map(normalizeTag).filter(Boolean));
  const normalizedLimit = sanitizeTagUiLimit(limit, DEFAULT_TAG_SUGGESTION_LIMIT);
  const availableTagCounts = new Map<string, number>();

  for (const tag of availableTags) {
    const normalizedName = normalizeTag(tag.name);
    if (!normalizedName) {
      continue;
    }

    availableTagCounts.set(normalizedName, tag.count ?? 0);
  }

  const candidates = new Map<string, TagSuggestion>();

  recentTags.forEach((tag, index) => {
    const normalizedTag = normalizeTag(tag);
    if (!normalizedTag || normalizedExcluded.has(normalizedTag) || candidates.has(normalizedTag)) {
      return;
    }

    if (normalizedQuery && !normalizedTag.includes(normalizedQuery)) {
      return;
    }

    candidates.set(normalizedTag, {
      name: normalizedTag,
      count: availableTagCounts.get(normalizedTag) ?? 0,
      isRecent: true,
      recentIndex: index,
    });
  });

  if (normalizedQuery) {
    for (const tag of availableTags) {
      const normalizedName = normalizeTag(tag.name);
      if (!normalizedName || normalizedExcluded.has(normalizedName) || !normalizedName.includes(normalizedQuery)) {
        continue;
      }

      const existing = candidates.get(normalizedName);
      if (existing) {
        candidates.set(normalizedName, { ...existing, count: tag.count ?? existing.count });
        continue;
      }

      candidates.set(normalizedName, {
        name: normalizedName,
        count: tag.count ?? 0,
        isRecent: false,
        recentIndex: Number.POSITIVE_INFINITY,
      });
    }
  }

  const suggestions = Array.from(candidates.values());

  if (!normalizedQuery) {
    return suggestions.slice(0, normalizedLimit);
  }

  suggestions.sort((left, right) => {
    const leftPrefix = left.name.startsWith(normalizedQuery) ? 0 : 1;
    const rightPrefix = right.name.startsWith(normalizedQuery) ? 0 : 1;
    if (leftPrefix !== rightPrefix) {
      return leftPrefix - rightPrefix;
    }

    const leftRecent = left.isRecent ? 0 : 1;
    const rightRecent = right.isRecent ? 0 : 1;
    if (leftRecent !== rightRecent) {
      return leftRecent - rightRecent;
    }

    if (left.isRecent && right.isRecent && left.recentIndex !== right.recentIndex) {
      return left.recentIndex - right.recentIndex;
    }

    return left.name.localeCompare(right.name);
  });

  return suggestions.slice(0, normalizedLimit);
};

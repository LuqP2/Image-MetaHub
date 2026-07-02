import type { IndexedImage } from '../types';
import { formatLocalDateKey } from './dateFilterUtils';

export type ImageGroupByMode = 'none' | 'date' | 'name' | 'session';
export type ImageGroupingSortOrder = 'asc' | 'desc' | 'date-asc' | 'date-desc' | 'random';

export interface ImageGroupingOptions {
  sortOrder?: ImageGroupingSortOrder;
}

export interface ImageGroup {
  id: string;
  label: string;
  subtitle?: string;
  count: number;
  startImageId: string;
  thumbnailImageId?: string;
  dateKey?: string;
  startTime?: number;
  endTime?: number;
}

export type ImageGroupRenderItem =
  | { type: 'group-header'; group: ImageGroup }
  | { type: 'image'; image: IndexedImage };

export interface GroupedImagesResult {
  groups: ImageGroup[];
  items: ImageGroupRenderItem[];
}

export const SESSION_GAP_MS = 45 * 60 * 1000;

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const formatDateLabel = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

const formatTimeLabel = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

const getDominantModel = (images: IndexedImage[]): string | undefined => {
  const counts = new Map<string, number>();

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const models = image.models;
    if (!models) continue;

    for (let j = 0; j < models.length; j++) {
      const model = models[j];
      const normalized = typeof model === 'string' ? model.trim() : '';
      if (!normalized) {
        continue;
      }
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  let dominant: string | undefined;
  let maxCount = -1;

  for (const entry of counts.entries()) {
    const model = entry[0];
    const count = entry[1];

    if (count > maxCount) {
      maxCount = count;
      dominant = model;
    } else if (count === maxCount && dominant !== undefined) {
      // Tie-breaker: use the same logic as sort (collator.compare)
      if (collator.compare(model, dominant) < 0) {
        dominant = model;
      }
    }
  }

  return dominant;
};

const makeGroup = (
  id: string,
  label: string,
  images: IndexedImage[],
  subtitle?: string,
  extra?: Pick<ImageGroup, 'dateKey' | 'startTime' | 'endTime'>,
  overrideThumbnailId?: string,
): ImageGroup => ({
  id,
  label,
  subtitle,
  count: images.length,
  startImageId: images[0]?.id ?? '',
  thumbnailImageId: overrideThumbnailId ?? images.reduce<IndexedImage | null>(
    (latest, image) => latest === null || image.lastModified > latest.lastModified ? image : latest,
    null,
  )?.id,
  ...extra,
});

const flattenGroups = (
  groupedEntries: Array<{ group: ImageGroup; images: IndexedImage[] }>,
): GroupedImagesResult => {
  const groups: ImageGroup[] = [];
  const items: ImageGroupRenderItem[] = [];

  for (let i = 0; i < groupedEntries.length; i++) {
    const entry = groupedEntries[i];
    groups.push(entry.group);

    items.push({ type: 'group-header' as const, group: entry.group });

    const groupImages = entry.images;
    for (let j = 0; j < groupImages.length; j++) {
      items.push({ type: 'image' as const, image: groupImages[j] });
    }
  }

  return { groups, items };
};

const groupByDate = (images: IndexedImage[]): GroupedImagesResult => {
  const entries = new Map<string, IndexedImage[]>();
  const date = new Date();

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    // Optimization: Reuse a single Date object to avoid O(N) allocations in the grouping loop.
    date.setTime(image.lastModified);
    const key = formatLocalDateKey(date);
    const bucket = entries.get(key);
    if (bucket) {
      bucket.push(image);
    } else {
      entries.set(key, [image]);
    }
  }

  const groupedEntries: Array<{ group: ImageGroup; images: IndexedImage[] }> = [];
  for (const [key, groupImages] of entries.entries()) {
    groupedEntries.push({
      group: makeGroup(`date-${key}`, formatDateLabel(groupImages[0].lastModified), groupImages, undefined, {
        dateKey: key,
        startTime: groupImages[0].lastModified,
        endTime: groupImages[groupImages.length - 1].lastModified,
      }),
      images: groupImages,
    });
  }

  return flattenGroups(groupedEntries);
};

const getNameGroupKey = (name: string): string => {
  const first = name.trim().charAt(0).toUpperCase();
  // Optimization: Direct character range check is significantly faster than regex in hot loops.
  return first >= 'A' && first <= 'Z' ? first : '#';
};

const groupByName = (images: IndexedImage[]): GroupedImagesResult => {
  const entries = new Map<string, IndexedImage[]>();

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const key = getNameGroupKey(image.name);
    const bucket = entries.get(key);
    if (bucket) {
      bucket.push(image);
    } else {
      entries.set(key, [image]);
    }
  }

  const groupedEntries: Array<{ group: ImageGroup; images: IndexedImage[] }> = [];
  for (const [key, groupImages] of entries.entries()) {
    groupedEntries.push({
      group: makeGroup(`name-${key}`, key, groupImages),
      images: groupImages,
    });
  }

  return flattenGroups(groupedEntries);
};

const getSessionSortDirection = (sortOrder?: ImageGroupingSortOrder): 'asc' | 'desc' =>
  sortOrder === 'date-asc' ? 'asc' : 'desc';

const groupBySession = (images: IndexedImage[], options: ImageGroupingOptions = {}): GroupedImagesResult => {
  if (images.length === 0) {
    return { groups: [], items: [] };
  }

  const sessionDirection = getSessionSortDirection(options.sortOrder);
  const sorted = [...images].sort((left, right) => left.lastModified - right.lastModified || collator.compare(left.name, right.name));
  const sessions: IndexedImage[][] = [];
  let currentSession: IndexedImage[] = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const image = sorted[index];
    const previousImage = sorted[index - 1];

    if (image.lastModified - previousImage.lastModified > SESSION_GAP_MS) {
      sessions.push(currentSession);
      currentSession = [image];
      continue;
    }

    currentSession.push(image);
  }

  sessions.push(currentSession);

  const orderedSessions = sessionDirection === 'desc'
    ? [...sessions].reverse()
    : sessions;

  const groupedEntries: Array<{ group: ImageGroup; images: IndexedImage[] }> = [];
  for (let i = 0; i < orderedSessions.length; i++) {
    const session = orderedSessions[i];
    const chronologicalStart = session[0];
    const chronologicalEnd = session[session.length - 1];
    const start = chronologicalStart.lastModified;
    const end = chronologicalEnd.lastModified;
    const dominantModel = getDominantModel(session);
    const label = `${formatDateLabel(start)} ${formatTimeLabel(start)}-${formatTimeLabel(end)}`;
    const subtitle = dominantModel ? `Dominant model: ${dominantModel}` : undefined;
    const orderedSessionImages = sessionDirection === 'desc'
      ? [...session].reverse()
      : session;

    groupedEntries.push({
      group: makeGroup(
        `session-${start}-${chronologicalStart.id}`,
        label,
        orderedSessionImages,
        subtitle,
        {
          dateKey: formatLocalDateKey(start),
          startTime: start,
          endTime: end,
        },
        chronologicalEnd.id,
      ),
      images: orderedSessionImages,
    });
  }

  return flattenGroups(groupedEntries);
};

export const groupImages = (
  images: IndexedImage[],
  groupBy: ImageGroupByMode,
  options: ImageGroupingOptions = {},
): GroupedImagesResult => {
  if (groupBy === 'none' || images.length === 0) {
    return {
      groups: [],
      items: images.map((image) => ({ type: 'image', image })),
    };
  }

  if (groupBy === 'date') {
    return groupByDate(images);
  }

  if (groupBy === 'name') {
    return groupByName(images);
  }

  return groupBySession(images, options);
};

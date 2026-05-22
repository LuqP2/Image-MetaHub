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

  for (const image of images) {
    for (const model of image.models ?? []) {
      const normalized = typeof model === 'string' ? model.trim() : '';
      if (!normalized) {
        continue;
      }
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || collator.compare(left[0], right[0]))[0]?.[0];
};

const makeGroup = (
  id: string,
  label: string,
  images: IndexedImage[],
  subtitle?: string,
  extra?: Pick<ImageGroup, 'dateKey' | 'startTime' | 'endTime'>,
): ImageGroup => ({
  id,
  label,
  subtitle,
  count: images.length,
  startImageId: images[0]?.id ?? '',
  thumbnailImageId: images.reduce<IndexedImage | null>(
    (latest, image) => latest === null || image.lastModified > latest.lastModified ? image : latest,
    null,
  )?.id,
  ...extra,
});

const flattenGroups = (
  groupedEntries: Array<{ group: ImageGroup; images: IndexedImage[] }>,
): GroupedImagesResult => ({
  groups: groupedEntries.map((entry) => entry.group),
  items: groupedEntries.flatMap((entry) => [
    { type: 'group-header' as const, group: entry.group },
    ...entry.images.map((image) => ({ type: 'image' as const, image })),
  ]),
});

const groupByDate = (images: IndexedImage[]): GroupedImagesResult => {
  const entries = new Map<string, IndexedImage[]>();

  for (const image of images) {
    const key = formatLocalDateKey(image.lastModified);
    const bucket = entries.get(key) ?? [];
    bucket.push(image);
    entries.set(key, bucket);
  }

  return flattenGroups(
    Array.from(entries.entries()).map(([key, groupImages]) => ({
      group: makeGroup(`date-${key}`, formatDateLabel(groupImages[0].lastModified), groupImages, undefined, {
        dateKey: key,
        startTime: groupImages[0].lastModified,
        endTime: groupImages[groupImages.length - 1].lastModified,
      }),
      images: groupImages,
    })),
  );
};

const getNameGroupKey = (name: string): string => {
  const first = name.trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : '#';
};

const groupByName = (images: IndexedImage[]): GroupedImagesResult => {
  const entries = new Map<string, IndexedImage[]>();

  for (const image of images) {
    const key = getNameGroupKey(image.name);
    const bucket = entries.get(key) ?? [];
    bucket.push(image);
    entries.set(key, bucket);
  }

  return flattenGroups(
    Array.from(entries.entries()).map(([key, groupImages]) => ({
      group: makeGroup(`name-${key}`, key, groupImages),
      images: groupImages,
    })),
  );
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

  return flattenGroups(
    orderedSessions.map((session) => {
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

      return {
        group: {
          ...makeGroup(`session-${start}-${chronologicalStart.id}`, label, orderedSessionImages, subtitle, {
            dateKey: formatLocalDateKey(start),
            startTime: start,
            endTime: end,
          }),
          thumbnailImageId: chronologicalEnd.id,
        },
        images: orderedSessionImages,
      };
    }),
  );
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

import type { IndexedImage } from '../types';
import { formatLocalDateKey } from './dateFilterUtils';
import { groupImages } from './imageGrouping';

export type RelatedImagesMode = 'session' | 'date';

export function findRelatedImages(images: IndexedImage[], source: IndexedImage, mode: RelatedImagesMode) {
  if (mode === 'date') {
    const dateKey = formatLocalDateKey(source.lastModified);
    return {
      label: new Date(source.lastModified).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
      }),
      imageIds: new Set(images
        .filter((image) => formatLocalDateKey(image.lastModified) === dateKey)
        .map((image) => image.id)),
    };
  }

  const { items } = groupImages(images, 'session');
  const sourceIndex = items.findIndex((item) => item.type === 'image' && item.image.id === source.id);
  if (sourceIndex < 0) return null;

  let startIndex = sourceIndex;
  while (items[startIndex].type === 'image') startIndex--;
  const header = items[startIndex];
  if (header.type !== 'group-header') return null;

  const imageIds = new Set<string>();
  for (let index = startIndex + 1; index < items.length; index++) {
    const item = items[index];
    if (item.type === 'group-header') break;
    imageIds.add(item.image.id);
  }
  return { label: header.group.label, imageIds };
}

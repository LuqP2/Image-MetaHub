import type { IndexedImage } from '../types';

interface SafeModeSettings {
  enableSafeMode: boolean;
  blurSensitiveImages: boolean;
  sensitiveTags?: string[];
}

export function getHiddenSensitiveTagSet({ sensitiveTags, blurSensitiveImages, enableSafeMode }: SafeModeSettings): Set<string> | null {
  const normalizedSensitiveTags = (sensitiveTags ?? [])
    .map(tag => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
    .filter(Boolean);
  if (!enableSafeMode || blurSensitiveImages || normalizedSensitiveTags.length === 0) return null;
  return new Set(normalizedSensitiveTags);
}

export function isVisibleWithSafeMode(image: IndexedImage, sensitiveTagSet: Set<string> | null): boolean {
  if (!sensitiveTagSet || !image.tags || image.tags.length === 0) return true;
  return !image.tags.some(tag => sensitiveTagSet.has(tag.toLowerCase()));
}

import type { IndexedImage } from '../../types';
import { boardMediaType } from './assetResolver';

export const normalizePromptMatch = (text: string) => text.replace(/\r\n?/g, '\n').trim();
/** Same fields as the embedded image inspector, including metadata edits applied by the library. */
export function imagePromptText(image: IndexedImage) {
  const metadata = image.metadata?.normalizedMetadata;
  return { positivePrompt: typeof metadata?.prompt === 'string' ? metadata.prompt : '', negativePrompt: typeof metadata?.negativePrompt === 'string' ? metadata.negativePrompt : '' };
}
export const promptImageKey = (image: IndexedImage) => image.assetId ?? image.id;
export function buildPromptIndex(images: IndexedImage[]) {
  const index = new Map<string, IndexedImage[]>();
  for (const image of images) {
    if (boardMediaType(image) !== 'image') continue;
    const key = normalizePromptMatch(imagePromptText(image).positivePrompt);
    if (!key) continue;
    const bucket = index.get(key);
    if (bucket) bucket.push(image); else index.set(key, [image]);
  }
  return index;
}
export function uniquePromptImages(images: IndexedImage[]) {
  return [...new Map(images.map(image => [promptImageKey(image), image])).values()];
}

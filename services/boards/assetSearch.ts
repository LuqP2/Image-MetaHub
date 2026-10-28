import type { IndexedImage } from '../../types';
import { buildCatalogSearchText, buildCompactSearchText } from '../../utils/imageSearchText';
import { boardMediaType } from './assetResolver';
export function searchBoardAssets(images: IndexedImage[], query: string, directoryId: string, mediaType: string): IndexedImage[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return images.filter(image => (!directoryId || image.directoryId === directoryId) && (!mediaType || boardMediaType(image) === mediaType)
    && (!terms.length || terms.every(term => buildCatalogSearchText(image).includes(term)) || terms.every(term => buildCompactSearchText(image).includes(term))))
    .sort((a, b) => b.lastModified - a.lastModified || a.id.localeCompare(b.id));
}

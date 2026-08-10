import type { IndexedImage, ImageRating, SmartCollection } from '../types';

export type ImageViewerHost = 'inline' | 'detached';
export type DetachedImageViewerStatus = 'pending' | 'open' | 'minimized';

export type ImageViewerNavigationSource =
  | 'filtered'
  | 'cluster'
  | 'scope'
  | 'slideshow'
  | 'comfyui'
  | 'find-similar';

export type ImageModalImageDTO = Omit<
  IndexedImage,
  'handle' | 'thumbnailHandle' | 'thumbnailUrl'
>;

export interface ImageViewerSnapshot {
  sessionId: string;
  revision: number;
  image: ImageModalImageDTO;
  previousImage: ImageModalImageDTO | null;
  nextImage: ImageModalImageDTO | null;
  currentIndex: number;
  totalImages: number;
  directoryPath: string;
  isIndexing: boolean;
  startSlideshow: boolean;
  closeOnSlideshowExit: boolean;
  recentTags: string[];
  comparisonCount: number;
  comparisonImages: ImageModalImageDTO[];
  collections: SmartCollection[];
}

export type ImageViewerCommand =
  | { type: 'navigate'; direction: 'next' | 'previous' | 'random'; wrap?: boolean }
  | { type: 'close' }
  | { type: 'focus-main' }
  | { type: 'find-similar'; imageId: string }
  | { type: 'open-comfyui'; imageId: string }
  | { type: 'open-editor'; imageId: string }
  | { type: 'image-deleted'; imageId: string }
  | { type: 'image-renamed'; oldImageId: string; newImageId: string; newRelativePath: string }
  | { type: 'delete-image'; imageId: string }
  | { type: 'rename-image'; imageId: string; newName: string }
  | { type: 'reparse-image'; imageId: string }
  | { type: 'add-comparison'; imageId: string }
  | { type: 'add-to-collection'; collectionId: string; imageIds: string[] }
  | { type: 'create-collection'; collection: Record<string, unknown> }
  | { type: 'get-tag-suggestions'; query: string }
  | { type: 'toggle-favorite'; imageId: string }
  | { type: 'set-rating'; imageId: string; rating: ImageRating }
  | { type: 'add-tag'; imageId: string; tag: string }
  | { type: 'remove-tag'; imageId: string; tag: string }
  | { type: 'remove-auto-tag'; imageId: string; tag: string }
  | { type: 'set-search'; query: string }
  | { type: 'slideshow-started' };

/** Build a structured-clone-safe, path-backed viewer record without filesystem handles. */
export const toImageModalImageDTO = (image: IndexedImage): ImageModalImageDTO => {
  const { handle: _handle, thumbnailHandle: _thumbnailHandle, thumbnailUrl: _thumbnailUrl, ...dto } = image;
  const metadata = image.metadata && typeof image.metadata === 'object'
    ? image.metadata as Record<string, unknown>
    : {};
  return {
    ...dto,
    metadataString: '',
    metadata: {
      normalizedMetadata: metadata.normalizedMetadata,
      _rawMetadataCompacted: true,
      _rawMetadataSizeBytes: typeof image.metadataString === 'string' ? image.metadataString.length : 0,
      _rawMetadataKeys: Object.keys(metadata).filter((key) => key !== 'normalizedMetadata'),
    },
  } as ImageModalImageDTO;
};

export const resolveEffectiveImageViewerHost = (
  preference: unknown,
  hasDesktopBridge: boolean,
): ImageViewerHost => hasDesktopBridge && preference === 'detached' ? 'detached' : 'inline';

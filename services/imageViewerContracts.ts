import type { IndexedImage, ImageRating, SmartCollection, BaseMetadata } from '../types';
import type { WorkflowOverrides } from './comfyUIApiClient';
import type { ComfyUISourceImagePolicy, ComfyUIWorkflowMode } from './comfyUIWorkflowBuilder';

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

/**
 * A generation request raised from a detached viewer. The queue runner only exists
 * in the main renderer, so the viewer never enqueues locally — it ships the
 * parameters over and the main renderer runs the real hook.
 *
 * Everything here must survive structured cloning across two IPC hops, so the
 * inpainting mask travels as raw bytes instead of a `File`.
 */
export interface ImageViewerMaskFileDTO {
  name: string;
  type: string;
  data: ArrayBuffer;
}

export type ImageViewerGenerateRequest =
  | {
      provider: 'a1111';
      imageId: string;
      customMetadata?: Partial<BaseMetadata>;
      numberOfImages?: number;
    }
  | {
      provider: 'comfyui';
      imageId: string;
      customMetadata?: Partial<BaseMetadata>;
      overrides?: WorkflowOverrides;
      workflowMode?: ComfyUIWorkflowMode;
      sourceImagePolicy?: ComfyUISourceImagePolicy;
      advancedPromptJson?: string;
      advancedWorkflowJson?: string;
      maskFile?: ImageViewerMaskFileDTO | null;
    };

/**
 * The image editor writes the file from whichever window is showing it, but the
 * library store and folder cache only exist in the main renderer — a detached
 * viewer forwards the result so the grid does not keep stale data.
 */
export interface ImageViewerSaveRequest {
  mode: 'save-as' | 'overwrite';
  savedPath: string;
  sourceImageId: string;
  sourceMetadata: BaseMetadata | null;
}

export interface ImageViewerSaveResult {
  success: boolean;
  error?: string;
  savedImageName?: string;
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
  | { type: 'generate'; request: ImageViewerGenerateRequest }
  | { type: 'image-saved'; request: ImageViewerSaveRequest }
  | { type: 'slideshow-started' };

/** Serialize an inpainting mask for transport to the main renderer. */
export const toImageViewerMaskFileDTO = async (
  maskFile: File | null | undefined,
): Promise<ImageViewerMaskFileDTO | null> => {
  if (!maskFile) return null;
  return {
    name: maskFile.name,
    type: maskFile.type,
    data: await maskFile.arrayBuffer(),
  };
};

/** Rebuild the mask on the main-renderer side so the generation hooks are unchanged. */
export const fromImageViewerMaskFileDTO = (
  maskFile: ImageViewerMaskFileDTO | null | undefined,
): File | null => {
  if (!maskFile) return null;
  return new File([maskFile.data], maskFile.name, { type: maskFile.type });
};

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

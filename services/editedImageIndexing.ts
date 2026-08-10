import type { BaseMetadata, IndexedImage } from '../types';
import { indexImageFileAtPath, reparseIndexedImage } from './fileIndexer';
import cacheManager from './cacheManager';

/**
 * Bookkeeping that has to happen after the image editor writes a file: index or
 * reparse the result, fold the source metadata back in, and update the library
 * store plus the folder cache.
 *
 * It lives here rather than in ImageModal because a detached viewer window has
 * its own tiny image store — the authoritative update has to run in the main
 * renderer, against the real library, using exactly the same logic.
 */

export type EditedImageDirectory = { id: string; path: string; name: string };

const firstNonBlankString = (...values: Array<string | undefined | null>): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

const firstNonEmptyArray = <T,>(...values: Array<T[] | undefined | null>): T[] | undefined => {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) {
      return value;
    }
  }
  return undefined;
};

const firstDefined = <T,>(...values: Array<T | undefined | null>): T | undefined => {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
};

export const mergeEditedNormalizedMetadata = (
  parsedMetadata?: BaseMetadata,
  sourceMetadata?: BaseMetadata,
): BaseMetadata | undefined => {
  if (!parsedMetadata) {
    return sourceMetadata;
  }
  if (!sourceMetadata) {
    return parsedMetadata;
  }

  return {
    ...sourceMetadata,
    ...parsedMetadata,
    prompt: firstNonBlankString(parsedMetadata.prompt, sourceMetadata.prompt) || '',
    negativePrompt: firstNonBlankString(parsedMetadata.negativePrompt, sourceMetadata.negativePrompt) || '',
    model: firstNonBlankString(parsedMetadata.model, sourceMetadata.model) || '',
    models: firstNonEmptyArray(parsedMetadata.models, sourceMetadata.models) || [],
    loras: firstNonEmptyArray(parsedMetadata.loras, sourceMetadata.loras) || [],
    sampler: firstNonBlankString(parsedMetadata.sampler, sourceMetadata.sampler) || '',
    scheduler: firstNonBlankString(parsedMetadata.scheduler, sourceMetadata.scheduler) || '',
    board: firstNonBlankString(parsedMetadata.board, sourceMetadata.board),
    cfgScale: firstDefined(parsedMetadata.cfgScale, parsedMetadata.cfg_scale, sourceMetadata.cfgScale, sourceMetadata.cfg_scale),
    cfg_scale: firstDefined(parsedMetadata.cfg_scale, parsedMetadata.cfgScale, sourceMetadata.cfg_scale, sourceMetadata.cfgScale),
    steps: firstDefined(parsedMetadata.steps, sourceMetadata.steps) || 0,
    seed: firstDefined(parsedMetadata.seed, sourceMetadata.seed),
  };
};

export const scheduleEditedImageCacheUpsert = (
  directory: { path: string; name: string },
  image: IndexedImage,
  scanSubfolders: boolean,
) => {
  window.setTimeout(() => {
    const cacheModes = Array.from(new Set([scanSubfolders, !scanSubfolders]));
    Promise.all(
      cacheModes.map((scanSubfoldersMode) =>
        cacheManager.applyChunkedCacheDelta(
          directory.path,
          directory.name,
          [image],
          [],
          [],
          scanSubfoldersMode,
        )
      )
    ).catch((error) => {
      console.error('Failed to update cache after edited image save:', error);
    });
  }, 0);
};

export interface IndexSavedEditedImageCopyOptions {
  savedPath: string;
  targetDirectory: EditedImageDirectory;
  sourceImage: IndexedImage;
  sourceMetadata?: BaseMetadata;
  scanSubfolders: boolean;
  allImages: IndexedImage[];
  addImages: (images: IndexedImage[]) => void;
  mergeImages: (images: IndexedImage[]) => void;
}

/** Save As: index the new file and add (or merge) it into the library. */
export async function indexSavedEditedImageCopy({
  savedPath,
  targetDirectory,
  sourceImage,
  sourceMetadata,
  scanSubfolders,
  allImages,
  addImages,
  mergeImages,
}: IndexSavedEditedImageCopyOptions): Promise<IndexedImage | null> {
  const indexedImage = await indexImageFileAtPath(savedPath, targetDirectory);
  if (!indexedImage) {
    return null;
  }

  const savedNormalizedMetadata = mergeEditedNormalizedMetadata(
    indexedImage.metadata?.normalizedMetadata as BaseMetadata | undefined,
    sourceMetadata,
  );
  const savedMetadata = savedNormalizedMetadata
    ? { ...indexedImage.metadata, normalizedMetadata: savedNormalizedMetadata }
    : indexedImage.metadata;
  const savedImage: IndexedImage = {
    ...indexedImage,
    metadata: savedMetadata,
    metadataString: savedNormalizedMetadata ? JSON.stringify(savedMetadata) : sourceImage.metadataString,
    models: savedNormalizedMetadata?.models || sourceImage.models,
    loras: savedNormalizedMetadata?.loras || sourceImage.loras,
    sampler: savedNormalizedMetadata?.sampler || sourceImage.sampler,
    scheduler: savedNormalizedMetadata?.scheduler || sourceImage.scheduler,
    board: savedNormalizedMetadata?.board || sourceImage.board,
    prompt: savedNormalizedMetadata?.prompt || sourceImage.prompt,
    negativePrompt: savedNormalizedMetadata?.negativePrompt || sourceImage.negativePrompt,
    cfgScale: savedNormalizedMetadata?.cfgScale ?? savedNormalizedMetadata?.cfg_scale ?? sourceImage.cfgScale,
    steps: savedNormalizedMetadata?.steps || sourceImage.steps,
    seed: savedNormalizedMetadata?.seed ?? sourceImage.seed,
    workflowNodes: sourceImage.workflowNodes,
    enrichmentState: 'enriched',
  };

  if (allImages.some((candidate) => candidate.id === savedImage.id)) {
    mergeImages([savedImage]);
  } else {
    addImages([savedImage]);
  }
  scheduleEditedImageCacheUpsert(targetDirectory, savedImage, scanSubfolders);

  return savedImage;
}

export interface ReindexOverwrittenEditedImageOptions {
  sourceImage: IndexedImage;
  sourceDirectory: EditedImageDirectory;
  sourceMetadata?: BaseMetadata;
  scanSubfolders: boolean;
  mergeImages: (images: IndexedImage[]) => void;
  setImageThumbnail: (
    imageId: string,
    thumbnail: { thumbnailUrl: null; thumbnailHandle: null; status: 'pending'; error: null },
  ) => void;
}

/** Overwrite: reparse the original file in place, keeping its library identity. */
export async function reindexOverwrittenEditedImage({
  sourceImage,
  sourceDirectory,
  sourceMetadata,
  scanSubfolders,
  mergeImages,
  setImageThumbnail,
}: ReindexOverwrittenEditedImageOptions): Promise<IndexedImage> {
  const reparsed = await reparseIndexedImage(sourceImage, sourceDirectory.path);
  if (!reparsed) {
    throw new Error('The edited image was saved, but metadata reparsing returned no image.');
  }

  const preservedNormalizedMetadata = mergeEditedNormalizedMetadata(
    reparsed.metadata?.normalizedMetadata as BaseMetadata | undefined,
    sourceMetadata,
  );
  const preservedMetadata = preservedNormalizedMetadata
    ? { ...reparsed.metadata, normalizedMetadata: preservedNormalizedMetadata }
    : reparsed.metadata;
  const preservedMetadataImage: IndexedImage = {
    ...sourceImage,
    ...reparsed,
    metadata: preservedMetadata,
    metadataString: preservedNormalizedMetadata ? JSON.stringify(preservedMetadata) : sourceImage.metadataString,
    models: preservedNormalizedMetadata?.models || sourceImage.models,
    loras: preservedNormalizedMetadata?.loras || sourceImage.loras,
    sampler: preservedNormalizedMetadata?.sampler || sourceImage.sampler,
    scheduler: preservedNormalizedMetadata?.scheduler || sourceImage.scheduler,
    board: preservedNormalizedMetadata?.board || sourceImage.board,
    prompt: preservedNormalizedMetadata?.prompt || sourceImage.prompt,
    negativePrompt: preservedNormalizedMetadata?.negativePrompt || sourceImage.negativePrompt,
    cfgScale: preservedNormalizedMetadata?.cfgScale ?? preservedNormalizedMetadata?.cfg_scale ?? sourceImage.cfgScale,
    steps: preservedNormalizedMetadata?.steps || sourceImage.steps,
    seed: preservedNormalizedMetadata?.seed ?? sourceImage.seed,
    workflowNodes: sourceImage.workflowNodes,
    handle: sourceImage.handle,
    thumbnailHandle: sourceImage.thumbnailHandle,
    thumbnailUrl: undefined,
    thumbnailStatus: 'pending',
    thumbnailError: null,
    directoryId: sourceImage.directoryId,
    directoryName: sourceImage.directoryName,
    isFavorite: sourceImage.isFavorite,
    tags: sourceImage.tags,
    rating: sourceImage.rating,
    clusterId: sourceImage.clusterId,
    clusterPosition: sourceImage.clusterPosition,
    autoTags: sourceImage.autoTags,
    autoTagsGeneratedAt: sourceImage.autoTagsGeneratedAt,
    enrichmentState: 'enriched',
  };

  mergeImages([preservedMetadataImage]);
  setImageThumbnail(sourceImage.id, {
    thumbnailUrl: null,
    thumbnailHandle: null,
    status: 'pending',
    error: null,
  });
  scheduleEditedImageCacheUpsert(sourceDirectory, preservedMetadataImage, scanSubfolders);

  return preservedMetadataImage;
}

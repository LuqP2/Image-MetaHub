import type { IndexedImage, ImageCluster, SmartCollection, ImageScope } from '../types';
import { resolveSmartCollectionImageIds } from '../services/imageAnnotationsStorage';

export interface ImageScopeSources {
  images: IndexedImage[];
  clusters: ImageCluster[];
  collections: SmartCollection[];
}

export interface ResolvedImageScope {
  /** IDs of every image that belongs to the scope target (before other filters). */
  ids: Set<string>;
  /** False when the scope target no longer exists (deleted collection, regenerated cluster, missing model). */
  valid: boolean;
}

/**
 * Resolves a scope descriptor to the set of image IDs that belong to its target.
 * Returns null when there is no active scope. When the target can no longer be
 * found, `valid` is false so callers can auto-clear the scope (see getScopeToastMessage).
 */
export const resolveScopeImageIds = (
  scope: ImageScope | null,
  sources: ImageScopeSources,
): ResolvedImageScope | null => {
  if (!scope) {
    return null;
  }

  if (scope.type === 'model') {
    const ids = new Set<string>();
    for (const image of sources.images) {
      if (image.models && image.models.includes(scope.id)) {
        ids.add(image.id);
      }
    }
    // A model scope is invalid only when no image references it anymore.
    return { ids, valid: ids.size > 0 };
  }

  if (scope.type === 'cluster') {
    const cluster = sources.clusters.find((entry) => entry.id === scope.id);
    if (!cluster) {
      return { ids: new Set<string>(), valid: false };
    }
    return { ids: new Set(cluster.imageIds), valid: true };
  }

  // collection
  const collection = sources.collections.find((entry) => entry.id === scope.id);
  if (!collection) {
    return { ids: new Set<string>(), valid: false };
  }
  return { ids: new Set(resolveSmartCollectionImageIds(collection, sources.images)), valid: true };
};

/** Intersects an image list with a resolved scope. A null scope is a pass-through. */
export const filterImagesByScope = (
  images: IndexedImage[],
  resolved: ResolvedImageScope | null,
): IndexedImage[] => {
  if (!resolved) {
    return images;
  }
  return images.filter((image) => resolved.ids.has(image.id));
};

/** User-facing toast shown when a scope is auto-cleared because its target vanished. */
export const getScopeToastMessage = (scope: ImageScope): string => {
  switch (scope.type) {
    case 'cluster':
      return 'Scope removed: clusters were regenerated';
    case 'collection':
      return 'Scope removed: the collection no longer exists';
    case 'model':
    default:
      return 'Scope removed: the model is no longer in the library';
  }
};

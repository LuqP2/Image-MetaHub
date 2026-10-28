import type { Directory, IndexedImage } from '../../types';
import { getRelativeImagePath } from '../../utils/imagePaths';
import { isBoardId } from './document.mjs';
import type { BoardAssetLocator, BoardAssetReference, BoardMediaType, BoardReferenceRemap, BoardStableReference } from './types';
import { resolveMediaType } from '../../utils/mediaTypes.js';

export function boardMediaType(image: IndexedImage): BoardMediaType {
  const type = resolveMediaType(image.name, image.fileType);
  return type === 'video' || type === 'audio' || type === 'model3d' ? type : 'image';
}
export function resolveLiveBoardImage(image: IndexedImage, images: IndexedImage[], byId?: Map<string, IndexedImage>): IndexedImage {
  const current = byId ? byId.get(image.id) : images.find(candidate => candidate.id === image.id);
  if (current && (!image.assetId || current.assetId === image.assetId)) return current;
  const matches = image.assetId ? images.filter(candidate => candidate.assetId === image.assetId) : [];
  if (matches.length === 1) return matches[0];
  throw new Error('A selected asset changed or left the library. Select it again before adding it.');
}

const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');
const locatorKey = (locator: BoardAssetLocator) => `${normalizePath(locator.directoryPath ?? '')}\0${normalizePath(locator.relativePath)}`;
export function createBoardAssetReference(image: IndexedImage, directories: Pick<Directory, 'id' | 'path'>[], appliedRemapIds: string[] = []): BoardAssetReference {
  const locator = { imageId: image.id, directoryPath: directories.find(directory => directory.id === image.directoryId)?.path ?? null, relativePath: getRelativeImagePath(image) };
  const stable = [image.assetId, image.revisionId, image.provenanceLocationId, image.provenanceRootId].every(isBoardId);
  return stable ? { kind: 'stable', assetId: image.assetId!, revisionId: image.revisionId!, locationId: image.provenanceLocationId!, rootId: image.provenanceRootId!, locator, appliedRemapIds: [...appliedRemapIds] }
    : { kind: 'path', locator, appliedRemapIds: [...appliedRemapIds] };
}

export function createBoardReferenceRemap(image: IndexedImage, newLocator: BoardAssetLocator, directories: Pick<Directory, 'id' | 'path'>[], stableOverride?: BoardStableReference): BoardReferenceRemap {
  const source = createBoardAssetReference(image, directories);
  const stableReference = stableOverride ?? (source.kind === 'stable' ? { assetId: source.assetId, revisionId: source.revisionId, locationId: source.locationId, rootId: source.rootId } : undefined);
  return { operationId: crypto.randomUUID(), oldLocator: source.locator, newLocator, ...(stableReference ? { stableReference } : {}) };
}

export function buildBoardAssetLookup(images: IndexedImage[], directories: Pick<Directory, 'id' | 'path'>[]) {
  const byId = new Map<string, IndexedImage>();
  const byAsset = new Map<string, IndexedImage[]>();
  const byLocator = new Map<string, IndexedImage[]>();
  const roots = new Map(directories.map(directory => [directory.id, directory.path]));
  for (const image of images) {
    byId.set(image.id, image);
    if (image.assetId) {
      const bucket = byAsset.get(image.assetId);
      if (bucket) bucket.push(image); else byAsset.set(image.assetId, [image]);
    }
    const key = locatorKey({ imageId: image.id, directoryPath: roots.get(image.directoryId ?? '') ?? null, relativePath: getRelativeImagePath(image) });
    const bucket = byLocator.get(key);
    if (bucket) bucket.push(image); else byLocator.set(key, [image]);
  }
  return { byId, byAsset, byLocator };
}
export type BoardAssetResolution = { status: 'resolved'; image: IndexedImage } | { status: 'loading' | 'missing' | 'ambiguous' };
export function resolveBoardAsset(reference: BoardAssetReference, lookup: ReturnType<typeof buildBoardAssetLookup>, loading = false): BoardAssetResolution {
  let candidates: IndexedImage[];
  if (reference.kind === 'stable') {
    const assets = lookup.byAsset.get(reference.assetId) ?? [];
    const exact = assets.filter(image => image.provenanceLocationId === reference.locationId);
    if (!exact.length && loading) return { status: 'loading' };
    candidates = exact.length ? exact : assets;
  } else {
    const byId = lookup.byId.get(reference.locator.imageId);
    candidates = byId ? [byId] : reference.locator.directoryPath !== null ? lookup.byLocator.get(locatorKey(reference.locator)) ?? [] : [];
  }
  if (candidates.length === 1) return { status: 'resolved', image: candidates[0] };
  if (loading) return { status: 'loading' };
  return { status: candidates.length ? 'ambiguous' : 'missing' };
}

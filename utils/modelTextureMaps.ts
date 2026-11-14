import type { BaseMetadata, IndexedImage } from '../types';
import { getRelativeImagePath, splitRelativePath } from './imagePaths';
import { isImageFileName, isModel3DFileName } from './mediaTypes.js';

export type TextureMapRole = 'texture' | 'normal' | 'roughness' | 'metallic';

export interface ModelTextureMap {
  role: TextureMapRole;
  filename: string;
}

export interface IndexedTextureMap {
  role: TextureMapRole;
  image: IndexedImage;
}

export const textureMapLabels: Record<TextureMapRole, string> = {
  texture: 'Texture',
  normal: 'Normal',
  roughness: 'Roughness',
  metallic: 'Metallic',
};

const legacySuffixes: ReadonlyMap<string, TextureMapRole> = new Map([
  ['texture', 'texture'], ['basecolor', 'texture'], ['albedo', 'texture'],
  ['normal', 'normal'], ['roughness', 'roughness'], ['metallic', 'metallic'], ['metalness', 'metallic'],
]);
const getStem = (filename: string) => filename.slice(0, filename.lastIndexOf('.'));
const getKey = (folder: string, name: string) => JSON.stringify([folder, name.toLowerCase()]);

export function resolveModelTextureMaps(images: readonly IndexedImage[]) {
  const byModelId = new Map<string, IndexedTextureMap[]>();
  const associatedImageIds = new Set<string>();
  const modelsByStem = new Map<string, IndexedImage[]>();
  const imagesByName = new Map<string, IndexedImage[]>();
  const models: { model: IndexedImage; folder: string }[] = [];
  const candidates: { image: IndexedImage; folder: string; fileName: string }[] = [];
  for (const image of images) {
    if (!image.directoryId) continue;
    const { folderPath, fileName } = splitRelativePath(getRelativeImagePath(image));
    const folder = JSON.stringify([image.directoryId, folderPath]);
    if (isModel3DFileName(fileName, image.fileType)) {
      models.push({ model: image, folder });
      const key = getKey(folder, getStem(fileName));
      const bucket = modelsByStem.get(key) ?? [];
      bucket.push(image);
      modelsByStem.set(key, bucket);
    } else if (isImageFileName(fileName)) {
      candidates.push({ image, folder, fileName });
      const key = getKey(folder, fileName);
      const bucket = imagesByName.get(key) ?? [];
      bucket.push(image);
      imagesByName.set(key, bucket);
    }
  }

  const declarations = new Set<string>();
  const explicitClaims = new Map<string, { modelId: string; map: IndexedTextureMap }[]>();
  const associate = (modelId: string, map: IndexedTextureMap) => {
    const maps = byModelId.get(modelId) ?? [];
    maps.push(map);
    byModelId.set(modelId, maps);
    associatedImageIds.add(map.image.id);
  };
  for (const { model, folder } of models) {
    const entries = (model.metadata?.normalizedMetadata as BaseMetadata | undefined)?.model_3d?.textureMaps;
    if (!Array.isArray(entries)) continue;
    declarations.add(model.id);
    for (const entry of entries) {
      if (!entry || typeof entry.role !== 'string' || !Object.hasOwn(textureMapLabels, entry.role) || typeof entry.filename !== 'string'
          || /[/\\:\u0000-\u001f]/.test(entry.filename) || !isImageFileName(entry.filename)) continue;
      const matches = imagesByName.get(getKey(folder, entry.filename));
      const exact = matches?.find((image) => image.name === entry.filename);
      const image = exact ?? (matches?.length === 1 ? matches[0] : undefined);
      if (!image) continue;
      const claims = explicitClaims.get(image.id) ?? [];
      if (claims.some((claim) => claim.modelId === model.id)) continue;
      claims.push({ modelId: model.id, map: { image, role: entry.role } });
      explicitClaims.set(image.id, claims);
    }
  }
  for (const claims of explicitClaims.values()) {
    if (claims.length === 1) associate(claims[0].modelId, claims[0].map);
  }

  for (const { image, folder, fileName } of candidates) {
    if (explicitClaims.has(image.id)) continue;
    const match = /^(.*?)([ _-]+)([^ _-]+)$/.exec(getStem(fileName));
    if (!match) continue;
    const [, stem, delimiters, suffix] = match;
    const role = legacySuffixes.get(suffix.toLowerCase());
    if (!stem || !role) continue;
    // Try each delimiter boundary, including when the model stem itself ends in a delimiter.
    const owners = new Set<IndexedImage>();
    for (let length = 0; length < delimiters.length; length++) {
      for (const model of modelsByStem.get(getKey(folder, stem + delimiters.slice(0, length))) ?? []) owners.add(model);
    }
    if (owners.size !== 1) continue;
    const [model] = owners;
    if (!declarations.has(model.id)) {
      associate(model.id, { image, role });
    }
  }
  return { byModelId, associatedImageIds };
}

const indexes = new WeakMap<readonly IndexedImage[], ReturnType<typeof resolveModelTextureMaps>>();

export function getModelTextureMapIndex(images: readonly IndexedImage[]) {
  const existing = indexes.get(images);
  if (existing) return existing;
  const index = resolveModelTextureMaps(images);
  indexes.set(images, index);
  return index;
}

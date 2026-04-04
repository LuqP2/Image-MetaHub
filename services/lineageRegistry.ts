import { type BaseMetadata, type Directory, type GenerationType, type ImageLineage, type IndexedImage, type SourceImageReference } from '../types';
import { PARSER_VERSION } from './cacheManager';

export const LINEAGE_REGISTRY_SCHEMA_VERSION = 1;

export type ResolvedSourceStatus = 'linked' | 'missing' | 'ambiguous' | 'unavailable';

export interface ResolvedLineageEntry {
  generationType: Exclude<GenerationType, 'txt2img'>;
  lineage: ImageLineage;
  sourceStatus: ResolvedSourceStatus;
  sourceImageId?: string;
  sourceReference?: SourceImageReference | null;
}

export interface LineageRegistrySnapshot {
  schemaVersion: number;
  librarySignature: string;
  builtAt: number;
  imageCount: number;
  resolvedByImageId: Record<string, ResolvedLineageEntry>;
  derivedIdsBySourceId: Record<string, string[]>;
}

export interface LineageBuildState {
  status: 'idle' | 'scheduled' | 'building' | 'ready' | 'error';
  processed: number;
  total: number;
  message: string;
  dirty: boolean;
  source: 'none' | 'cache' | 'worker';
  lastBuiltAt: number | null;
}

export interface LineageDirectorySignature {
  directoryId: string;
  path: string;
  lastScan: number;
  imageCount: number;
  parserVersion: number;
}

export interface LightweightLineageImage {
  id: string;
  name: string;
  directoryId: string;
  absolutePath: string;
  relativePath: string;
  fileName: string;
  width: number | null;
  height: number | null;
  lastModified: number;
  generationType?: GenerationType;
  lineage?: ImageLineage | null;
  sourceReference?: SourceImageReference | null;
}

interface LineageImageIndex {
  byAbsolutePath: Map<string, string[]>;
  byRelativePath: Map<string, string[]>;
  byFileName: Map<string, string[]>;
  byFileNameAndDimensions: Map<string, string[]>;
}

const TRANSFORMATION_TYPES = new Set<Exclude<GenerationType, 'txt2img'>>([
  'img2img',
  'inpaint',
  'outpaint',
]);

const buildDimensionKey = (fileName: string, width: number, height: number): string =>
  `${fileName}::${width}x${height}`;

const addIdToBucket = (map: Map<string, string[]>, key: string, id: string): void => {
  if (!key) {
    return;
  }

  const bucket = map.get(key);
  if (bucket) {
    bucket.push(id);
    return;
  }

  map.set(key, [id]);
};

const stripComfyStorageSuffix = (value?: string | null): string => {
  if (!value) {
    return '';
  }

  return value.trim().replace(/\s+\[(input|output|temp)\]$/i, '');
};

export const normalizeLineagePath = (value?: string | null): string => {
  if (!value) {
    return '';
  }

  return stripComfyStorageSuffix(value).replace(/\\/g, '/').replace(/[\\/]+$/, '').toLowerCase();
};

export const normalizeLineageFileName = (value?: string | null): string => {
  if (!value) {
    return '';
  }

  const normalized = stripComfyStorageSuffix(value).replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return (segments[segments.length - 1] || value).toLowerCase();
};

export const parseRelativeImagePath = (imageId: string, fallbackName: string): string => {
  const [, relativePath = ''] = imageId.split('::');
  return relativePath ? relativePath.replace(/\\/g, '/') : fallbackName;
};

const getImageDimensions = (image: IndexedImage): { width: number | null; height: number | null } => {
  const metadata = image.metadata?.normalizedMetadata as BaseMetadata | undefined;
  const width = metadata?.width ?? null;
  const height = metadata?.height ?? null;

  if (width && height) {
    return { width, height };
  }

  if (image.dimensions) {
    const match = image.dimensions.match(/(\d+)\s*x\s*(\d+)/i);
    if (match) {
      return { width: Number(match[1]), height: Number(match[2]) };
    }
  }

  return { width: null, height: null };
};

const getSourceReference = (metadata?: BaseMetadata): SourceImageReference | null => {
  if (!metadata?.lineage?.sourceImage) {
    return null;
  }

  const sourceImage = metadata.lineage.sourceImage;
  const normalized: SourceImageReference = {
    fileName: sourceImage.fileName ?? null,
    relativePath: sourceImage.relativePath ?? null,
    absolutePath: sourceImage.absolutePath ?? null,
    sha256: sourceImage.sha256 ?? null,
    width: sourceImage.width ?? null,
    height: sourceImage.height ?? null,
    nodeId: sourceImage.nodeId ?? null,
    nodeType: sourceImage.nodeType ?? null,
  };

  if (
    !normalized.fileName &&
    !normalized.relativePath &&
    !normalized.absolutePath &&
    !normalized.sha256
  ) {
    return null;
  }

  return normalized;
};

export const isTransformationGenerationType = (
  generationType?: GenerationType | null
): generationType is Exclude<GenerationType, 'txt2img'> =>
  !!generationType && TRANSFORMATION_TYPES.has(generationType as Exclude<GenerationType, 'txt2img'>);

export const createLineageDirectoryPathMap = (directories: Directory[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const directory of directories) {
    map.set(directory.id, normalizeLineagePath(directory.path));
  }
  return map;
};

export const toLightweightLineageImage = (
  image: IndexedImage,
  directoryPathMap: Map<string, string>
): LightweightLineageImage => {
  const metadata = image.metadata?.normalizedMetadata as BaseMetadata | undefined;
  const sourceReference = getSourceReference(metadata);
  const relativePath = parseRelativeImagePath(image.id, image.name);
  const absoluteFromHandle = normalizeLineagePath(
    (image.handle as FileSystemFileHandle & { _filePath?: string })._filePath
  );
  const basePath = directoryPathMap.get(image.directoryId) || '';
  const absolutePath = absoluteFromHandle || normalizeLineagePath(basePath ? `${basePath}/${relativePath}` : relativePath);
  const { width, height } = getImageDimensions(image);

  return {
    id: image.id,
    name: image.name,
    directoryId: image.directoryId || '',
    absolutePath,
    relativePath: normalizeLineagePath(relativePath),
    fileName: normalizeLineageFileName(image.name),
    width,
    height,
    lastModified: image.lastModified,
    generationType: metadata?.generationType,
    lineage: metadata?.lineage ?? null,
    sourceReference,
  };
};

const buildLineageIndex = (images: LightweightLineageImage[]): LineageImageIndex => {
  const index: LineageImageIndex = {
    byAbsolutePath: new Map(),
    byRelativePath: new Map(),
    byFileName: new Map(),
    byFileNameAndDimensions: new Map(),
  };

  for (const image of images) {
    addIdToBucket(index.byAbsolutePath, image.absolutePath, image.id);
    addIdToBucket(index.byRelativePath, image.relativePath, image.id);
    addIdToBucket(index.byFileName, image.fileName, image.id);

    if (image.fileName && image.width && image.height) {
      addIdToBucket(
        index.byFileNameAndDimensions,
        buildDimensionKey(image.fileName, image.width, image.height),
        image.id
      );
    }
  }

  return index;
};

const resolveSourceMatch = (
  reference: SourceImageReference | null,
  index: LineageImageIndex,
  imagesById: Map<string, LightweightLineageImage>,
  excludeImageId: string
): { status: ResolvedSourceStatus; sourceImageId?: string } => {
  if (!reference) {
    return { status: 'unavailable' };
  }

  const getCandidates = (bucket?: string[]): string[] =>
    (bucket || []).filter((candidateId) => candidateId !== excludeImageId);

  const absolutePath = normalizeLineagePath(reference.absolutePath);
  if (absolutePath) {
    const exactMatch = getCandidates(index.byAbsolutePath.get(absolutePath));
    if (exactMatch.length === 1) {
      return { status: 'linked', sourceImageId: exactMatch[0] };
    }
    if (exactMatch.length > 1) {
      return { status: 'ambiguous' };
    }
  }

  const relativePath = normalizeLineagePath(reference.relativePath);
  if (relativePath) {
    const exactMatch = getCandidates(index.byRelativePath.get(relativePath));
    if (exactMatch.length === 1) {
      return { status: 'linked', sourceImageId: exactMatch[0] };
    }
    if (exactMatch.length > 1) {
      return { status: 'ambiguous' };
    }
  }

  const fileName = normalizeLineageFileName(
    reference.fileName ?? reference.relativePath ?? reference.absolutePath
  );
  if (!fileName) {
    return { status: 'missing' };
  }

  const fileNameMatches = getCandidates(index.byFileName.get(fileName));
  if (fileNameMatches.length === 1) {
    return { status: 'linked', sourceImageId: fileNameMatches[0] };
  }

  if (fileNameMatches.length > 1 && reference.width && reference.height) {
    const dimensionMatches = getCandidates(
      index.byFileNameAndDimensions.get(
        buildDimensionKey(fileName, reference.width, reference.height)
      )
    );

    if (dimensionMatches.length === 1) {
      return { status: 'linked', sourceImageId: dimensionMatches[0] };
    }

    if (dimensionMatches.length > 1) {
      return { status: 'ambiguous' };
    }
  }

  if (fileNameMatches.length > 1) {
    return { status: 'ambiguous' };
  }

  return { status: 'missing' };
};

export const buildLineageRegistrySnapshot = (
  images: LightweightLineageImage[],
  librarySignature: string,
  onProgress?: (processed: number, total: number, message: string) => void
): LineageRegistrySnapshot => {
  const imagesById = new Map(images.map((image) => [image.id, image]));
  const index = buildLineageIndex(images);
  const resolvedByImageId: Record<string, ResolvedLineageEntry> = {};
  const derivedIdsBySourceId = new Map<string, string[]>();
  const total = images.length * 2 || 1;
  let processed = 0;

  for (const image of images) {
    processed += 1;
    if (processed === 1 || processed % 2048 === 0 || processed === total) {
      onProgress?.(processed, total, 'Indexing lineage candidates...');
    }
  }

  const transformationImages = images.filter((image) =>
    isTransformationGenerationType(image.generationType)
  );

  for (const image of transformationImages) {
    const generationType = image.generationType as Exclude<GenerationType, 'txt2img'>;
    const resolution = resolveSourceMatch(image.sourceReference ?? null, index, imagesById, image.id);
    const entry: ResolvedLineageEntry = {
      generationType,
      lineage: image.lineage || {},
      sourceStatus: resolution.status,
      sourceReference: image.sourceReference ?? null,
      ...(resolution.sourceImageId ? { sourceImageId: resolution.sourceImageId } : {}),
    };

    resolvedByImageId[image.id] = entry;

    if (resolution.sourceImageId) {
      const bucket = derivedIdsBySourceId.get(resolution.sourceImageId) || [];
      bucket.push(image.id);
      derivedIdsBySourceId.set(resolution.sourceImageId, bucket);
    }

    processed += 1;
    if (processed === images.length + 1 || processed % 1024 === 0 || processed === total) {
      onProgress?.(processed, total, 'Resolving lineage links...');
    }
  }

  const sortedDerivedIdsBySourceId: Record<string, string[]> = {};
  for (const [sourceImageId, derivedIds] of derivedIdsBySourceId.entries()) {
    const orderedIds = [...derivedIds].sort((leftId, rightId) => {
      const leftImage = imagesById.get(leftId);
      const rightImage = imagesById.get(rightId);
      return (rightImage?.lastModified ?? 0) - (leftImage?.lastModified ?? 0);
    });
    sortedDerivedIdsBySourceId[sourceImageId] = orderedIds;
  }

  return {
    schemaVersion: LINEAGE_REGISTRY_SCHEMA_VERSION,
    librarySignature,
    builtAt: Date.now(),
    imageCount: images.length,
    resolvedByImageId,
    derivedIdsBySourceId: sortedDerivedIdsBySourceId,
  };
};

export const buildLineageLibrarySignature = (
  signatures: LineageDirectorySignature[],
  scanSubfolders: boolean
): string => {
  const normalized = [...signatures]
    .map((signature) => ({
      path: normalizeLineagePath(signature.path),
      lastScan: signature.lastScan,
      imageCount: signature.imageCount,
      parserVersion: signature.parserVersion || PARSER_VERSION,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return JSON.stringify({
    schemaVersion: LINEAGE_REGISTRY_SCHEMA_VERSION,
    parserVersion: PARSER_VERSION,
    scanSubfolders,
    directories: normalized,
  });
};

export const getLineageStatusMessage = (resolved: Pick<ResolvedLineageEntry, 'sourceStatus'>): string => {
  switch (resolved.sourceStatus) {
    case 'linked':
      return 'Source image found in the current library.';
    case 'ambiguous':
      return 'A source image reference exists, but multiple library images match it.';
    case 'missing':
      return 'This image was generated from another image, but the source file was not found in the current library.';
    case 'unavailable':
    default:
      return 'This image was generated from another image, but the metadata does not contain a reliable source reference.';
  }
};

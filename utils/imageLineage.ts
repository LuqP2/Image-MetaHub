import { type BaseMetadata, type Directory, type GenerationType, type ImageLineage, type IndexedImage, type SourceImageReference } from '../types';

export type ResolvedSourceStatus = 'linked' | 'missing' | 'ambiguous' | 'unavailable';

export interface ResolvedImageLineage {
  generationType: Exclude<GenerationType, 'txt2img'>;
  lineage: ImageLineage;
  sourceStatus: ResolvedSourceStatus;
  sourceImage?: IndexedImage;
  sourceReference?: SourceImageReference | null;
}

const TRANSFORMATION_TYPES = new Set<Exclude<GenerationType, 'txt2img'>>([
  'img2img',
  'inpaint',
  'outpaint',
]);

const normalizePath = (value?: string | null): string => {
  if (!value) {
    return '';
  }

  return value.replace(/\\/g, '/').replace(/[\\/]+$/, '').toLowerCase();
};

const normalizeFileName = (value?: string | null): string => {
  if (!value) {
    return '';
  }

  const normalized = value.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return (segments[segments.length - 1] || value).toLowerCase();
};

const parseRelativePath = (imageId: string): string => {
  const [, relativePath = ''] = imageId.split('::');
  return relativePath.replace(/\\/g, '/');
};

const buildAbsoluteImagePath = (
  image: IndexedImage,
  directories: Directory[]
): string => {
  const absoluteFromHandle = normalizePath((image.handle as FileSystemFileHandle & { _filePath?: string })._filePath);
  if (absoluteFromHandle) {
    return absoluteFromHandle;
  }

  const directory = directories.find((entry) => entry.id === image.directoryId);
  if (!directory?.path) {
    return '';
  }

  const base = normalizePath(directory.path);
  const relative = parseRelativePath(image.id);
  if (!relative) {
    return base;
  }

  return normalizePath(`${base}/${relative}`);
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

const resolveSourceMatch = (
  reference: SourceImageReference | null,
  images: IndexedImage[],
  directories: Directory[]
): { status: ResolvedSourceStatus; image?: IndexedImage } => {
  if (!reference) {
    return { status: 'unavailable' };
  }

  const absolutePath = normalizePath(reference.absolutePath);
  if (absolutePath) {
    const exactMatch = images.filter((image) => buildAbsoluteImagePath(image, directories) === absolutePath);
    if (exactMatch.length === 1) {
      return { status: 'linked', image: exactMatch[0] };
    }
    if (exactMatch.length > 1) {
      return { status: 'ambiguous' };
    }
  }

  const relativePath = normalizePath(reference.relativePath);
  if (relativePath) {
    const exactMatch = images.filter((image) => normalizePath(parseRelativePath(image.id)) === relativePath);
    if (exactMatch.length === 1) {
      return { status: 'linked', image: exactMatch[0] };
    }
    if (exactMatch.length > 1) {
      return { status: 'ambiguous' };
    }
  }

  const fileName = normalizeFileName(reference.fileName ?? reference.relativePath ?? reference.absolutePath);
  if (!fileName) {
    return { status: 'missing' };
  }

  const fileNameMatches = images.filter((image) => normalizeFileName(image.name) === fileName);
  if (fileNameMatches.length === 1) {
    return { status: 'linked', image: fileNameMatches[0] };
  }

  if (fileNameMatches.length > 1 && reference.width && reference.height) {
    const dimensionMatches = fileNameMatches.filter((image) => {
      const dims = getImageDimensions(image);
      return dims.width === reference.width && dims.height === reference.height;
    });

    if (dimensionMatches.length === 1) {
      return { status: 'linked', image: dimensionMatches[0] };
    }

    if (dimensionMatches.length > 1) {
      return { status: 'ambiguous' };
    }
  }

  return fileNameMatches.length > 1 ? { status: 'ambiguous' } : { status: 'missing' };
};

export const isTransformationGenerationType = (
  generationType?: GenerationType | null
): generationType is Exclude<GenerationType, 'txt2img'> => {
  return !!generationType && TRANSFORMATION_TYPES.has(generationType as Exclude<GenerationType, 'txt2img'>);
};

export const getGenerationTypeLabel = (generationType?: GenerationType | null): string => {
  switch (generationType) {
    case 'img2img':
      return 'Img2Img';
    case 'inpaint':
      return 'Inpaint';
    case 'outpaint':
      return 'Outpaint';
    case 'txt2img':
      return 'Txt2Img';
    default:
      return 'Unknown';
  }
};

export const resolveImageLineage = (
  image: IndexedImage,
  metadata: BaseMetadata | undefined,
  images: IndexedImage[],
  directories: Directory[]
): ResolvedImageLineage | null => {
  const generationType = metadata?.generationType;
  if (!isTransformationGenerationType(generationType)) {
    return null;
  }

  const lineage: ImageLineage = metadata?.lineage || {};
  const sourceReference = getSourceReference(metadata);
  const resolvedSource = resolveSourceMatch(sourceReference, images.filter((entry) => entry.id !== image.id), directories);

  return {
    generationType,
    lineage,
    sourceStatus: resolvedSource.status,
    sourceImage: resolvedSource.image,
    sourceReference,
  };
};

export const getLineageStatusMessage = (resolved: ResolvedImageLineage): string => {
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

export const getDirectDerivedImages = (
  sourceImage: IndexedImage,
  images: IndexedImage[],
  directories: Directory[],
  limit = 6
): IndexedImage[] => {
  const matches: IndexedImage[] = [];

  for (const candidate of images) {
    if (candidate.id === sourceImage.id) {
      continue;
    }

    const metadata = candidate.metadata?.normalizedMetadata as BaseMetadata | undefined;
    const resolved = resolveImageLineage(candidate, metadata, images, directories);
    if (resolved?.sourceImage?.id === sourceImage.id) {
      matches.push(candidate);
      if (matches.length >= limit) {
        break;
      }
    }
  }

  return matches;
};

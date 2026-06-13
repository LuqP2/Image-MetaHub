import type {
  CleanupImageDecision,
  CleanupStack,
  CleanupTechnicalFlag,
  CleanupVisualSignature,
  IndexedImage,
} from '../types';
import { getFileExtension, isImageFileName } from '../utils/mediaTypes.js';

export const CLEANUP_SIGNATURE_VERSION = 1;

const HASH_SIZE = 9;
const HASH_COMPARE_SIZE = 8;
const THUMBNAIL_SIZE = 16;
const HISTOGRAM_BINS = 12;
const MAX_STACK_SIZE = 12;

export interface CleanupAnalysisResult {
  staticImages: IndexedImage[];
  stacks: CleanupStack[];
  signatures: Map<string, CleanupVisualSignature>;
  flagsByImageId: Map<string, CleanupTechnicalFlag[]>;
}

export interface CleanupAnalysisOptions {
  cachedSignatures?: Map<string, CleanupVisualSignature>;
  onProgress?: (progress: { current: number; total: number; message: string }) => void;
}

type DecodableImage = IndexedImage & {
  handle?: FileSystemFileHandle;
  thumbnailHandle?: FileSystemFileHandle;
};

const staticImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export const isCleanupStaticImage = (image: IndexedImage): boolean =>
  isImageFileName(image.name) && staticImageExtensions.has(getFileExtension(image.name));

const normalizeRelativeName = (image: IndexedImage) => {
  const [, relativePath = ''] = image.id.split('::');
  return (relativePath || image.name || '').replace(/\\/g, '/').toLowerCase();
};

const parseSequenceKey = (image: IndexedImage): string | null => {
  const normalizedName = normalizeRelativeName(image);
  const fileName = normalizedName.split('/').pop() ?? normalizedName;
  const stem = fileName.replace(/\.[^.]+$/, '');
  const match = stem.match(/^(.*?)(\d{3,})$/);
  if (!match) {
    return null;
  }
  return `${match[1]}#${Number(match[2])}`;
};

const isReusableSignature = (image: IndexedImage, signature?: CleanupVisualSignature): signature is CleanupVisualSignature =>
  Boolean(
    signature &&
    signature.signatureVersion === CLEANUP_SIGNATURE_VERSION &&
    signature.lastModified === image.lastModified,
  );

const getFileFromImage = async (image: DecodableImage): Promise<File | null> => {
  const handle = image.thumbnailHandle ?? image.handle;
  if (!handle?.getFile) {
    return null;
  }

  return handle.getFile();
};

const createDecodeErrorSignature = (image: IndexedImage, error: string): CleanupVisualSignature => ({
  imageId: image.id,
  signatureVersion: CLEANUP_SIGNATURE_VERSION,
  lastModified: image.lastModified,
  width: 0,
  height: 0,
  averageLuma: 0,
  lumaVariance: 0,
  dhash: '',
  histogram: [],
  thumbnail: [],
  error,
  updatedAt: Date.now(),
});

const drawToCanvas = (bitmap: ImageBitmap, width: number, height: number): ImageData | null => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }

  context.drawImage(bitmap, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
};

const getLuma = (data: Uint8ClampedArray, index: number) =>
  (data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114) / 255;

const computeDHash = (imageData: ImageData): string => {
  let bits = '';
  for (let y = 0; y < HASH_COMPARE_SIZE; y += 1) {
    for (let x = 0; x < HASH_COMPARE_SIZE; x += 1) {
      const left = getLuma(imageData.data, (y * HASH_SIZE + x) * 4);
      const right = getLuma(imageData.data, (y * HASH_SIZE + x + 1) * 4);
      bits += left > right ? '1' : '0';
    }
  }

  let hex = '';
  for (let index = 0; index < bits.length; index += 4) {
    hex += Number.parseInt(bits.slice(index, index + 4), 2).toString(16);
  }
  return hex;
};

const computeHistogram = (imageData: ImageData): number[] => {
  const histogram = new Array<number>(HISTOGRAM_BINS * 3).fill(0);
  const pixelCount = imageData.width * imageData.height || 1;

  for (let index = 0; index < imageData.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = imageData.data[index + channel];
      const bucket = Math.min(HISTOGRAM_BINS - 1, Math.floor((value / 256) * HISTOGRAM_BINS));
      histogram[channel * HISTOGRAM_BINS + bucket] += 1 / pixelCount;
    }
  }

  return histogram;
};

const computeThumbnail = (imageData: ImageData): { thumbnail: number[]; averageLuma: number; lumaVariance: number } => {
  const thumbnail: number[] = [];
  let total = 0;
  let totalSquared = 0;

  for (let index = 0; index < imageData.data.length; index += 4) {
    const luma = getLuma(imageData.data, index);
    thumbnail.push(Number(luma.toFixed(4)));
    total += luma;
    totalSquared += luma * luma;
  }

  const count = thumbnail.length || 1;
  const averageLuma = total / count;
  const lumaVariance = Math.max(0, totalSquared / count - averageLuma * averageLuma);

  return { thumbnail, averageLuma, lumaVariance };
};

export async function computeCleanupVisualSignature(image: IndexedImage): Promise<CleanupVisualSignature> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
    return createDecodeErrorSignature(image, 'Image decoding is not available in this environment.');
  }

  try {
    const file = await getFileFromImage(image as DecodableImage);
    if (!file) {
      return createDecodeErrorSignature(image, 'Image file handle is unavailable.');
    }

    const bitmap = await createImageBitmap(file);
    const hashImageData = drawToCanvas(bitmap, HASH_SIZE, HASH_COMPARE_SIZE);
    const thumbnailImageData = drawToCanvas(bitmap, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    const histogramImageData = drawToCanvas(bitmap, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close();

    if (!hashImageData || !thumbnailImageData || !histogramImageData) {
      return createDecodeErrorSignature(image, 'Unable to create analysis canvas.');
    }

    const thumbnailStats = computeThumbnail(thumbnailImageData);
    return {
      imageId: image.id,
      signatureVersion: CLEANUP_SIGNATURE_VERSION,
      lastModified: image.lastModified,
      width,
      height,
      averageLuma: Number(thumbnailStats.averageLuma.toFixed(4)),
      lumaVariance: Number(thumbnailStats.lumaVariance.toFixed(4)),
      dhash: computeDHash(hashImageData),
      histogram: computeHistogram(histogramImageData).map((value) => Number(value.toFixed(5))),
      thumbnail: thumbnailStats.thumbnail,
      updatedAt: Date.now(),
    };
  } catch (error) {
    return createDecodeErrorSignature(
      image,
      error instanceof Error ? error.message : 'Unable to decode image.',
    );
  }
}

const hammingDistance = (left: string, right: string): number => {
  if (!left || !right || left.length !== right.length) {
    return Number.POSITIVE_INFINITY;
  }

  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const diff = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    distance += diff.toString(2).replace(/0/g, '').length;
  }
  return distance;
};

const vectorDistance = (left: number[], right: number[]): number => {
  if (left.length === 0 || left.length !== right.length) {
    return Number.POSITIVE_INFINITY;
  }

  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs(left[index] - right[index]);
  }
  return total / left.length;
};

const thumbnailDifference = (left: number[], right: number[]): number => vectorDistance(left, right);

const lowResSsimApproximation = (left: number[], right: number[]): number => {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }

  const c1 = 0.01 * 0.01;
  const c2 = 0.03 * 0.03;
  const count = left.length;
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / count;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / count;
  let varianceLeft = 0;
  let varianceRight = 0;
  let covariance = 0;

  for (let index = 0; index < count; index += 1) {
    const deltaLeft = left[index] - meanLeft;
    const deltaRight = right[index] - meanRight;
    varianceLeft += deltaLeft * deltaLeft;
    varianceRight += deltaRight * deltaRight;
    covariance += deltaLeft * deltaRight;
  }

  varianceLeft /= count;
  varianceRight /= count;
  covariance /= count;

  return ((2 * meanLeft * meanRight + c1) * (2 * covariance + c2)) /
    ((meanLeft * meanLeft + meanRight * meanRight + c1) * (varianceLeft + varianceRight + c2));
};

const getDimensionsKey = (signature: CleanupVisualSignature) =>
  signature.width > 0 && signature.height > 0 ? `${signature.width}x${signature.height}` : '';

const addFlag = (flags: Map<string, Set<CleanupTechnicalFlag>>, imageId: string, flag: CleanupTechnicalFlag) => {
  const imageFlags = flags.get(imageId) ?? new Set<CleanupTechnicalFlag>();
  imageFlags.add(flag);
  flags.set(imageId, imageFlags);
};

const technicalFlagPriority: CleanupTechnicalFlag[] = [
  'decode_failed',
  'preview_or_grid_candidate',
  'intermediate_output_candidate',
  'too_dark',
  'too_bright',
  'very_small_file',
  'upscale_duplicate_candidate',
  'low_variation_from_previous',
];

const isTechnicalFlag = (flag: CleanupTechnicalFlag): boolean =>
  technicalFlagPriority.includes(flag);

const areLikelySimilar = (
  leftImage: IndexedImage,
  rightImage: IndexedImage,
  left: CleanupVisualSignature,
  right: CleanupVisualSignature,
): boolean => {
  if (left.error || right.error) {
    return false;
  }

  const hashDistance = hammingDistance(left.dhash, right.dhash);
  const histogramDistance = vectorDistance(left.histogram, right.histogram);
  const pixelDifference = thumbnailDifference(left.thumbnail, right.thumbnail);
  const ssim = lowResSsimApproximation(left.thumbnail, right.thumbnail);
  const timeDistance = Math.abs((leftImage.lastModified || 0) - (rightImage.lastModified || 0));
  const leftSequence = parseSequenceKey(leftImage);
  const rightSequence = parseSequenceKey(rightImage);
  const sequenceBoost = Boolean(leftSequence && rightSequence && leftSequence.split('#')[0] === rightSequence.split('#')[0]);
  const temporalBoost = timeDistance <= 10 * 60 * 1000;

  return (
    hashDistance <= 7 ||
    (hashDistance <= 12 && histogramDistance <= 0.018 && temporalBoost) ||
    (pixelDifference <= 0.045 && ssim >= 0.88) ||
    (sequenceBoost && pixelDifference <= 0.075 && histogramDistance <= 0.03)
  );
};

class DisjointSet {
  private parent = new Map<string, string>();

  add(id: string) {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
    }
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (!parent || parent === id) {
      return id;
    }
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(left: string, right: string) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parent.set(rightRoot, leftRoot);
    }
  }
}

const chunkImageIds = (imageIds: string[], size: number): string[][] => {
  const chunks: string[][] = [];
  for (let index = 0; index < imageIds.length; index += size) {
    chunks.push(imageIds.slice(index, index + size));
  }
  return chunks;
};

const createStackTitle = (index: number, imageIds: string[], reasons: CleanupTechnicalFlag[]) => {
  if (reasons.includes('near_duplicate')) {
    return `Similar review set ${index}`;
  }
  if (reasons.length > 0) {
    return 'Technical flags';
  }
  return imageIds.length === 1 ? 'General review' : `General review ${index}`;
};

export async function analyzeCleanupSession(
  images: IndexedImage[],
  options: CleanupAnalysisOptions = {},
): Promise<CleanupAnalysisResult> {
  const staticImages = images.filter(isCleanupStaticImage);
  const signatures = new Map<string, CleanupVisualSignature>();
  const total = staticImages.length;

  for (let index = 0; index < staticImages.length; index += 1) {
    const image = staticImages[index];
    options.onProgress?.({ current: index, total, message: `Analyzing ${image.name}` });
    const cached = options.cachedSignatures?.get(image.id);
    const signature = isReusableSignature(image, cached)
      ? cached
      : await computeCleanupVisualSignature(image);
    signatures.set(image.id, signature);
  }

  options.onProgress?.({ current: total, total, message: 'Building cleanup groups...' });

  const flags = new Map<string, Set<CleanupTechnicalFlag>>();
  const sortedImages = [...staticImages].sort((left, right) => left.lastModified - right.lastModified || left.name.localeCompare(right.name));

  for (const image of sortedImages) {
    const signature = signatures.get(image.id);
    if (!signature) {
      continue;
    }

    if (signature.error) {
      addFlag(flags, image.id, 'decode_failed');
      continue;
    }

    if (signature.averageLuma <= 0.06) {
      addFlag(flags, image.id, 'too_dark');
    }
    if (signature.averageLuma >= 0.94) {
      addFlag(flags, image.id, 'too_bright');
    }
    if ((image.fileSize ?? 0) > 0 && (image.fileSize ?? 0) < 20 * 1024) {
      addFlag(flags, image.id, 'very_small_file');
    }
    if (/preview|grid|contact.?sheet|sprite|thumb|thumbnail/i.test(image.name)) {
      addFlag(flags, image.id, 'preview_or_grid_candidate');
    }
    if (/temp|intermediate|latent|mask|depth|control|normal|canny/i.test(image.name)) {
      addFlag(flags, image.id, 'intermediate_output_candidate');
    }

  }

  const disjointSet = new DisjointSet();
  for (const image of sortedImages) {
    disjointSet.add(image.id);
  }

  for (let index = 1; index < sortedImages.length; index += 1) {
    const previous = sortedImages[index - 1];
    const current = sortedImages[index];
    const previousSignature = signatures.get(previous.id);
    const currentSignature = signatures.get(current.id);
    if (!previousSignature || !currentSignature || previousSignature.error || currentSignature.error) {
      continue;
    }

    const diff = thumbnailDifference(previousSignature.thumbnail, currentSignature.thumbnail);
    if (diff <= 0.035) {
      addFlag(flags, current.id, 'low_variation_from_previous');
    }
  }

  for (let leftIndex = 0; leftIndex < sortedImages.length; leftIndex += 1) {
    const leftImage = sortedImages[leftIndex];
    const leftSignature = signatures.get(leftImage.id);
    if (!leftSignature || leftSignature.error) {
      continue;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < sortedImages.length; rightIndex += 1) {
      const rightImage = sortedImages[rightIndex];
      const rightSignature = signatures.get(rightImage.id);
      if (!rightSignature || rightSignature.error) {
        continue;
      }

      const timeDistance = Math.abs((rightImage.lastModified || 0) - (leftImage.lastModified || 0));
      if (timeDistance > 2 * 60 * 60 * 1000) {
        break;
      }

      if (areLikelySimilar(leftImage, rightImage, leftSignature, rightSignature)) {
        disjointSet.union(leftImage.id, rightImage.id);
        addFlag(flags, leftImage.id, 'near_duplicate');
        addFlag(flags, rightImage.id, 'near_duplicate');

        const leftDimensions = getDimensionsKey(leftSignature);
        const rightDimensions = getDimensionsKey(rightSignature);
        if (leftDimensions && rightDimensions && leftDimensions !== rightDimensions) {
          const larger = (leftSignature.width * leftSignature.height) > (rightSignature.width * rightSignature.height)
            ? leftImage
            : rightImage;
          addFlag(flags, larger.id, 'upscale_duplicate_candidate');
        }
      }
    }
  }

  const groups = new Map<string, IndexedImage[]>();
  for (const image of sortedImages) {
    const root = disjointSet.find(image.id);
    const group = groups.get(root) ?? [];
    group.push(image);
    groups.set(root, group);
  }

  const likelyRejectIds = sortedImages
    .filter((image) => {
      const imageFlags = flags.get(image.id);
      if (!imageFlags) {
        return false;
      }
      return Array.from(imageFlags).some(isTechnicalFlag);
    })
    .map((image) => image.id);

  const stacks: CleanupStack[] = [];
  const likelyRejectChunks = chunkImageIds(likelyRejectIds, MAX_STACK_SIZE);
  likelyRejectChunks.forEach((chunk, index) => {
    stacks.push({
      id: `likely-rejects-${index + 1}-${chunk[0]}`,
      title: likelyRejectChunks.length === 1 ? 'Technical flags' : `Technical flags ${index + 1}`,
      imageIds: chunk,
      representativeImageId: chunk[0],
      score: 1,
      reasons: Array.from(new Set(chunk.flatMap((id) => Array.from(flags.get(id) ?? []).filter(isTechnicalFlag)))),
      kind: 'likely-rejects',
    });
  });

  let stackIndex = 1;
  const visualGroups = Array.from(groups.values())
    .filter((group) => group.length >= 2)
    .sort((left, right) => right.length - left.length || left[0].lastModified - right[0].lastModified);

  for (const group of visualGroups) {
    const imageIds = group.map((image) => image.id);
    const nearDuplicateIds = imageIds.filter((imageId) => flags.get(imageId)?.has('near_duplicate'));
    if (nearDuplicateIds.length >= 2) {
      const chunks = chunkImageIds(nearDuplicateIds, MAX_STACK_SIZE);
      for (const chunk of chunks) {
        stacks.push({
          id: `visual-${stackIndex}-${chunk[0]}`,
          title: createStackTitle(stackIndex, chunk, ['near_duplicate']),
          imageIds: chunk,
          representativeImageId: chunk[0],
          score: Math.min(1, chunk.length / MAX_STACK_SIZE),
          reasons: ['near_duplicate'],
          kind: 'visual',
        });
        stackIndex += 1;
      }
      continue;
    }

    const chunks = chunkImageIds(imageIds, MAX_STACK_SIZE);
    for (const chunk of chunks) {
      stacks.push({
        id: `visual-${stackIndex}-${chunk[0]}`,
        title: createStackTitle(stackIndex, chunk, ['near_duplicate']),
        imageIds: chunk,
        representativeImageId: chunk[0],
        score: Math.min(1, chunk.length / MAX_STACK_SIZE),
        reasons: ['near_duplicate'],
        kind: 'visual',
      });
      stackIndex += 1;
    }
  }

  const groupedIds = new Set(stacks.flatMap((stack) => stack.imageIds));
  const singletonIds = sortedImages.filter((image) => !groupedIds.has(image.id)).map((image) => image.id);
  for (const chunk of chunkImageIds(singletonIds, MAX_STACK_SIZE)) {
    if (chunk.length === 0) {
      continue;
    }
    stacks.push({
      id: `singletons-${stackIndex}-${chunk[0]}`,
      title: createStackTitle(stackIndex, chunk, []),
      imageIds: chunk,
      representativeImageId: chunk[0],
      score: 0,
      reasons: [],
      kind: 'singletons',
    });
    stackIndex += 1;
  }

  const flagsByImageId = new Map<string, CleanupTechnicalFlag[]>();
  for (const [imageId, imageFlags] of flags.entries()) {
    flagsByImageId.set(imageId, Array.from(imageFlags));
  }

  return {
    staticImages,
    stacks,
    signatures,
    flagsByImageId,
  };
}

export const applyCleanupDecision = (
  decisions: Map<string, CleanupImageDecision>,
  imageIds: string[],
  decision: CleanupImageDecision,
): Map<string, CleanupImageDecision> => {
  const next = new Map(decisions);
  for (const imageId of imageIds) {
    next.set(imageId, decision);
  }
  return next;
};

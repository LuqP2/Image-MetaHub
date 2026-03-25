import React from 'react';
import { type BaseMetadata, type IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';
import {
  buildImageLineageIndex,
  getDirectDerivedImages,
  getGenerationTypeLabel,
  getLineageStatusMessage,
  resolveImageLineage,
} from '../utils/imageLineage';

interface ImageLineageSectionProps {
  image: IndexedImage;
  metadata?: BaseMetadata;
  onOpenImage: (image: IndexedImage) => void;
}

const badgeClassName =
  'inline-flex items-center rounded-full border border-blue-400/30 bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-300';

const detailClassName =
  'rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600 dark:border-gray-700/60 dark:bg-gray-900/40 dark:text-gray-300';

const LineagePreviewCard: React.FC<{
  image: IndexedImage;
  label: string;
  onOpenImage: (image: IndexedImage) => void;
}> = ({ image, label, onOpenImage }) => {
  const thumbnail = useResolvedThumbnail(image);
  const thumbnailUrl = thumbnail?.thumbnailUrl ?? null;
  const normalizedMetadata = image.metadata?.normalizedMetadata as BaseMetadata | undefined;

  return (
    <button
      onClick={() => onOpenImage(image)}
      className="group flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-lg border border-gray-200 bg-white p-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-gray-700/60 dark:bg-gray-900/50 dark:hover:border-blue-500/40 dark:hover:bg-blue-500/10"
      title={`Open ${label.toLowerCase()}: ${image.name}`}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={image.name}
          className="h-14 w-14 flex-shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded bg-gray-200 text-[10px] font-semibold uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          IMH
        </div>
      )}
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {label}
        </div>
        <div className="truncate text-sm font-medium text-gray-800 group-hover:text-blue-700 dark:text-gray-100 dark:group-hover:text-blue-300">
          {image.name}
        </div>
        {normalizedMetadata?.width && normalizedMetadata?.height && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {normalizedMetadata.width}x{normalizedMetadata.height}
          </div>
        )}
      </div>
    </button>
  );
};

const ImageLineageSection: React.FC<ImageLineageSectionProps> = ({
  image,
  metadata,
  onOpenImage,
}) => {
  const images = useImageStore((state) => state.images);
  const directories = useImageStore((state) => state.directories);
  const lineageIndex = React.useMemo(
    () => buildImageLineageIndex(images, directories),
    [directories, images]
  );

  const resolvedLineage = React.useMemo(
    () => resolveImageLineage(image, metadata, images, directories, lineageIndex),
    [directories, image, images, lineageIndex, metadata]
  );
  const derivedImages = React.useMemo(
    () => getDirectDerivedImages(image, images, directories, 4, lineageIndex),
    [directories, image, images, lineageIndex]
  );

  if (!resolvedLineage && derivedImages.length === 0) {
    return null;
  }

  const sourceReferenceName =
    resolvedLineage?.sourceReference?.fileName ||
    resolvedLineage?.sourceReference?.relativePath ||
    resolvedLineage?.sourceReference?.absolutePath ||
    null;

  return (
    <div className="space-y-3 rounded-lg border border-blue-200/70 bg-blue-50/60 p-3 dark:border-blue-500/20 dark:bg-blue-500/5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">Lineage</div>
        {resolvedLineage && (
          <span className={badgeClassName}>
            {getGenerationTypeLabel(resolvedLineage.generationType)}
          </span>
        )}
      </div>

      {resolvedLineage && (
        <>
          <div className="flex flex-wrap gap-2">
            {resolvedLineage.lineage.denoiseStrength != null && (
              <div className={detailClassName}>
                Denoise: {resolvedLineage.lineage.denoiseStrength}
              </div>
            )}
            {resolvedLineage.lineage.maskBlur != null && (
              <div className={detailClassName}>
                Mask blur: {resolvedLineage.lineage.maskBlur}
              </div>
            )}
            {resolvedLineage.lineage.maskedContent && (
              <div className={detailClassName}>
                Masked content: {resolvedLineage.lineage.maskedContent}
              </div>
            )}
            {resolvedLineage.lineage.resizeMode && (
              <div className={detailClassName}>
                Resize mode: {resolvedLineage.lineage.resizeMode}
              </div>
            )}
          </div>

          {resolvedLineage.sourceImage ? (
            <LineagePreviewCard
              image={resolvedLineage.sourceImage}
              label="Source Image"
              onOpenImage={onOpenImage}
            />
          ) : (
            <div className="rounded-md border border-dashed border-gray-300 bg-white/70 px-3 py-2 text-sm text-gray-600 dark:border-gray-600 dark:bg-gray-900/30 dark:text-gray-300">
              {getLineageStatusMessage(resolvedLineage)}
              {sourceReferenceName && (
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Reference: {sourceReferenceName}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {derivedImages.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Derived Images
          </div>
          <div className="grid gap-2">
            {derivedImages.map((derivedImage) => (
              <LineagePreviewCard
                key={derivedImage.id}
                image={derivedImage}
                label="Derived Image"
                onOpenImage={onOpenImage}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageLineageSection;

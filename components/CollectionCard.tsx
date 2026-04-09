import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, Sparkles } from 'lucide-react';
import { IndexedImage, SmartCollection } from '../types';
import { useThumbnail } from '../hooks/useThumbnail';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';

interface CollectionCardProps {
  collection: SmartCollection;
  images: IndexedImage[];
  imageCount: number;
  onClick: () => void;
}

const CollectionCard: React.FC<CollectionCardProps> = ({
  collection,
  images,
  imageCount,
  onClick,
}) => {
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const rafRef = useRef<number | null>(null);
  const pendingIndexRef = useRef(0);

  const previewImage = images[previewIndex] ?? images[0] ?? null;
  const thumbnail = useResolvedThumbnail(previewImage);
  useThumbnail(previewImage);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const updatePreviewIndex = (nextIndex: number) => {
    pendingIndexRef.current = nextIndex;
    if (rafRef.current !== null) {
      return;
    }

    rafRef.current = requestAnimationFrame(() => {
      setPreviewIndex(pendingIndexRef.current);
      rafRef.current = null;
    });
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!cardRef.current || images.length < 2) {
      return;
    }

    const rect = cardRef.current.getBoundingClientRect();
    const relativeX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const ratio = rect.width > 0 ? relativeX / rect.width : 0;
    const index = Math.floor(ratio * (images.length - 1));
    updatePreviewIndex(index);
  };

  const handlePointerLeave = () => {
    updatePreviewIndex(0);
  };

  const coverUrl = thumbnail?.thumbnailUrl || '';
  const description = collection.description?.trim() || null;
  const autoAddLabel = collection.sourceTag
    ? collection.autoUpdate !== false
      ? `Auto-add: ${collection.sourceTag}`
      : `Linked tag: ${collection.sourceTag}`
    : null;

  return (
    <button
      ref={cardRef}
      type="button"
      aria-label={`Open collection ${collection.name}`}
      onClick={onClick}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="group overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/60 text-left shadow-lg transition-all hover:border-blue-500/30 hover:shadow-xl hover:shadow-blue-500/20"
    >
      <div className="relative aspect-[4/5] overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={collection.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800 text-gray-500">
            <FolderOpen className="h-8 w-8 opacity-70" />
          </div>
        )}

        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-gray-100">
          <FolderOpen className="h-3.5 w-3.5" />
          {imageCount}
        </div>

        {collection.sourceTag && (
          <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
            <Sparkles className="h-3.5 w-3.5" />
            {collection.autoUpdate !== false ? 'Auto' : 'Linked'}
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />

        {images.length > 1 && (
          <div className="absolute bottom-3 left-3 right-3 z-10 h-1 overflow-hidden rounded-full bg-black/40">
            <div
              className="h-full bg-blue-400/80 transition-all duration-100"
              style={{
                width: images.length > 1 ? `${(previewIndex / (images.length - 1)) * 100}%` : '0%',
              }}
            />
          </div>
        )}
      </div>

      <div className="p-4">
        <p className="truncate text-sm font-semibold text-gray-100" title={collection.name}>
          {collection.name}
        </p>
        {description && (
          <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs text-gray-400">
            {description}
          </p>
        )}
        {!description && (
          <p className="mt-1 min-h-[2.5rem] text-xs text-gray-500">
            {imageCount} image{imageCount !== 1 ? 's' : ''}
          </p>
        )}
        {autoAddLabel && (
          <p className="mt-2 truncate text-[11px] uppercase tracking-wide text-gray-500">
            {autoAddLabel}
          </p>
        )}
      </div>
    </button>
  );
};

export default CollectionCard;

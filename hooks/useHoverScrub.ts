import React, { useEffect, useRef, useState } from 'react';
import type { IndexedImage } from '../types';
import { useThumbnail } from './useThumbnail';
import { useResolvedThumbnail } from './useResolvedThumbnail';

export interface HoverScrubResult {
  /** Attach to the card button; used to map the cursor X position to a preview index. */
  cardRef: React.RefObject<HTMLButtonElement | null>;
  /** The image currently shown as the cover (scrubs with the cursor). */
  previewImage: IndexedImage | null;
  /** Resolved thumbnail URL for previewImage, or '' when not ready. */
  coverUrl: string;
  /** 0..1 scrub position, for the progress bar. */
  progress: number;
  /** True when there is more than one image (so a progress bar is worth showing). */
  hasMultiple: boolean;
  handlePointerMove: (event: React.PointerEvent) => void;
  handlePointerLeave: () => void;
}

/**
 * Cover-image hover-scrub shared by the scope cards (models / clusters / collections):
 * moving the cursor across the card maps to an image index, throttled to one
 * requestAnimationFrame per frame. Also warms the thumbnail for the current preview.
 */
export function useHoverScrub(images: IndexedImage[]): HoverScrubResult {
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

  const hasMultiple = images.length > 1;

  return {
    cardRef,
    previewImage,
    coverUrl: thumbnail?.thumbnailUrl || '',
    progress: hasMultiple ? previewIndex / (images.length - 1) : 0,
    hasMultiple,
    handlePointerMove,
    handlePointerLeave,
  };
}

import { useMemo, useCallback } from 'react';
import { useImageStore } from '../store/useImageStore';
import { useFeatureAccess } from './useFeatureAccess';
import { IndexedImage } from '../types';

export const comparisonWillAutoOpen = (comparisonCount: number) => comparisonCount + 1 >= 2;

export const useImageComparison = () => {
  const {
    comparisonImages,
    setComparisonImages,
    addImageToComparison,
    removeImageFromComparison,
    swapComparisonImages,
    clearComparison,
    openComparisonModal
  } = useImageStore();

  // Feature access check
  const { canUseComparison, showProModal } = useFeatureAccess();

  const canCompare = useMemo(() => {
    return comparisonImages.length >= 2;
  }, [comparisonImages]);

  const comparisonCount = useMemo(() => {
    return comparisonImages.length;
  }, [comparisonImages]);

  const handleAddImage = useCallback((image: IndexedImage) => {
    // Safety check: Feature gating
    if (!canUseComparison) {
      showProModal('comparison');
      return false;
    }

    if (comparisonCount >= 4) {
      alert('Maximum 4 images can be compared. Remove one first.');
      return false;
    }

    // Check if image already in comparison
    if (comparisonImages.some(img => img.id === image.id)) {
      alert('This image is already in comparison');
      return false;
    }

    addImageToComparison(image);

    // Open comparison as soon as we have at least two images queued
    if (comparisonWillAutoOpen(comparisonCount)) {
      openComparisonModal();
    }

    return true;
  }, [comparisonImages, comparisonCount, addImageToComparison, openComparisonModal, canUseComparison, showProModal]);

  const handleStartComparison = useCallback((images: IndexedImage[]) => {
    if (images.length < 2 || images.length > 4) {
      alert('Please select between 2 and 4 images to compare');
      return false;
    }

    setComparisonImages(images);
    openComparisonModal();
    return true;
  }, [setComparisonImages, openComparisonModal]);

  return {
    comparisonImages,
    canCompare,
    comparisonCount,
    addImage: handleAddImage,
    removeImage: removeImageFromComparison,
    swapImages: swapComparisonImages,
    clearComparison,
    startComparison: handleStartComparison
  };
};

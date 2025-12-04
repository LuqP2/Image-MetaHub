import { useMemo, useCallback } from 'react';
import { useImageStore } from '../store/useImageStore';
import { useFeatureAccess } from './useFeatureAccess';
import { IndexedImage } from '../types';

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
    return comparisonImages[0] !== null && comparisonImages[1] !== null;
  }, [comparisonImages]);

  const comparisonCount = useMemo(() => {
    return comparisonImages.filter(img => img !== null).length;
  }, [comparisonImages]);

  const handleAddImage = useCallback((image: IndexedImage) => {
    // Safety check: Feature gating
    if (!canUseComparison) {
      showProModal('comparison');
      return false;
    }

    if (comparisonCount >= 2) {
      alert('Maximum 2 images can be compared. Remove one first.');
      return false;
    }

    // Check if image already in comparison
    if (comparisonImages.some(img => img?.id === image.id)) {
      alert('This image is already in comparison');
      return false;
    }

    addImageToComparison(image);

    // If we now have 2 images, open modal
    if (comparisonCount === 1) {
      openComparisonModal();
    }

    return true;
  }, [comparisonImages, comparisonCount, addImageToComparison, openComparisonModal, canUseComparison, showProModal]);

  const handleStartComparison = useCallback((images: IndexedImage[]) => {
    if (images.length !== 2) {
      alert('Please select exactly 2 images to compare');
      return false;
    }

    setComparisonImages([images[0], images[1]]);
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

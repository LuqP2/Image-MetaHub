import { useTranslation } from '../i18n/useTranslation';
import { useMemo, useCallback } from 'react';
import { useImageStore } from '../store/useImageStore';
import { useFeatureAccess } from './useFeatureAccess';
import { IndexedImage } from '../types';

export const comparisonWillAutoOpen = (comparisonCount: number) => comparisonCount + 1 >= 2;

export const useImageComparison = () => {
  const { t } = useTranslation();
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
      alert(t('comparison.alerts.limit'));
      return false;
    }

    // Check if image already in comparison
    if (comparisonImages.some(img => img.id === image.id)) {
      alert(t('comparison.alerts.duplicate'));
      return false;
    }

    addImageToComparison(image);

    // Open comparison as soon as we have at least two images queued
    if (comparisonWillAutoOpen(comparisonCount)) {
      openComparisonModal();
    }

    return true;
  }, [comparisonImages, comparisonCount, addImageToComparison, openComparisonModal, canUseComparison, showProModal, t]);

  const handleStartComparison = useCallback((images: IndexedImage[]) => {
    if (images.length < 2 || images.length > 4) {
      alert(t('comparison.alerts.selection'));
      return false;
    }

    setComparisonImages(images);
    openComparisonModal();
    return true;
  }, [setComparisonImages, openComparisonModal, t]);

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

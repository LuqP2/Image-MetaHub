import { useMemo } from 'react';
import { IndexedImage, ImageStack } from '../types';

interface UseImageStackingResult {
  stackedItems: (IndexedImage | ImageStack)[];
  isStackingEnabled: boolean;
}

export const useImageStacking = (
  images: IndexedImage[],
  isEnabled: boolean
): UseImageStackingResult => {
  const stackedItems = useMemo(() => {
    if (!isEnabled || images.length === 0) {
      return images;
    }

    const result: (IndexedImage | ImageStack)[] = [];
    let currentStack: IndexedImage[] = [];

    // Local variables to cache current stack prompt state
    let currentStackPos = '';
    let currentStackNeg = '';

    for (let i = 0; i < images.length; i++) {
      const currentImage = images[i];
      
      // Inline prompt extraction
      const pos = currentImage.metadata?.normalizedMetadata?.prompt || currentImage.metadata?.positive_prompt || '';
      const neg = currentImage.metadata?.normalizedMetadata?.negativePrompt || currentImage.metadata?.negative_prompt || '';

      // If we have a current stack, check if current image belongs to it
      if (currentStack.length > 0) {
        // Compare directly to cached stack prompt components
        // Logic: key1 !== '|' ensures we don't stack empty prompts aggressively
        if (pos === currentStackPos && neg === currentStackNeg && (pos !== '' || neg !== '')) {
          currentStack.push(currentImage);
        } else {
          // Stack broken, push current stack to result
          if (currentStack.length === 1) {
            result.push(currentStack[0]);
          } else {
            result.push({
              id: `stack-${currentStack[0].id}`,
              coverImage: currentStack[0],
              images: [...currentStack],
              count: currentStack.length
            });
          }
          // Start new stack with current image and update cache
          currentStack = [currentImage];
          currentStackPos = pos;
          currentStackNeg = neg;
        }
      } else {
        // Start first stack and update cache
        currentStack = [currentImage];
        currentStackPos = pos;
        currentStackNeg = neg;
      }
    }

    // Push remaining stack
    if (currentStack.length > 0) {
      if (currentStack.length === 1) {
        result.push(currentStack[0]);
      } else {
        result.push({
          id: `stack-${currentStack[0].id}`,
          coverImage: currentStack[0],
          images: [...currentStack],
          count: currentStack.length
        });
      }
    }

    return result;
  }, [images, isEnabled]);

  return {
    stackedItems,
    isStackingEnabled: isEnabled
  };
};

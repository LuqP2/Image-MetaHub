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

    const getPromptKey = (image: IndexedImage) => {
      // Use efficient key generation
      // We need to handle potential undefined metadata values
      const pos = image.metadata?.normalizedMetadata?.prompt || image.metadata?.positive_prompt || '';
      const neg = image.metadata?.normalizedMetadata?.negativePrompt || image.metadata?.negative_prompt || '';
      return `${pos}|${neg}`;
    };

    for (let i = 0; i < images.length; i++) {
      const currentImage = images[i];
      
      // If we have a current stack, check if current image belongs to it
      if (currentStack.length > 0) {
        const firstInStack = currentStack[0];
        const key1 = getPromptKey(firstInStack);
        const key2 = getPromptKey(currentImage);

        if (key1 === key2 && key1 !== '|') { // Ensure we don't stack empty prompts aggressively
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
          // Start new stack with current image
          currentStack = [currentImage];
        }
      } else {
        // Start new stack
        currentStack = [currentImage];
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

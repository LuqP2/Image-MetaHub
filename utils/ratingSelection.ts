export const getBulkRatingTargetIds = (selectedImages: Set<string>): string[] => {
  return Array.from(selectedImages);
};

export const getContextMenuRatingTargetIds = (
  selectedImages: Set<string>,
  contextImageId?: string | null,
): string[] => {
  if (!contextImageId) {
    return [];
  }

  if (selectedImages.has(contextImageId)) {
    return Array.from(selectedImages);
  }

  return [contextImageId];
};

export const resolveNavigationAfterDeletion = (
  navigationImageIds: string[],
  deletedImageId: string,
  fallbackNavigationImageIds: string[] = [],
): { navigationImageIds: string[]; nextImageId: string | null } => {
  const sourceImageIds = navigationImageIds.includes(deletedImageId)
    ? navigationImageIds
    : fallbackNavigationImageIds.includes(deletedImageId)
      ? fallbackNavigationImageIds
      : navigationImageIds;
  const deletedIndex = sourceImageIds.indexOf(deletedImageId);
  const remaining = sourceImageIds.filter((imageId) => imageId !== deletedImageId);

  if (remaining.length === 0 || deletedIndex < 0) {
    return { navigationImageIds: remaining, nextImageId: null };
  }

  return {
    navigationImageIds: remaining,
    nextImageId: remaining[Math.min(deletedIndex, remaining.length - 1)] ?? null,
  };
};

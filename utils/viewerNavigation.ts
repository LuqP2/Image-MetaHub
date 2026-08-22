export const resolveNavigationAfterDeletion = (
  navigationImageIds: string[],
  deletedImageId: string,
): { navigationImageIds: string[]; nextImageId: string | null } => {
  const deletedIndex = navigationImageIds.indexOf(deletedImageId);
  const remaining = navigationImageIds.filter((imageId) => imageId !== deletedImageId);

  if (remaining.length === 0 || deletedIndex < 0) {
    return { navigationImageIds: remaining, nextImageId: null };
  }

  return {
    navigationImageIds: remaining,
    nextImageId: remaining[Math.min(deletedIndex, remaining.length - 1)] ?? null,
  };
};

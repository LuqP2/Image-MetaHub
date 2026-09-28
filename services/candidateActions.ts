export const REJECTED_TAG = 'rejected';

interface ToggleRejectedOptions {
  ids: string[];
  isRejected: (id: string) => boolean;
  canUseBulkTagging: boolean;
  onBulkTaggingBlocked: () => void;
  addTag: (ids: string[], tag: string) => void | Promise<unknown>;
  removeTag: (ids: string[], tag: string) => void | Promise<unknown>;
}

export const toggleRejectedCandidates = ({
  ids, isRejected, canUseBulkTagging, onBulkTaggingBlocked, addTag, removeTag,
}: ToggleRejectedOptions): boolean => {
  const targets = [...new Set(ids)];
  if (targets.length === 0) return false;
  if (targets.length > 1 && !canUseBulkTagging) {
    onBulkTaggingBlocked();
    return false;
  }

  const operation = targets.every(isRejected) ? removeTag : addTag;
  void operation(targets, REJECTED_TAG);
  return true;
};

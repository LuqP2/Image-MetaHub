export const normalizeFilesystemPath = (value: string): string =>
  value.replace(/\\/g, '/').replace(/\/+$/, '');

const getCurrentPlatform = (): string =>
  typeof navigator !== 'undefined' ? navigator.platform : '';

export const getFilesystemPathComparisonKey = (
  value: string,
  platform: string = getCurrentPlatform(),
): string => {
  const normalized = normalizeFilesystemPath(value);
  return /^win/i.test(platform) ? normalized.toLowerCase() : normalized;
};

export const areFilesystemPathsEqual = (
  left: string,
  right: string,
  platform: string = getCurrentPlatform(),
): boolean =>
  getFilesystemPathComparisonKey(left, platform) === getFilesystemPathComparisonKey(right, platform);

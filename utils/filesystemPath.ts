export const normalizeFilesystemPath = (value: string): string => {
  const normalized = value.replace(/\\/g, '/');
  if (normalized === '/' || /^[a-zA-Z]:\/$/.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/\/+$/, '');
};

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

export const isFilesystemPathWithinDirectory = (
  filePath: string,
  directoryPath: string,
  platform: string = getCurrentPlatform(),
): boolean => {
  const fileKey = getFilesystemPathComparisonKey(filePath, platform);
  const directoryKey = getFilesystemPathComparisonKey(directoryPath, platform);
  const prefix = directoryKey.endsWith('/') ? directoryKey : `${directoryKey}/`;
  return fileKey === directoryKey || fileKey.startsWith(prefix);
};

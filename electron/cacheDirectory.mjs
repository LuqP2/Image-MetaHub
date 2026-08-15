import path from 'node:path';

export async function openAuthorizedCacheDirectory({
  getCacheRootPath,
  fsApi,
  shellApi,
}) {
  const configuredPath = await getCacheRootPath();
  if (typeof configuredPath !== 'string' || configuredPath.trim().length === 0) {
    throw new Error('Configured cache path is unavailable.');
  }

  const normalizedCachePath = path.normalize(configuredPath);
  const stats = await fsApi.stat(normalizedCachePath);
  if (!stats.isDirectory()) {
    throw new Error('Configured cache path is not a directory.');
  }

  const openError = await shellApi.openPath(normalizedCachePath);
  if (openError) {
    throw new Error(openError);
  }

  return normalizedCachePath;
}

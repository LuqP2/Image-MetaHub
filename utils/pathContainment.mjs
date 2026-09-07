import path from 'node:path';

export function pathApiForPlatform(platform = process.platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

export function isRelativePathInsideRoot(relativePath, platform = process.platform) {
  const pathApi = pathApiForPlatform(platform);
  const parentPrefixes = platform === 'win32' ? ['..\\', '../'] : ['../'];
  return relativePath !== '..'
    && !parentPrefixes.some((prefix) => relativePath.startsWith(prefix))
    && !pathApi.isAbsolute(relativePath);
}

import path from 'path';

export function normalizeModelLibraryPath(inputPath, platform = process.platform) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) return '';
  const pathApi = platform === 'win32' ? path.win32 : path;
  const resolvedPath = pathApi.resolve(inputPath);
  const parsedPath = pathApi.parse(resolvedPath);
  const normalizedPath = resolvedPath === parsedPath.root
    ? resolvedPath
    : resolvedPath.replace(/[\\/]+$/, '');
  return platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

export function isModelLibraryPathWithinRoots(filePath, rootPaths, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  const candidate = normalizeModelLibraryPath(filePath, platform);
  if (!candidate) return false;
  for (const rootPath of rootPaths ?? []) {
    const root = normalizeModelLibraryPath(rootPath, platform);
    if (!root) continue;
    if (candidate === root || candidate.startsWith(root.endsWith(pathApi.sep) ? root : `${root}${pathApi.sep}`)) {
      return true;
    }
  }
  return false;
}

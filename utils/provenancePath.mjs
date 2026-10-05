function runtimePlatform() {
  if (typeof process !== 'undefined' && typeof process.platform === 'string') return process.platform;
  if (typeof navigator !== 'undefined' && typeof navigator.platform === 'string') return navigator.platform;
  return '';
}

export function normalizeRelativeCatalogPath(relativePath, platform = runtimePlatform()) {
  if (typeof relativePath !== 'string' || !relativePath.trim() || relativePath.includes('\0')) {
    throw new Error('A non-empty relative file path is required.');
  }

  const slashPath = relativePath.replace(/\\/g, '/');
  if (slashPath.startsWith('/') || /^[a-zA-Z]:\//.test(slashPath)) {
    throw new Error(`Path must remain inside its library root: ${relativePath}`);
  }

  const segments = [];
  for (const segment of slashPath.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) throw new Error(`Path must remain inside its library root: ${relativePath}`);
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const normalized = segments.join('/');
  if (!normalized || normalized.startsWith('/')) {
    throw new Error(`Path must remain inside its library root: ${relativePath}`);
  }
  return {
    relativePath: normalized,
    relativePathKey: /^win/i.test(platform) ? normalized.toLocaleLowerCase('en-US') : normalized,
  };
}

export function getRelativeCatalogPathComparisonKey(relativePath, platform = runtimePlatform()) {
  return normalizeRelativeCatalogPath(relativePath, platform).relativePathKey;
}

export function buildProvenanceIdentityLookupKey(directoryId, relativePath, platform = runtimePlatform()) {
  return `${directoryId}\0${getRelativeCatalogPathComparisonKey(relativePath, platform)}`;
}

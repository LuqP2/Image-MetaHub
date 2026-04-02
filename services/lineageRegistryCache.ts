import type { LineageRegistrySnapshot } from './lineageRegistry';
import { LINEAGE_REGISTRY_SCHEMA_VERSION } from './lineageRegistry';

const LINEAGE_CACHE_NAMESPACE = 'lineage-registry';

const hashString = (value: string): string => {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(16);
};

const buildCacheId = (directoryPaths: string[], scanSubfolders: boolean): string => {
  const normalizedPaths = [...directoryPaths]
    .map((path) => path.replace(/\\/g, '/').replace(/[\\/]+$/, '').toLowerCase())
    .sort();

  return `${LINEAGE_CACHE_NAMESPACE}-${scanSubfolders ? 'recursive' : 'flat'}-${hashString(normalizedPaths.join('|'))}`;
};

const canUseElectronCache = (): boolean =>
  typeof window !== 'undefined' && !!window.electronAPI?.cacheData && !!window.electronAPI?.getCachedData;

export const loadLineageRegistrySnapshot = async (
  directoryPaths: string[],
  scanSubfolders: boolean,
  expectedLibrarySignature: string
): Promise<LineageRegistrySnapshot | null> => {
  if (!canUseElectronCache() || directoryPaths.length === 0) {
    return null;
  }

  const cacheId = buildCacheId(directoryPaths, scanSubfolders);
  const result = await window.electronAPI!.getCachedData(cacheId);

  if (!result.success || !result.data) {
    return null;
  }

  const snapshot = result.data as LineageRegistrySnapshot;
  if (!snapshot || snapshot.schemaVersion !== LINEAGE_REGISTRY_SCHEMA_VERSION) {
    return null;
  }

  if (snapshot.librarySignature !== expectedLibrarySignature) {
    return null;
  }

  return snapshot;
};

export const saveLineageRegistrySnapshot = async (
  directoryPaths: string[],
  scanSubfolders: boolean,
  snapshot: LineageRegistrySnapshot
): Promise<void> => {
  if (!canUseElectronCache() || directoryPaths.length === 0) {
    return;
  }

  const cacheId = buildCacheId(directoryPaths, scanSubfolders);
  const result = await window.electronAPI!.cacheData({
    cacheId,
    data: snapshot,
  });

  if (!result.success) {
    console.error('Failed to persist lineage registry snapshot:', result.error);
  }
};

export const clearLineageRegistrySnapshot = async (
  directoryPaths: string[],
  scanSubfolders: boolean
): Promise<void> => {
  if (!canUseElectronCache() || directoryPaths.length === 0) {
    return;
  }

  const cacheId = buildCacheId(directoryPaths, scanSubfolders);
  const result = await window.electronAPI!.clearCacheData(cacheId);

  if (!result.success) {
    console.error('Failed to clear lineage registry snapshot:', result.error);
  }
};

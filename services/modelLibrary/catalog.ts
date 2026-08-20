import type { ManagedModel, ModelCatalog, ModelLocation, ModelSource, ModelSourceScanResult } from './types';

export const EMPTY_MODEL_CATALOG: ModelCatalog = { version: 1, locations: [], updatedAt: 0 };

export function buildManagedModels(locations: ModelLocation[]): ManagedModel[] {
  const byHash = new Map<string, string[]>();
  for (const location of locations) {
    if (!location.sha256) continue;
    const ids = byHash.get(location.sha256) ?? [];
    ids.push(location.id);
    byHash.set(location.sha256, ids);
  }
  return [...byHash.entries()].map(([sha256, locationIds]) => ({ id: `sha256:${sha256}`, sha256, locationIds }));
}

export function reconcileModelCatalog(
  current: ModelCatalog,
  sources: ModelSource[],
  scanResults: ModelSourceScanResult[],
  now = Date.now(),
): ModelCatalog {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const priorById = new Map(current.locations.map((location) => [location.id, location]));
  const failedSourceIds = new Set(scanResults.filter((result) => result.error).map((result) => result.sourceId));
  const next: ModelLocation[] = current.locations.filter((location) =>
    sourceById.has(location.sourceId) && failedSourceIds.has(location.sourceId),
  );

  for (const result of scanResults) {
    const source = sourceById.get(result.sourceId);
    if (!source || result.error) continue;
    for (const scanned of result.locations) {
      const id = `${source.id}:${scanned.relativePath.toLocaleLowerCase()}`;
      const previous = priorById.get(id);
      next.push({
        ...scanned,
        id,
        sourceId: source.id,
        sourceKind: source.kind,
        sourceName: source.name,
        discoveredAt: previous?.discoveredAt ?? now,
        lastSeenAt: now,
        ...(previous?.size === scanned.size && previous?.modifiedAt === scanned.modifiedAt
          ? { fileMetadata: previous.fileMetadata, sha256: previous.sha256, hashFingerprint: previous.hashFingerprint }
          : {}),
      });
    }
  }
  const locations = next.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return { version: 1, locations, managedModels: buildManagedModels(locations), updatedAt: now };
}

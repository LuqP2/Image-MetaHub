import type { ModelCatalog, ModelLocation, ModelSource, ModelSourceScanResult } from './types';

export const EMPTY_MODEL_CATALOG: ModelCatalog = { version: 1, locations: [], updatedAt: 0 };

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
      });
    }
  }
  return { version: 1, locations: next.sort((a, b) => a.fileName.localeCompare(b.fileName)), updatedAt: now };
}

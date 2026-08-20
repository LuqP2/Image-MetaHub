import type { ManagedModel, ModelCatalog, ModelLocation, ModelSource, ModelSourceScanResult } from './types';

export const EMPTY_MODEL_CATALOG: ModelCatalog = { version: 1, locations: [], updatedAt: 0 };
export const MODEL_CATALOG_CACHE_ID = 'model-library-catalog-v1';

export function validModelCatalog(value: unknown): ModelCatalog {
  if (!value || typeof value !== 'object' || !Array.isArray((value as ModelCatalog).locations)) {
    return EMPTY_MODEL_CATALOG;
  }
  const catalog = value as ModelCatalog;
  const locations = catalog.locations;
  return {
    version: 1,
    locations,
    managedModels: buildManagedModels(locations),
    updatedAt: catalog.updatedAt || 0,
  };
}

export function replaceCatalogLocation(catalog: ModelCatalog, update: ModelLocation): ModelCatalog {
  if (!catalog.locations.some((location) => location.id === update.id)) return catalog;
  const locations = catalog.locations.map((location) => location.id === update.id ? update : location);
  return { ...catalog, locations, managedModels: buildManagedModels(locations), updatedAt: Date.now() };
}

export function buildManagedModels(locations: ModelLocation[]): ManagedModel[] {
  const byIdentity = new Map<string, { sha256?: string; locationIds: string[] }>();
  for (const location of locations) {
    const sha256 = location.sha256?.toLowerCase();
    const identity = sha256 ? `sha256:${sha256}` : `location:${location.id}`;
    const entry = byIdentity.get(identity) ?? { sha256, locationIds: [] };
    entry.locationIds.push(location.id);
    byIdentity.set(identity, entry);
  }
  return [...byIdentity.entries()].map(([id, entry]) => ({
    id,
    sha256: entry.sha256,
    primaryLocationId: entry.locationIds[0],
    locationIds: entry.locationIds,
  }));
}

export function getManagedModelPrimaryLocations(catalog: ModelCatalog): ModelLocation[] {
  const locationById = new Map(catalog.locations.map((location) => [location.id, location]));
  const managedModels = catalog.managedModels?.length ? catalog.managedModels : buildManagedModels(catalog.locations);
  return managedModels
    .map((model) => locationById.get(model.primaryLocationId ?? model.locationIds[0]))
    .filter((location): location is ModelLocation => Boolean(location));
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
          ? {
              fileMetadata: previous.fileMetadata,
              sha256: previous.sha256,
              hashFingerprint: previous.hashFingerprint,
              civitai: previous.civitai,
            }
          : {}),
      });
    }
  }
  const locations = next.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return { version: 1, locations, managedModels: buildManagedModels(locations), updatedAt: now };
}

import type { ModelLocation, ModelManagerSnapshot, ModelStorageFile } from './types';

export const formatModelBytes = (size: number) => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(1)} GB` : size >= 1024 ** 2 ? `${(size / 1024 ** 2).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`;
const identity = (file: ModelStorageFile) => file.physicalId ?? file.key;
export function duplicateCandidates(files: ModelStorageFile[]) {
  const bySize = new Map<number, ModelStorageFile[]>();
  for (const file of files) if (!file.stale && !file.error) {
    const entries = bySize.get(file.size) ?? [];
    entries.push(file); bySize.set(file.size, entries);
  }
  return [...bySize.values()].filter((entries) => new Set(entries.map(identity)).size > 1).flatMap((entries) => {
    const physical = new Map<string, ModelStorageFile>();
    for (const file of entries) if (!physical.get(identity(file))?.sha256) physical.set(identity(file), file);
    return [...physical.values()];
  });
}
export function confirmedCopyCounts(files: ModelStorageFile[]) {
  const copies = new Map<string, Set<string>>();
  for (const file of files) if (file.sha256 && !file.stale) {
    const hash = file.sha256.toLowerCase();
    const entries = copies.get(hash) ?? new Set<string>();
    entries.add(identity(file)); copies.set(hash, entries);
  }
  return new Map([...copies].map(([hash, entries]) => [hash, entries.size]));
}
export function confirmedCopies(file: ModelStorageFile, files: ModelStorageFile[], counts = confirmedCopyCounts(files)) {
  return file.sha256 && !file.stale ? counts.get(file.sha256.toLowerCase()) ?? 1 : 1;
}
export function storageUsage(file: ModelStorageFile, manager: ModelManagerSnapshot, locationsById?: ReadonlyMap<string, ModelLocation>) {
  if (file.stale) return undefined;
  const location = locationsById ? locationsById.get(file.locationIds[0]) : manager.catalog.locations.find((entry) => file.locationIds.includes(entry.id));
  return location ? manager.usage?.[file.sha256 ? `sha256:${file.sha256.toLowerCase()}` : `location:${location.id}`] : undefined;
}
export function storageSummary(files: ModelStorageFile[]) {
  const physical = new Map(files.map((file) => [identity(file), file.size]));
  const models = new Set(files.map((file) => file.sha256 && !file.stale ? `sha256:${file.sha256.toLowerCase()}` : identity(file)));
  return { totalBytes: [...physical.values()].reduce((sum, size) => sum + size, 0), modelCount: models.size, fileCount: physical.size, pathCount: files.length };
}

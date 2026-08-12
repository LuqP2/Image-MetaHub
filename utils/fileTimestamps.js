/**
 * Filesystem timestamp helpers shared by the Electron main process and the renderer.
 *
 * Some filesystems have no birth time to report and hand back 0 instead of
 * omitting it — SMB/CIFS mounts on Linux are the common case. A plain
 * `birthtimeMs ?? mtimeMs` fallback keeps that 0, because `??` only reacts to
 * null/undefined, and every affected file ends up dated 1970-01-01 UTC
 * (December 31, 1969 in negative offsets). Treat a non-positive or
 * non-finite timestamp as "not available" instead.
 */

export function isUsableTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Normalizes a raw `stats.birthtimeMs` into either a usable timestamp or
 * `undefined`, so downstream `??` fallbacks behave as intended.
 */
export function normalizeBirthtimeMs(value) {
  return isUsableTimestamp(value) ? value : undefined;
}

/**
 * Resolves the date used for sorting, date grouping and session grouping:
 * birth time when the filesystem reports one, modification time otherwise.
 */
export function resolveFileSortDate(birthtimeMs, modifiedMs, fallbackMs) {
  if (isUsableTimestamp(birthtimeMs)) return birthtimeMs;
  if (isUsableTimestamp(modifiedMs)) return modifiedMs;
  if (isUsableTimestamp(fallbackMs)) return fallbackMs;
  return Date.now();
}

/**
 * On-demand Civitai resolution for resource references, with a persistent local
 * cache. A reference resolves either by hash or by Civitai model version id.
 *
 * Local-first guarantees:
 * - No request is ever made except from an explicit user action (clicking a
 *   model/LoRA in the image modal). Nothing here runs during indexing.
 * - The request is performed in the Electron main process (a single, auditable
 *   egress point) — see the `civitai-lookup` IPC handler.
 * - Results are cached locally so a given ref is fetched at most once. Negative
 *   ("not on Civitai") results are cached with a TTL; transient failures (rate
 *   limit, 5xx, network errors) are NOT cached.
 */

import { refKey, type ResourceRef } from './resourceExtraction';

const CACHE_ID = 'civitai-hash-lookups';
/** Re-check "not found" refs after this long — a model may appear later. */
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface CivitaiHit {
  url: string;
  modelId: number;
  versionId: number;
}

export type LookupResult =
  | { status: 'found'; hit: CivitaiHit }
  | { status: 'notFound' }
  | { status: 'unavailable' };

type CacheEntry = CivitaiHit | { notFound: true; fetchedAt: number };
type CacheMap = Record<string, CacheEntry>;

let memoryCache: CacheMap | null = null;
const inFlight = new Map<string, Promise<LookupResult>>();

const canUseElectron = (): boolean =>
  typeof window !== 'undefined' && !!window.electronAPI?.civitaiLookup;

const canUseJsonCache = (): boolean =>
  typeof window !== 'undefined' &&
  !!window.electronAPI?.getJsonCacheData &&
  !!window.electronAPI?.writeJsonCacheData;

const buildUrl = (modelId: number, versionId: number): string =>
  `https://civitai.com/models/${modelId}?modelVersionId=${versionId}`;

async function loadCache(): Promise<CacheMap> {
  if (memoryCache) return memoryCache;
  if (!canUseJsonCache()) {
    memoryCache = {};
    return memoryCache;
  }
  try {
    const result = await window.electronAPI!.getJsonCacheData(CACHE_ID);
    memoryCache = result.success && result.data && typeof result.data === 'object' ? (result.data as CacheMap) : {};
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

async function persistCache(): Promise<void> {
  if (!canUseJsonCache() || !memoryCache) return;
  try {
    await window.electronAPI!.writeJsonCacheData({ cacheId: CACHE_ID, data: memoryCache });
  } catch {
    // Best-effort; a failure just means we re-fetch later.
  }
}

function entryToResult(entry: CacheEntry): LookupResult | null {
  if ('notFound' in entry) {
    if (Date.now() - entry.fetchedAt < NOT_FOUND_TTL_MS) {
      return { status: 'notFound' };
    }
    return null; // expired — treat as cache miss
  }
  return { status: 'found', hit: entry };
}

/**
 * Read-only cache probe. Used when the modal mounts so a resolved ref shows as a
 * ready link without any network request. Never triggers a lookup.
 */
export async function peekCachedRef(ref: ResourceRef): Promise<LookupResult | null> {
  const cache = await loadCache();
  const entry = cache[refKey(ref)];
  return entry ? entryToResult(entry) : null;
}

/**
 * Resolve a ref to a Civitai link, using the cache first and only hitting the
 * network on a miss. Safe to call concurrently for the same ref.
 */
export async function lookupRef(ref: ResourceRef): Promise<LookupResult> {
  const key = refKey(ref);

  const cached = await peekCachedRef(ref);
  if (cached) return cached;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = performLookup(ref, key).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function performLookup(ref: ResourceRef, key: string): Promise<LookupResult> {
  if (!canUseElectron()) {
    // Strictly Electron app; without the bridge we cannot reach Civitai.
    return { status: 'unavailable' };
  }

  let response;
  try {
    response = await window.electronAPI!.civitaiLookup(
      ref.hash ? { hash: ref.hash } : { versionId: ref.modelVersionId }
    );
  } catch {
    return { status: 'unavailable' };
  }

  const cache = await loadCache();

  if (response.status === 'found') {
    const hit: CivitaiHit = {
      url: buildUrl(response.modelId, response.versionId),
      modelId: response.modelId,
      versionId: response.versionId,
    };
    cache[key] = hit;
    await persistCache();
    return { status: 'found', hit };
  }

  if (response.status === 'notFound') {
    cache[key] = { notFound: true, fetchedAt: Date.now() };
    await persistCache();
    return { status: 'notFound' };
  }

  // 'unavailable' — transient. Do NOT cache, so a retry re-fetches.
  return { status: 'unavailable' };
}

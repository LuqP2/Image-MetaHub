import { recordPerformanceCounter } from '../utils/performanceDiagnostics';

type DecodeEntry = {
  element: HTMLImageElement;
  decoded: boolean;
  lastAccess: number;
  loading?: Promise<void>;
};

const MAX_DECODED_ENTRIES = 5;
const MAX_LOGGED_URL_CHARS = 96;

/**
 * A source can be a `data:` URL holding a whole base64 PNG, and diagnostics keep 2000 events plus
 * console-log every counter. Log something bounded that still identifies the entry.
 */
const describeUrl = (url: string): string =>
  url.length > MAX_LOGGED_URL_CHARS
    ? `${url.slice(0, MAX_LOGGED_URL_CHARS)}…(${url.length} chars)`
    : url;

/**
 * Keeps a handful of fully decoded bitmaps alive so swapping an <img> src can paint in the
 * same frame instead of paying for a protocol fetch plus a multi-megabyte PNG decode.
 *
 * Holding the HTMLImageElement reference is what keeps Chromium from dropping the decoded
 * copy, so entries stay in the map until they are pruned or the cache is cleared.
 *
 * This cache only knows about URLs. Resolving an image to a URL is the caller's job, which
 * keeps it usable for imh-media://, blob:, file: and data URLs alike.
 */
class MediaDecodeCache {
  private entries = new Map<string, DecodeEntry>();
  private retainCount = 0;

  /**
   * Several image modals can be open at once, so the cache is released by refcount: the last one
   * to close drops the bitmaps, and closing one window never blanks the warmth of another.
   */
  retain(): void {
    this.retainCount += 1;
  }

  release(): void {
    this.retainCount = Math.max(0, this.retainCount - 1);
    if (this.retainCount === 0) {
      this.clear();
    }
  }

  async warm(url: string): Promise<void> {
    if (!url) {
      return;
    }

    const existing = this.entries.get(url);

    if (existing?.decoded) {
      this.touch(url);
      recordPerformanceCounter('media-decode-cache.hit', { url: describeUrl(url) });
      return;
    }

    if (existing?.loading) {
      return existing.loading;
    }

    recordPerformanceCounter('media-decode-cache.miss', { url: describeUrl(url) });

    const element = new Image();
    element.decoding = 'async';

    // Registered before the decode starts: `decode()` can throw synchronously where it is not
    // implemented, and a catch that runs before the entry exists would leave a never-decoded
    // entry with a settled `loading` behind, permanently blocking any retry of this url.
    const entry: DecodeEntry = {
      element,
      decoded: false,
      lastAccess: Date.now(),
    };
    this.entries.set(url, entry);

    const loading = (async () => {
      try {
        element.src = url;
        await element.decode();

        // A clear() or a failed sibling may have dropped us while the decode was in flight.
        if (this.entries.get(url) !== entry) {
          this.destroyElement(element);
          return;
        }

        entry.decoded = true;
        entry.loading = undefined;
        entry.lastAccess = Date.now();
        this.prune();
      } catch (error) {
        if (this.entries.get(url) === entry) {
          this.entries.delete(url);
        }
        this.destroyElement(element);
        recordPerformanceCounter('media-decode-cache.warm-error', {
          url: describeUrl(url),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    entry.loading = loading;

    return loading;
  }

  /**
   * Synchronous and deliberately side-effect free: this runs during render, and touching the
   * LRU here would let frequent re-renders keep images alive long after the user moved past them.
   */
  isWarm(url: string): boolean {
    return this.entries.get(url)?.decoded === true;
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      this.destroyElement(entry.element);
    }
    this.entries.clear();
  }

  private touch(url: string): void {
    const entry = this.entries.get(url);
    if (entry) {
      entry.lastAccess = Date.now();
    }
  }

  private destroyElement(element: HTMLImageElement): void {
    element.onload = null;
    element.onerror = null;
    // Assigning '' would resolve against the document URL and fetch the renderer's own page as an
    // image; removing the attribute is what actually drops the source.
    element.removeAttribute('src');
  }

  private prune(): void {
    // In-flight decodes are never evicted: aborting one throws away exactly the work we want.
    // Serialized prefetching keeps at most one or two pending, so the overshoot is bounded.
    const sortedEntries = [...this.entries.entries()]
      .filter(([, entry]) => entry.decoded)
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

    let evictIndex = 0;
    while (sortedEntries.length - evictIndex > MAX_DECODED_ENTRIES) {
      const [url, entry] = sortedEntries[evictIndex++]!;
      this.entries.delete(url);
      this.destroyElement(entry.element);
      recordPerformanceCounter('media-decode-cache.evicted', {
        url: describeUrl(url),
        cacheSize: this.entries.size,
        maxCacheEntries: MAX_DECODED_ENTRIES,
      });
    }
  }
}

export const mediaDecodeCache = new MediaDecodeCache();

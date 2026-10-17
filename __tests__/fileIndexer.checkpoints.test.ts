import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncrementalCacheWriter, CacheImageMetadata } from '../services/cacheManager';

const originalApi = window.electronAPI;
afterEach(() => {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: originalApi });
  vi.restoreAllMocks();
  vi.resetModules();
});

// Synthetic PNG header + empty IEND. No user image or filesystem access.
function png() {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, 32);
  view.setUint32(20, 32);
  bytes.set([73, 69, 78, 68], 37);
  return bytes.buffer;
}

async function fixture(count = 6000) {
  const data = png();
  const entries = Array.from({ length: count }, (_, index) => ({
    path: `${index}.png`, lastModified: 1000, contentModifiedMs: 1000,
    size: data.byteLength, type: 'image/png',
    handle: { name: `${index}.png`, kind: 'file', _filePath: `/synthetic/${index}.png` } as unknown as FileSystemFileHandle,
  }));
  const read = vi.fn(async (paths: string[]) => ({
    success: true, files: paths.map(path => ({ path, success: true, data })),
  }));
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { readFilesBatch: read } });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.resetModules();
  const { processFiles } = await import('../services/fileIndexer');
  const disk = new Map<number, CacheImageMetadata[]>();
  let nextChunk = 0;
  const clone = (metadata: CacheImageMetadata[]) => JSON.parse(JSON.stringify(metadata));
  const overwrite = vi.fn(async (index: number, metadata: CacheImageMetadata[]) => { disk.set(index, clone(metadata)); });
  const writer = {
    targetChunkSize: 512,
    append: vi.fn(async (_images, metadata) => { disk.set(nextChunk++, clone(metadata)); return metadata; }),
    finalize: vi.fn(async () => {}), overwrite,
  } as unknown as IncrementalCacheWriter;
  const run = (signal?: AbortSignal, options = {}) => processFiles(
    entries, () => {}, () => {}, 'synthetic', 'Synthetic', true, () => {}, signal, undefined,
    { cacheWriter: writer, ...options },
  );
  return { entries, disk, writer, overwrite, run, read, processFiles };
}

describe('Phase B interruption and resume integration', () => {
  it('retains an intermediate checkpoint after failure and only queues pending/modified entries on reload', async () => {
    const f = await fixture();
    // Checkpoint #1 writes chunks 0 and 1. Fail at the next checkpoint.
    f.overwrite.mockImplementationOnce(async (index, metadata) => { f.disk.set(index, JSON.parse(JSON.stringify(metadata))); })
      .mockImplementationOnce(async (index, metadata) => { f.disk.set(index, JSON.parse(JSON.stringify(metadata))); })
      .mockRejectedValueOnce(new Error('synthetic disk failure'));
    const { phaseB } = await f.run();
    await expect(phaseB).rejects.toThrow('synthetic disk failure');
    const persisted = [...f.disk.values()].flat();
    expect(persisted.filter(image => image.enrichmentState === 'enriched')).toHaveLength(1000);
    expect(f.read).toHaveBeenCalledTimes(32); // stops at the 2000-result checkpoint's batch

    const { cacheManager } = await import('../services/cacheManager');
    (cacheManager as unknown as { isElectron: boolean }).isElectron = true;
    vi.spyOn(cacheManager, 'getCacheSummary').mockResolvedValue({
      id: 'synthetic', directoryPath: 'synthetic', directoryName: 'Synthetic',
      lastScan: 1000, imageCount: 6000, chunkCount: f.disk.size, parserVersion: 7,
    });
    vi.spyOn(cacheManager, 'iterateCachedMetadata').mockImplementation(async (_path, _recursive, onChunk) => {
      for (const chunk of f.disk.values()) await onChunk(chunk);
    });
    const files = f.entries.map(entry => ({
      name: entry.path, lastModified: entry.lastModified,
      contentModifiedMs: entry.path === '0.png' ? 2000 : 1000,
      size: entry.size, type: entry.type,
    }));
    const diff = await cacheManager.validateCacheAndGetDiff('synthetic', 'Synthetic', files, true);
    expect(diff.cachedImages).toHaveLength(999);
    expect(diff.newAndModifiedFiles).toHaveLength(5001);
    const pendingNames = new Set(diff.newAndModifiedFiles.map(file => file.name));
    expect(pendingNames.has('0.png')).toBe(true);
    expect(pendingNames.has('1.png')).toBe(false);
    f.read.mockClear();
    const resumed = await f.processFiles(
      f.entries.filter(entry => pendingNames.has(entry.path)), () => {}, () => {},
      'synthetic', 'Synthetic', true, () => {}, undefined, undefined,
      { preloadedImages: diff.cachedImages },
    );
    await resumed.phaseB;
    const readPaths = f.read.mock.calls.flatMap(([paths]) => paths);
    expect(readPaths).toHaveLength(5001);
    expect(readPaths).not.toContain('/synthetic/1.png');
  }, 20_000);

  it('flushes completed work on cancellation and does not read subsequent batches', async () => {
    const f = await fixture(401);
    const controller = new AbortController();
    const { phaseB } = await f.run(controller.signal, {
      enrichmentBatchSize: 10,
      onEnrichmentBatch: () => controller.abort(),
    });
    await phaseB;
    expect(f.read).toHaveBeenCalledTimes(1);
    const enriched = [...f.disk.values()].flat().filter(image => image.enrichmentState === 'enriched');
    expect(enriched.length).toBeGreaterThan(0);
    expect(enriched.length).toBeLessThan(401);
    expect(f.overwrite).toHaveBeenCalled();
  });

  it('saves the last partial batch on normal completion', async () => {
    const f = await fixture(417);
    const { phaseB } = await f.run();
    await phaseB;
    expect([...f.disk.values()].flat().every(image => image.enrichmentState === 'enriched')).toBe(true);
    expect(f.overwrite).toHaveBeenCalledTimes(1);
  });
});

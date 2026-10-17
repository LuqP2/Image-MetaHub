// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IncrementalCacheWriter, type CacheImageMetadata } from '../services/cacheManager';
import { createEnrichmentCheckpoints } from '../services/enrichmentCheckpoints';
import { createAtomicCacheChunkWriter } from '../electron/atomicCacheChunk.mjs';

const scratch: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const directory of scratch.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

function largeChunk(prefix: string): CacheImageMetadata[] {
  // 1024 synthetic records, approximately 57 MB of JSON, matching the reported
  // payload scale. Repeated prompt text is intentional; no real metadata is read.
  const metadata = { normalizedMetadata: { prompt: 'x'.repeat(28_000) } };
  const metadataString = JSON.stringify(metadata);
  return Array.from({ length: 1024 }, (_, index) => ({
    id: `synthetic::${prefix}-${index}.png`, name: `${prefix}-${index}.png`,
    metadata, metadataString, lastModified: 1, models: [], loras: [], scheduler: '',
    enrichmentState: 'catalog',
  }));
}

async function directory() {
  const result = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-595-large-test-'));
  scratch.push(result);
  return result;
}

describe('50-60 MB enrichment checkpoint payloads', () => {
  it('serializes IPC-sized clones and atomic writes while retaining changes during a checkpoint', async () => {
    const root = await directory();
    const chunks = [largeChunk('a'), largeChunk('b')];
    const writes: { chunkIndex: number; bytes: number; durationMs: number }[] = [];
    const memory = [process.memoryUsage()];
    const atomicWrite = createAtomicCacheChunkWriter();
    let active = 0;
    let maxActive = 0;
    let started!: () => void;
    let release!: () => void;
    const firstStarted = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const writeCacheChunk = vi.fn(async ({ chunkIndex, data }) => {
      active++;
      maxActive = Math.max(maxActive, active);
      const start = performance.now();
      // Electron performs a structured clone at the IPC boundary. This test
      // exercises its payload shape but does not claim Electron RSS measurements.
      const ipcData = structuredClone(data);
      memory.push(process.memoryUsage());
      if (writeCacheChunk.mock.calls.length === 1) { started(); await gate; }
      const bytes = await atomicWrite(path.join(root, `${chunkIndex}.json`), ipcData);
      writes.push({ chunkIndex, bytes, durationMs: Math.round(performance.now() - start) });
      memory.push(process.memoryUsage());
      active--;
      return { success: true };
    });
    vi.stubGlobal('window', { electronAPI: { writeCacheChunk } });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const writer = new IncrementalCacheWriter('/synthetic', 'Synthetic', true, 1024);
    const saved = vi.fn();
    const checkpoints = createEnrichmentCheckpoints({
      total: 99000, onSaved: saved,
      write: index => writer.overwrite(index, chunks[index]),
    });
    for (let index = 0; index < 1000; index++) checkpoints.mark(index < 512 ? 0 : 1);
    const first = checkpoints.flush();
    await firstStarted;
    chunks[0][0] = { ...chunks[0][0], enrichmentState: 'enriched', prompt: 'concurrent change' };
    checkpoints.mark(0);
    const second = checkpoints.flush(true);
    expect(writeCacheChunk).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);
    expect(maxActive).toBe(1);
    expect(writes.map(write => write.chunkIndex)).toEqual([0, 1, 0]);
    expect(writes.every(write => write.bytes >= 50_000_000 && write.bytes <= 60_000_000)).toBe(true);
    expect(saved.mock.calls).toEqual([[1000, 2], [1001, 1]]);
    const persisted = JSON.parse(await fs.readFile(path.join(root, '0.json'), 'utf8'));
    expect(persisted[0].prompt).toBe('concurrent change');
    expect(await fs.readdir(root)).toEqual(['0.json', '1.json']);
    console.info('[issue-595:large-payload]', {
      scenario: 'concurrent-checkpoints', writes, maxActive,
      nodeProcessSampledPeakRssMB: Math.round(Math.max(...memory.map(sample => sample.rss)) / 1024 ** 2),
      nodeProcessSampledPeakHeapMB: Math.round(Math.max(...memory.map(sample => sample.heapUsed)) / 1024 ** 2),
    });
  }, 90_000);

  it('preserves the last confirmed 57 MB chunk when replacement fails and resumes its pending entries', async () => {
    const root = await directory();
    const destination = path.join(root, '0.json');
    const chunk = largeChunk('restart');
    let failReplacement = false;
    const atomicWrite = createAtomicCacheChunkWriter({
      ...fs, rename: async (from, to) => {
        if (failReplacement) throw new Error('synthetic replacement failure');
        await fs.rename(from, to);
      },
    });
    vi.stubGlobal('window', { electronAPI: {
      writeCacheChunk: async ({ data }) => {
        try { await atomicWrite(destination, structuredClone(data)); return { success: true }; }
        catch (error) { return { success: false, error: (error as Error).message }; }
      },
    } });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const writer = new IncrementalCacheWriter('/synthetic', 'Synthetic', true, 1024);
    const saved = vi.fn();
    const checkpoints = createEnrichmentCheckpoints({
      total: 99000, onSaved: saved, write: () => writer.overwrite(0, chunk),
    });
    for (let index = 0; index < 1000; index++) {
      chunk[index].enrichmentState = 'enriched';
      checkpoints.mark(0);
    }
    await checkpoints.flush();
    failReplacement = true;
    for (let index = 1000; index < 1024; index++) {
      chunk[index].enrichmentState = 'enriched';
      checkpoints.mark(0);
    }
    await expect(checkpoints.flush(true)).rejects.toThrow('synthetic replacement failure');
    expect(saved.mock.calls).toEqual([[1000, 1]]);
    expect(await fs.readdir(root)).toEqual(['0.json']);
    const persisted: CacheImageMetadata[] = JSON.parse(await fs.readFile(destination, 'utf8'));
    expect(persisted.filter(entry => entry.enrichmentState === 'enriched')).toHaveLength(1000);
    expect(persisted.filter(entry => entry.enrichmentState === 'catalog')).toHaveLength(24);
    // A fresh renderer gets a new writer, not the failed writer's rejected queue.
    failReplacement = false;
    const restartedWriter = new IncrementalCacheWriter('/synthetic', 'Synthetic', true, 1024);
    const resumed = createEnrichmentCheckpoints({ total: 24, write: () => restartedWriter.overwrite(0, persisted) });
    for (const entry of persisted) {
      if (entry.enrichmentState !== 'catalog') continue;
      entry.enrichmentState = 'enriched';
      resumed.mark(0);
    }
    await resumed.flush(true);
    const completed: CacheImageMetadata[] = JSON.parse(await fs.readFile(destination, 'utf8'));
    expect(completed.every(entry => entry.enrichmentState === 'enriched')).toBe(true);
    console.info('[issue-595:large-payload]', {
      scenario: 'failed-replacement-and-resume', bytes: (await fs.stat(destination)).size,
      preservedEnriched: 1000, resumedEntries: 24,
    });
  }, 90_000);
});

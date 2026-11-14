import { describe, expect, it, vi } from 'vitest';
import { enqueueWatchedFileJob, shouldIndexWatchedFile } from '../utils/watchedFileIndexing';
import type { WatchedFile } from '../types';

const file: WatchedFile = {
    name: 'image.png', path: '/library/image.png', type: 'png',
    lastModified: 100, contentModifiedMs: 100, size: 42, forceReindex: true,
};
const indexed = { contentModifiedMs: 100, fileSize: 42 };

describe('watched file indexing', () => {
    it('skips unchanged media but preserves replacements and sidecar changes', () => {
        expect(shouldIndexWatchedFile(indexed, file)).toBe(false);
        expect(shouldIndexWatchedFile(indexed, { ...file, forceReindexUnchanged: true })).toBe(true);
        expect(shouldIndexWatchedFile(indexed, { ...file, sidecarChanged: true })).toBe(true);
        expect(shouldIndexWatchedFile(indexed, { ...file, provenanceBytesChanged: false })).toBe(true);
        expect(shouldIndexWatchedFile(indexed, { ...file, contentModifiedMs: 101 })).toBe(true);
        expect(shouldIndexWatchedFile(indexed, { ...file, size: 43 })).toBe(true);
        expect(shouldIndexWatchedFile(undefined, file)).toBe(true);
    });

    it('serializes duplicate batches of 64 images and indexes each only once', async () => {
        const jobs = new Map<string, Promise<void>>();
        const records = new Map<string, typeof indexed>();
        const batch = Array.from({ length: 64 }, (_, i) => ({ ...file, name: `image-${i}.png`, path: `/library/image-${i}.png` }));
        const index = vi.fn(async (files: WatchedFile[]) => {
            await Promise.resolve();
            for (const entry of files) records.set(entry.path, { ...indexed });
        });
        const processBatch = async () => {
            const pending = batch.filter(entry => shouldIndexWatchedFile(records.get(entry.path), entry));
            if (pending.length) await index(pending);
        };
        await Promise.all([
            enqueueWatchedFileJob(jobs, 'library', processBatch),
            enqueueWatchedFileJob(jobs, 'library', processBatch),
        ]);
        expect(index).toHaveBeenCalledTimes(1);
        expect(index).toHaveBeenCalledWith(batch);
        expect(records.size).toBe(64);
        expect(jobs.size).toBe(0);
    });
});

import type { IndexedImage, WatchedFile } from '../types';

export function shouldIndexWatchedFile(
    existing: Pick<IndexedImage, 'contentModifiedMs' | 'fileSize'> | undefined,
    file: WatchedFile,
): boolean {
    if (!existing) return true;
    if (file.forceReindex !== true) return false;
    if (file.forceReindexUnchanged || file.sidecarChanged || file.provenanceBytesChanged === false) return true;
    return file.contentModifiedMs == null ||
        existing.contentModifiedMs !== file.contentModifiedMs ||
        existing.fileSize !== file.size;
}

export function enqueueWatchedFileJob(
    jobs: Map<string, Promise<void>>,
    directoryId: string,
    run: () => Promise<void>,
): Promise<void> {
    const previous = jobs.get(directoryId) ?? Promise.resolve();
    // An unexpected failure must not prevent a later queued batch from running.
    const job = previous.catch(() => undefined).then(run).finally(() => {
        if (jobs.get(directoryId) === job) jobs.delete(directoryId);
    });
    jobs.set(directoryId, job);
    return job;
}

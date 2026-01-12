import { useCallback, useEffect, useRef } from 'react';
import { useImageStore } from '../store/useImageStore';
import { processFiles } from '../services/fileIndexer';
import { cacheManager, IncrementalCacheWriter } from '../services/cacheManager';
import { IndexedImage, Directory } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';

// Configure logging level
const DEBUG = false;
const log = (...args: any[]) => DEBUG && console.log(...args);
const warn = (...args: any[]) => DEBUG && console.warn(...args);
const error = (...args: any[]) => console.error(...args); // Keep error logging for critical issues

// Throttle function for progress updates to avoid excessive re-renders
function throttle<T extends (...args: any[]) => any>(func: T, delay: number): T {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastExecTime = 0;

  return ((...args: any[]) => {
    const currentTime = Date.now();

    if (currentTime - lastExecTime > delay) {
      func(...args);
      lastExecTime = currentTime;
    } else {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        func(...args);
        lastExecTime = Date.now();
      }, delay - (currentTime - lastExecTime));
    }
  }) as T;
}

// Dynamic Electron detection - check at runtime, not module load time
const getIsElectron = () => {
  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
  return isElectron;
};

// Global cache for file data to avoid Zustand serialization issues
const fileDataCache = new Map<string, Uint8Array>();

// Function to clear file data cache
function clearFileDataCache() {
  fileDataCache.clear();
}

// Helper for getting files recursively in the browser
async function getFilesRecursivelyWeb(directoryHandle: FileSystemDirectoryHandle, path: string = ''): Promise<{ name: string; lastModified: number; size: number; type: string; birthtimeMs?: number }[]> {
    const files = [];
    for await (const entry of (directoryHandle as any).values()) {
        const entryPath = path ? `${path}/${entry.name}` : entry.name;
        if (entry.kind === 'file') {
            if (entry.name.endsWith('.png') || entry.name.endsWith('.jpg') || entry.name.endsWith('.jpeg')) {
                const file = await entry.getFile();
                files.push({ name: entryPath, lastModified: file.lastModified, size: file.size, type: file.type || 'image', birthtimeMs: file.lastModified });
            }
        } else if (entry.kind === 'directory') {
            try {
                const subFiles = await getFilesRecursivelyWeb(entry, entryPath);
                files.push(...subFiles);
            } catch (e) {
                warn(`Could not read directory: ${entryPath}`);
            }
        }
    }
    return files;
}

async function getDirectoryFiles(directoryHandle: FileSystemDirectoryHandle, directoryPath: string, recursive: boolean): Promise<{ name: string; lastModified: number; size: number; type: string; birthtimeMs?: number }[]> {
    if (getIsElectron()) {
        const result = await (window as any).electronAPI.listDirectoryFiles({ dirPath: directoryPath, recursive });
        if (result.success && result.files) {
            return result.files;
        }
        return [];
    } else {
        if (recursive) {
            return await getFilesRecursivelyWeb(directoryHandle);
        } else {
            const files = [];
            for await (const entry of (directoryHandle as any).values()) {
                if (entry.kind === 'file' && (entry.name.endsWith('.png') || entry.name.endsWith('.jpg') || entry.name.endsWith('.jpeg'))) {
                    const file = await entry.getFile();
                    files.push({ name: file.name, lastModified: file.lastModified, size: file.size, type: file.type || 'image', birthtimeMs: file.lastModified });
                }
            }
            return files;
        }
    }
}

// Helper to get a file handle from a relative path in the browser
async function getHandleFromPath(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle | null> {
    const parts = path.split('/');
    let currentHandle: FileSystemDirectoryHandle | FileSystemFileHandle = rootHandle;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;

        if (currentHandle.kind !== 'directory') {
            console.error('Path traversal failed: expected a directory, but got a file.');
            return null;
        }

        try {
            if (i === parts.length - 1) { // Last part is the file
                currentHandle = await (currentHandle as FileSystemDirectoryHandle).getFileHandle(part);
            } else { // Intermediate part is a directory
                currentHandle = await (currentHandle as FileSystemDirectoryHandle).getDirectoryHandle(part);
            }
        } catch (e) {
            console.error(`Could not get handle for part "${part}" in path "${path}"`, e);
            return null;
        }
    }

    return currentHandle.kind === 'file' ? currentHandle as FileSystemFileHandle : null;
}

async function getFileHandles(
    directoryHandle: FileSystemDirectoryHandle,
    directoryPath: string,
    files: { name: string; lastModified: number; size?: number; type?: string; birthtimeMs?: number }[]
): Promise<{handle: FileSystemFileHandle, path: string, lastModified: number, size?: number, type?: string, birthtimeMs?: number}[]> {
    const handles: {handle: FileSystemFileHandle, path: string, lastModified: number, size?: number, type?: string, birthtimeMs?: number}[] = [];

    if (getIsElectron()) {
        // Use batch path joining for optimal performance - single IPC call instead of multiple
        const fileNames = files.map(f => f.name);
        const batchResult = await window.electronAPI.joinPathsBatch({ basePath: directoryPath, fileNames });

        if (!batchResult.success) {
            console.error("Failed to join paths in batch:", batchResult.error);
            // Fallback: use manual path construction
            const filePaths = fileNames.map(name => `${directoryPath}/${name}`);
            batchResult.paths = filePaths;
        }

        // Process all files with the returned paths
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const filePath = batchResult.paths[i];

            const mockHandle = {
                name: file.name,
                kind: 'file' as const,
                _filePath: filePath,
                getFile: async () => {
                    // Read file directly when needed (during processFiles)
                    if (getIsElectron()) {
                        const fileResult = await window.electronAPI.readFile(filePath);
                        if (fileResult.success && fileResult.data) {
                            const freshData = new Uint8Array(fileResult.data);
                            const lowerName = file.name.toLowerCase();
                            const type = lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg';
                            return new File([freshData as any], file.name, { type });
                        } else {
                            // Only log non-file-not-found errors to reduce console noise
                            if (fileResult.errorType && fileResult.errorType !== 'FILE_NOT_FOUND') {
                                console.error(`Failed to read file: ${file.name}`, {
                                    error: fileResult.error,
                                    errorType: fileResult.errorType,
                                    errorCode: fileResult.errorCode,
                                    path: filePath
                                });
                            }
                            throw new Error(`Failed to read file: ${file.name}`);
                        }
                    }
                    throw new Error(`Failed to read file: ${filePath}`);
                }
            };
            handles.push({ handle: mockHandle as any, path: file.name, lastModified: file.lastModified, size: file.size, type: file.type, birthtimeMs: file.birthtimeMs });
        }
    } else {
        // Browser implementation needs to handle sub-paths
        for (const file of files) {
            const handle = await getHandleFromPath(directoryHandle, file.name);
            if (handle) {
                handles.push({ handle, path: file.name, lastModified: file.lastModified, size: file.size, type: file.type, birthtimeMs: file.birthtimeMs });
            }
        }
    }
    return handles;
}

const normalizeWatchPath = (path: string) => {
    if (!path) return '';
    return path.replace(/\\/g, '/').replace(/\/+$/, '');
};

const toRelativeWatchPath = (filePath: string, rootPath: string) => {
    const normalizedFilePath = normalizeWatchPath(filePath);
    const normalizedRootPath = normalizeWatchPath(rootPath);
    if (!normalizedFilePath) return '';
    if (!normalizedRootPath) return normalizedFilePath;
    if (normalizedFilePath === normalizedRootPath) return '';
    const prefix = `${normalizedRootPath}/`;
    if (normalizedFilePath.startsWith(prefix)) {
        return normalizedFilePath.slice(prefix.length);
    }
    return normalizedFilePath;
};

export function useImageLoader() {
    const {
        addDirectory, setLoading, setProgress, setError, setSuccess,
        setFilterOptions, removeImages, addImages, mergeImages, clearImages, setIndexingState, setEnrichmentProgress, setDirectoryRefreshing
    } = useImageStore();

    // AbortController for cancelling ongoing operations
    const abortControllerRef = useRef<AbortController | null>(null);
    
    // Timeout for clearing completed state
    const completedTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    
    // Timer for indexing performance tracking
    const indexingStartTimeRef = useRef<number | null>(null);

    // Helper function to check if indexing should be cancelled
    const shouldCancelIndexing = useCallback((allowIdle = false) => {
        // Always get the latest state from the store to avoid stale closures
        const currentState = useImageStore.getState().indexingState;
        if (abortControllerRef.current?.signal.aborted) {
            return true;
        }
        if (!allowIdle && currentState === 'idle') {
            return true;
        }
        return false;
    }, []); // No dependencies - always reads latest state

    // Function to wait while paused - monitors state changes in real-time
    const waitWhilePaused = useCallback(async () => {
        return new Promise<void>((resolve) => {
            const checkState = () => {
                const currentState = useImageStore.getState().indexingState;
                const isCancelled = abortControllerRef.current?.signal.aborted || currentState === 'idle';

                if (isCancelled) {
                    resolve();
                    return;
                }

                if (currentState !== 'paused') {
                    resolve();
                    return;
                }

                // Continue checking every 100ms
                setTimeout(checkState, 100);
            };

            checkState();
        });
    }, []);

    useEffect(() => {
        if (!getIsElectron()) return;

        const updateGlobalFilters = () => {
            const allImages = useImageStore.getState().images;
            const models = new Set<string>();
            const loras = new Set<string>();
            const schedulers = new Set<string>();

            for (const image of allImages) {
                if (image.models && image.models.length > 0) image.models.forEach(model => models.add(model));
                if (image.loras && image.loras.length > 0) {
                    image.loras.forEach(lora => {
                        if (typeof lora === 'string') {
                            loras.add(lora);
                        } else if (lora && typeof lora === 'object' && lora.name) {
                            loras.add(lora.name);
                        }
                    });
                }
                if (image.scheduler) schedulers.add(image.scheduler);
            }

            setFilterOptions({
                models: Array.from(models).sort(),
                loras: Array.from(loras).sort(),
                schedulers: Array.from(schedulers).sort(),
                dimensions: [],
            });
        };

        const removeProgressListener = (window as any).electronAPI.onIndexingProgress((progress: { current: number, total: number }) => {
            setProgress(progress);
            
            // If progress reaches 100%, manually trigger finalization after a short delay
            // This is a workaround for when onIndexingComplete doesn't fire
            if (progress.current === progress.total && progress.total > 0) {
                console.log(`[onIndexingProgress] Progress complete, will finalize in 500ms`);
                setTimeout(() => {
                    const currentState = useImageStore.getState().indexingState;
                    if (currentState === 'indexing') {
                        console.log(`[onIndexingProgress timeout] State still 'indexing', manually finalizing`);
                        const dirs = useImageStore.getState().directories;
                        // Finalize all directories (in case multiple were being indexed)
                        dirs.forEach(dir => {
                            if (dir.id) {
                                finalizeDirectoryLoad(dir);
                            }
                        });
                    }
                }, 500);
            }
        });

        let isFirstBatch = true;
        const removeBatchListener = (window as any).electronAPI.onIndexingBatchResult(({ batch }: { batch: IndexedImage[] }) => {
            addImages(batch);
            // Remove loading overlay after first batch
            if (isFirstBatch) {
                setLoading(false);
                isFirstBatch = false;
            }
            // Update filters incrementally as new images are processed
            updateGlobalFilters();
        });

        const removeErrorListener = (window as any).electronAPI.onIndexingError(({ error, directoryId }: { error: string, directoryId: string }) => {
            setError(`Indexing error in ${directoryId}: ${error}`);
            setLoading(false); // Stop loading on error
            setProgress(null);
        });

        const removeCompleteListener = (window as any).electronAPI.onIndexingComplete(({ directoryId }: { directoryId: string }) => {
            const currentState = useImageStore.getState().indexingState;
            console.log(`[onIndexingComplete] Received for ${directoryId}, current state: ${currentState}`);
            // Only finalize if not paused or cancelled
            if (currentState === 'indexing') {
                const directory = useImageStore.getState().directories.find(d => d.id === directoryId);
                if (directory) {
                    console.log(`[onIndexingComplete] Calling finalizeDirectoryLoad for ${directory.name}`);
                    finalizeDirectoryLoad(directory);
                } else {
                    console.warn(`[onIndexingComplete] Directory not found!`);
                }
            } else {
                console.log(`[onIndexingComplete] Skipping - state is ${currentState}, not 'indexing'`);
            }
        });

        return () => {
            removeProgressListener();
            removeBatchListener();
            removeErrorListener();
            removeCompleteListener();
        };
    }, [addImages, setProgress, setError, setLoading]);

    const finalizeDirectoryLoad = useCallback(async (
        directory: Directory,
        options: { suppressIndexingState?: boolean } = {}
    ) => {
        const suppressIndexingState = options.suppressIndexingState ?? false;

        // Prevent multiple finalizations for the same directory
        const finalizationKey = `finalized_${directory.id}`;
        if ((window as any)[finalizationKey]) {
            return;
        }
        (window as any)[finalizationKey] = true;

        // Flush any pending batched image inserts before final counts
        const flushPending = useImageStore.getState().flushPendingImages;
        if (flushPending) {
            flushPending();
        }
        
        // Wait a bit to ensure all images are added to the store
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const finalDirectoryImages = useImageStore.getState().images.filter(img => img.directoryId === directory.id);
        
        if (finalDirectoryImages.length === 0) {
            console.warn(`⚠️ No images found for directory ${directory.name}, skipping cache save`);
            setSuccess(`Loaded 0 images from ${directory.name}.`);
            if (!suppressIndexingState) {
                setLoading(false);
            } else {
                setDirectoryRefreshing(directory.id, false);
                setProgress(null);
                delete (window as any)[finalizationKey];
            }
            return;
        }

        // Calculate and log indexing time
        if (indexingStartTimeRef.current !== null) {
            const elapsedSeconds = ((performance.now() - indexingStartTimeRef.current) / 1000).toFixed(2);
            console.log(`⏱️ Indexed in ${elapsedSeconds} seconds`);
            indexingStartTimeRef.current = null;
        }

        setSuccess(`Loaded ${finalDirectoryImages.length} images from ${directory.name}.`);
        if (!suppressIndexingState) {
            setLoading(false);
            setIndexingState('completed');
        } else {
            setDirectoryRefreshing(directory.id, false);
            setProgress(null);
            delete (window as any)[finalizationKey];
            return;
        }
        
        // Clear any existing timeout
        if (completedTimeoutRef.current) {
            clearTimeout(completedTimeoutRef.current);
        }
        
        // Clear the completed state after 3 seconds
        completedTimeoutRef.current = setTimeout(() => {
            setIndexingState('idle');
            setProgress(null);
            // Clear finalization key to allow re-indexing
            delete (window as any)[finalizationKey];
            completedTimeoutRef.current = null;
        }, 3000);
    }, [setSuccess, setLoading, setIndexingState, setProgress, setDirectoryRefreshing]);


    const loadDirectoryFromCache = useCallback(async (directory: Directory) => {
        try {
            await cacheManager.init();
            const shouldScanSubfolders = useImageStore.getState().scanSubfolders;
            const cachedData = await cacheManager.getCachedData(directory.path, shouldScanSubfolders);

            if (cachedData && cachedData.imageCount > 0) {
                const isElectron = getIsElectron();
                let totalLoaded = 0;
                let totalFilteredOut = 0;

                await cacheManager.iterateCachedMetadata(directory.path, shouldScanSubfolders, async (metadataChunk) => {
                    if (!metadataChunk || metadataChunk.length === 0) {
                        return;
                    }

                    // Use batch path joining for optimal performance
                    const fileNames = metadataChunk.map(meta => meta.name);
                    const batchResult = await window.electronAPI.joinPathsBatch({ basePath: directory.path, fileNames });

                    let filePaths: string[];
                    if (batchResult.success) {
                        filePaths = batchResult.paths;
                    } else {
                        console.error("Failed to join paths in batch:", batchResult.error);
                        // Fallback to manual path construction
                        filePaths = fileNames.map(name => `${directory.path}/${name}`);
                    }

                    const chunkImages: IndexedImage[] = metadataChunk.map((meta, i) => {
                        const filePath = filePaths[i];

                        const mockHandle = {
                            name: meta.name,
                            kind: 'file' as const,
                            _filePath: filePath,
                            getFile: async () => {
                                if (isElectron && filePath) {
                                    const fileResult = await window.electronAPI.readFile(filePath);
                                    if (fileResult.success && fileResult.data) {
                                        const freshData = new Uint8Array(fileResult.data);
                                        const lowerName = meta.name.toLowerCase();
                                        const type = lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg';
                                        return new File([freshData as any], meta.name, { type });
                                    } else {
                                        // Only log non-file-not-found errors to reduce console noise
                                        if (fileResult.errorType && fileResult.errorType !== 'FILE_NOT_FOUND') {
                                            console.error(`Failed to read file: ${meta.name}`, {
                                                error: fileResult.error,
                                                errorType: fileResult.errorType,
                                                errorCode: fileResult.errorCode,
                                                path: filePath
                                            });
                                        }
                                        throw new Error(`Failed to read file: ${meta.name}`);
                                    }
                                }
                                throw new Error(`Failed to read file: ${meta.name}`);
                            }
                        };

                        return {
                            ...meta,
                            handle: mockHandle as any,
                            directoryId: directory.id,
                            directoryName: directory.name,
                            thumbnailStatus: 'pending',
                            thumbnailError: null,
                        };
                    });

                    const validImages = chunkImages.filter(image => {
                        const fileHandle = image.thumbnailHandle || image.handle;
                        return isElectron || (fileHandle && typeof fileHandle.getFile === 'function');
                    });

                    totalLoaded += validImages.length;
                    totalFilteredOut += chunkImages.length - validImages.length;

                    if (validImages.length > 0) {
                        addImages(validImages);
                        // Yield to keep UI responsive when loading large caches
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                });

                if (totalFilteredOut > 0) {
                    console.warn(`Filtered out ${totalFilteredOut} cached images that can't be loaded in current environment`);
                }

                if (totalLoaded > 0) {
                    log(`Loaded ${totalLoaded} images from cache for ${directory.name}`);
                }
            }
        } catch (err) {
            error(`Failed to load directory from cache ${directory.name}:`, err);
            // Don't set global error for this, as it's a background process
        }
    }, [addImages]);

    const loadDirectory = useCallback(async (directory: Directory, isUpdate: boolean) => {
        console.log(`[loadDirectory] Starting for ${directory.name}, isUpdate: ${isUpdate}`);
        const suppressIndexingState = isUpdate;
        if (suppressIndexingState) {
            setDirectoryRefreshing(directory.id, true);
            setError(null);
            setSuccess(null);
        } else {
            setLoading(true);
            setError(null);
            setSuccess(null);
            setIndexingState('indexing');
            console.log(`[loadDirectory] State set to 'indexing'`);
        }

        // Start performance timer
        indexingStartTimeRef.current = performance.now();

        // Initialize AbortController for this indexing operation
        abortControllerRef.current = new AbortController();

        try {
      // Always update the allowed paths in the main process
      if (getIsElectron()) {
        const allPaths = useImageStore.getState().directories.map(d => d.path);
        await window.electronAPI.updateAllowedPaths(allPaths);
            }

            await cacheManager.init();
            const shouldScanSubfolders = useImageStore.getState().scanSubfolders;

            // Note: We do NOT clear images before validation!
            // validateCacheAndGetDiff will intelligently detect:
            // - New files (to be processed)
            // - Deleted files (to be removed from UI)
            // - Modified files (to be re-processed)
            // - Unchanged files (loaded from cache - super fast!)
            
            const allCurrentFiles = await getDirectoryFiles(directory.handle, directory.path, shouldScanSubfolders);
            const fileStatsMap = new Map(
                allCurrentFiles.map(file => [file.name, {
                    size: file.size,
                    type: file.type,
                    birthtimeMs: file.birthtimeMs ?? file.lastModified,
                }])
            );
            const diff = await cacheManager.validateCacheAndGetDiff(directory.path, directory.name, allCurrentFiles, shouldScanSubfolders);

            let cacheWriter: IncrementalCacheWriter | null = null;
            const shouldUseWriter = getIsElectron() && (diff.needsFullRefresh || diff.newAndModifiedFiles.length > 0 || diff.deletedFileIds.length > 0);

            if (shouldUseWriter) {
                try {
                    cacheWriter = await cacheManager.createIncrementalWriter(directory.path, directory.name, shouldScanSubfolders);
                } catch (err) {
                    console.error('Failed to initialize incremental cache writer:', err);
                }
            }

            const regeneratedCachedImages = diff.cachedImages.length > 0
                ? await getFileHandles(
                    directory.handle,
                    directory.path,
                    diff.cachedImages.map(img => ({
                        name: img.name,
                        lastModified: img.lastModified,
                        size: fileStatsMap.get(img.name)?.size,
                        type: fileStatsMap.get(img.name)?.type,
                    }))
                )
                : [];

            const handleMap = new Map(regeneratedCachedImages.map(h => [h.path, h.handle]));

            let preloadedImages: IndexedImage[] = [];
            const shouldHydratePreloadedImages = !isUpdate || diff.needsFullRefresh;

            if (shouldHydratePreloadedImages) {
                clearImages(directory.id);
            } else if (diff.newAndModifiedFiles.length > 0) {
                const changedIds = Array.from(new Set(
                    diff.newAndModifiedFiles.map(file => `${directory.id}::${file.name}`)
                ));
                if (changedIds.length > 0) {
                    removeImages(changedIds);
                }
            }

            // Add cached images (both first load and refresh)
            if (diff.cachedImages.length > 0) {
                preloadedImages = diff.cachedImages.map(img => {
                    const stats = fileStatsMap.get(img.name);
                    const handle = handleMap.get(img.name);
                    return {
                        ...img,
                        handle: handle ?? img.handle,
                        directoryId: directory.id,
                        directoryName: directory.name,
                        thumbnailStatus: 'pending',
                        thumbnailError: null,
                        enrichmentState: 'enriched',
                        fileSize: stats?.size,
                        fileType: stats?.type,
                    } as IndexedImage;
                });
            }

            // Remove deleted files from the UI (if any were detected)
            if (diff.deletedFileIds.length > 0) {
                removeImages(diff.deletedFileIds);
            }

            const totalNewFiles = diff.newAndModifiedFiles.length;
            setProgress({ current: 0, total: totalNewFiles });
            console.log(`[loadDirectory] Progress set to 0/${totalNewFiles}`);

            const sortedFiles = totalNewFiles > 0
                ? [...diff.newAndModifiedFiles].sort((a, b) => b.lastModified - a.lastModified)
                : [];

            const sortedFilesWithStats = sortedFiles.map(file => ({
                ...file,
                size: fileStatsMap.get(file.name)?.size ?? file.size,
                type: fileStatsMap.get(file.name)?.type ?? file.type,
                birthtimeMs: fileStatsMap.get(file.name)?.birthtimeMs ?? file.birthtimeMs ?? file.lastModified,
            }));

            const fileHandles = sortedFilesWithStats.length > 0
                ? await getFileHandles(directory.handle, directory.path, sortedFilesWithStats)
                : [];

            const handleBatchProcessed = (batch: IndexedImage[]) => {
                addImages(batch);
            };

            const handleEnrichmentBatch = (batch: IndexedImage[]) => {
                mergeImages(batch);
            };

            const handleEnrichmentProgress = (progress: { processed: number; total: number } | null) => {
                setEnrichmentProgress(progress);
            };

            const throttledSetProgress = throttle(setProgress, 200);

            const handleDeletion = (deletedFileIds: string[]) => {
                removeImages(deletedFileIds);
            };

            const shouldProcessPipeline = (fileHandles.length > 0) || !!cacheWriter || (shouldHydratePreloadedImages && preloadedImages.length > 0);

            if (shouldProcessPipeline) {
                if (shouldCancelIndexing(suppressIndexingState)) {
                    if (suppressIndexingState) {
                        setDirectoryRefreshing(directory.id, false);
                        setProgress(null);
                    } else {
                        setIndexingState('idle');
                        setLoading(false);
                        setProgress(null);
                    }
                    return;
                }

                const indexingConcurrency = useSettingsStore.getState().indexingConcurrency ?? 4;

                setEnrichmentProgress(null);

                const { phaseB } = await processFiles(
                    fileHandles,
                    throttledSetProgress,
                    handleBatchProcessed,
                    directory.id,
                    directory.name,
                    shouldScanSubfolders,
                    handleDeletion,
                    abortControllerRef.current?.signal,
                    waitWhilePaused,
                    {
                        cacheWriter,
                        concurrency: indexingConcurrency,
                        preloadedImages,
                        fileStats: fileStatsMap,
                        onEnrichmentBatch: handleEnrichmentBatch,
                        onEnrichmentProgress: handleEnrichmentProgress,
                        hydratePreloadedImages: shouldHydratePreloadedImages,
                    }
                );

                phaseB
                    .then(() => {
                        // Keep the progress bar visible for 2 seconds after completion
                        setTimeout(() => setEnrichmentProgress(null), 2000);
                    })
                    .catch(err => {
                        console.error('Phase B enrichment failed', err);
                        // Keep error visible for 2 seconds
                        setTimeout(() => setEnrichmentProgress(null), 2000);
                    });

                if (!shouldCancelIndexing(suppressIndexingState)) {
                    finalizeDirectoryLoad(directory, { suppressIndexingState });
                }
            } else {
                if (shouldHydratePreloadedImages && preloadedImages.length > 0) {
                    addImages(preloadedImages);
                }
                finalizeDirectoryLoad(directory, { suppressIndexingState });
            }

        } catch (err) {
            if (!(err instanceof DOMException && err.name === 'AbortError')) {
                console.error(err);
                setError(`Failed to load directory ${directory.name}. Check console for details.`);
            }
            if (suppressIndexingState) {
                setDirectoryRefreshing(directory.id, false);
                setProgress(null);
            } else {
                setLoading(false);
                setIndexingState('idle');
                setProgress(null);
            }
        }
    }, [addImages, mergeImages, removeImages, clearImages, setFilterOptions, setLoading, setProgress, setError, setSuccess, setDirectoryRefreshing, finalizeDirectoryLoad]);


    // Helper function to detect if a path is a root disk
    const isRootDisk = (path: string): boolean => {
        // Windows root: C:\, D:\, E:\, etc.
        if (/^[A-Z]:\\?$/i.test(path)) return true;
        
        // Unix/Linux root: /
        if (path === '/' || path === '') return true;
        
        // macOS volumes: /Volumes, /System, /Library, /Users at root level
        if (/^\/(Volumes|System|Library|Users|Applications)$/i.test(path)) return true;
        
        return false;
    };

    // Show confirmation dialog for root disk scanning
    const confirmRootDiskScan = async (path: string): Promise<boolean> => {
        const message = `ÔÜá´©Å WARNING: Root Disk Detected\n\n` +
            `You are attempting to scan "${path}" which appears to be a root disk or system directory.\n\n` +
            `This could:\n` +
            `ÔÇó Take hours or days to complete\n` +
            `ÔÇó Freeze or crash the application\n` +
            `ÔÇó Index thousands of unrelated files\n` +
            `ÔÇó Use significant system resources\n\n` +
            `Are you absolutely sure you want to continue?`;
        
        return window.confirm(message);
    };

    const handleSelectFolder = useCallback(async () => {
        try {
            let handle: FileSystemDirectoryHandle;
            let path: string;
            let name: string;

            if (getIsElectron()) {
                const result = await window.electronAPI.showDirectoryDialog();
                if (result.canceled || !result.path) return;
                path = result.path;
                name = result.name || 'Selected Folder';
                handle = { name, kind: 'directory' } as any;
            } else {
                handle = await window.showDirectoryPicker();
                path = handle.name; // Path is just the name in the browser version for simplicity
                name = handle.name;
            }

            // Check if user is trying to scan a root disk
            if (isRootDisk(path)) {
                const confirmed = await confirmRootDiskScan(path);
                if (!confirmed) {
                    return; // User cancelled the dangerous operation
                }
            }

            const directoryId = path; // Use path as a unique ID
            const { directories } = useImageStore.getState();

            if (directories.some(d => d.id === directoryId)) {
                setError(`Directory "${name}" is already loaded.`);
                return;
            }

            const globalAutoWatch = useSettingsStore.getState().globalAutoWatch;
            const newDirectory: Directory = { id: directoryId, path, name, handle, autoWatch: globalAutoWatch };

            // Add to store first
            addDirectory(newDirectory);

            // Persist the *new* state after adding
            const updatedDirectories = useImageStore.getState().directories;
            if (getIsElectron()) {
                localStorage.setItem('image-metahub-directories', JSON.stringify(updatedDirectories.map(d => d.path)));
            }

            // Now load the content of the new directory
            await loadDirectory(newDirectory, false);

        } catch (err) {
            if (!(err instanceof DOMException && err.name === 'AbortError')) {
                console.error(err);
                setError("Failed to select directory. Check console for details.");
            }
        }
    }, [loadDirectory, addDirectory, setError]);

    const handleUpdateFolder = useCallback(async (directoryId: string) => {
        const directory = useImageStore.getState().directories.find(d => d.id === directoryId);
        if (!directory) {
            setError("Directory not found for update.");
            return;
        }
        await loadDirectory(directory, true);
    }, [loadDirectory, setError]);
    
    const handleLoadFromStorage = useCallback(async () => {
        setLoading(true);
        if (getIsElectron()) {
            const storedPaths = localStorage.getItem('image-metahub-directories');
            if (storedPaths) {
                try {
                    const paths = JSON.parse(storedPaths);
                    if (paths.length === 0) {
                        setLoading(false);
                        return;
                    }

                    // First, add all directories to the store without loading.
                    for (const path of paths) {
                        const name = path.split(/\/|\\/).pop() || 'Loaded Folder';
                        const handle = { name, kind: 'directory' } as any;
                        const directoryId = path;
                        const newDirectory: Directory = { id: directoryId, path, name, handle };
                        addDirectory(newDirectory);
                    }
                    
                    // Then, load them all sequentially to avoid overwhelming the system.
                    const directoriesToLoad = useImageStore.getState().directories;

                    setLoading(false);
                    const hydrateInBackground = async () => {
                        // Update allowed paths BEFORE loading from cache to avoid security violations
                        const allPaths = useImageStore.getState().directories.map(d => d.path);
                        await window.electronAPI.updateAllowedPaths(allPaths);

                        for (const dir of directoriesToLoad) {
                            await loadDirectoryFromCache(dir);
                        }

                        const directoriesText = directoriesToLoad.length === 1 ? 'directory' : 'directories';
                        setSuccess(`Loaded ${directoriesToLoad.length} ${directoriesText} from cache.`);
                    };

                    void hydrateInBackground();

                    return;
                } catch (e) {
                    error("Error loading from storage", e);
                    setError("Failed to load previously saved directories.");
                } finally {
                    setLoading(false);
                }
            } else {
                 setLoading(false);
            }
        } else {
            console.warn('Loading from storage is only supported in Electron.');
            setLoading(false);
        }
    }, [addDirectory, setLoading, setError, setFilterOptions, setSuccess, loadDirectory]);

    const handleRemoveDirectory = useCallback(async (directoryId: string) => {
        const { removeDirectory: removeDirectoryFromStore } = useImageStore.getState();
        
        // Remove from store (this removes images from view and updates localStorage)
        // NOTE: We intentionally DO NOT clear the cache here!
        // This allows users to temporarily hide folders without losing the expensive indexing work
        // The cache will be reused when the folder is added back
        removeDirectoryFromStore(directoryId);

        // Update allowed paths
        if (getIsElectron()) {
            const updatedDirectories = useImageStore.getState().directories;
            const allPaths = updatedDirectories.map(d => d.path);
            await window.electronAPI.updateAllowedPaths(allPaths);
        }
    }, []);

    const processNewWatchedFiles = useCallback(async (
        directory: Directory,
        files: Array<{ name: string; path: string; lastModified: number; size: number; type: string }>
    ) => {
        try {
            const normalizedFiles = files.map(file => {
                const relativePath = toRelativeWatchPath(file.path, directory.path);
                const normalizedName = relativePath || file.name;
                const normalizedType = file.type && file.type.includes('/') ? file.type : undefined;
                return { ...file, relativePath, normalizedName, normalizedType };
            });
            // Filtrar arquivos que j├í existem
            const images = useImageStore.getState().images;
            const existingIds = new Set(images.map(img => img.id));
            const newFiles = normalizedFiles.filter(file => {
                const imageId = `${directory.id}::${file.relativePath || file.normalizedName}`;
                return !existingIds.has(imageId);
            });

            if (newFiles.length === 0) {
                return; // Todos os arquivos j├í foram indexados
            }

            // Obter configura├º├úo de concorr├¬ncia
            const indexingConcurrency = useSettingsStore.getState().indexingConcurrency ?? 4;

            // Criar mock handles para os arquivos (necess├írio para processFiles)
            // Inclu├¡mos _filePath para que o Electron possa ler os arquivos via IPC batch
            const fileEntries = newFiles.map(file => ({
                handle: {
                    name: file.normalizedName,
                    kind: 'file' as const,
                    _filePath: file.path, // IMPORTANTE: Path para leitura via IPC no Electron
                    getFile: async () => {
                        // Read file directly when needed (during processFiles)
                        if (getIsElectron()) {
                            const fileResult = await window.electronAPI.readFile(file.path);
                            if (fileResult.success && fileResult.data) {
                                const freshData = new Uint8Array(fileResult.data);
                                const lowerName = file.normalizedName.toLowerCase();
                                const type = lowerName.endsWith('.png')
                                    ? 'image/png'
                                    : lowerName.endsWith('.webp')
                                        ? 'image/webp'
                                        : 'image/jpeg';
                                return new File([freshData as any], file.normalizedName, { type });
                            }
                            throw new Error(`Failed to read file: ${file.normalizedName}`);
                        }
                        throw new Error(`Failed to read file: ${file.path}`);
                    }
                } as any,
                path: file.relativePath || file.normalizedName,
                lastModified: file.lastModified,
                size: file.size,
                type: file.normalizedType,
                birthtimeMs: file.lastModified
            }));

            // Criar file stats map
            const fileStatsMap = new Map(
                newFiles.map(f => [f.relativePath || f.normalizedName, { size: f.size, type: f.normalizedType, birthtimeMs: f.lastModified }])
            );

            // Callback para processar batches de imagens
            const handleBatchProcessed = (batch: IndexedImage[]) => {
                console.log('[auto-watch] Phase A processed', batch.length, 'images (not adding yet, waiting for Phase B)');
            };

            // Processar novos arquivos usando o pipeline existente
            const { phaseB } = await processFiles(
                fileEntries,
                () => {}, // setProgress - silent
                handleBatchProcessed,
                directory.id,
                directory.name,
                false, // scanSubfolders
                () => {}, // onDeletion
                undefined, // abortSignal
                undefined, // waitWhilePaused
                {
                    concurrency: indexingConcurrency,
                    fileStats: fileStatsMap,
                    onEnrichmentBatch: (enrichedBatch) => {
                        // Phase B: Enriquecimento completo - adicionar as imagens agora
                        console.log('[auto-watch] Phase B enriched', enrichedBatch.length, 'images - adding to store');
                        addImages(enrichedBatch);
                        // Force flush imediatamente
                        const flushPendingImages = useImageStore.getState().flushPendingImages;
                        setTimeout(() => {
                            console.log('[auto-watch] Flushing enriched images');
                            flushPendingImages();
                        }, 0);
                    },
                }
            );

            // Aguardar Phase B completar
            console.log('[auto-watch] Waiting for Phase B to complete...');
            await phaseB;
            console.log('[auto-watch] Phase B completed!');

        } catch (error) {
            console.error('Error processing watched files:', error);
        }
    }, [addImages]);

    return {
        handleSelectFolder,
        handleUpdateFolder,
        handleLoadFromStorage,
        handleRemoveDirectory,
        loadDirectory,
        loadDirectoryFromCache,
        processNewWatchedFiles,
        cancelIndexing: () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        }
    };
}

export { getFileHandles };

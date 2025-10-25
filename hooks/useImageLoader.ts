import { useCallback, useEffect, useRef } from 'react';
import { useImageStore } from '../store/useImageStore';
import { processFiles } from '../services/fileIndexer';
import { cacheManager } from '../services/cacheManager';
import { IndexedImage, Directory } from '../types';

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
async function getFilesRecursivelyWeb(directoryHandle: FileSystemDirectoryHandle, path: string = ''): Promise<{ name: string; lastModified: number }[]> {
    const files = [];
    for await (const entry of (directoryHandle as any).values()) {
        const entryPath = path ? `${path}/${entry.name}` : entry.name;
        if (entry.kind === 'file') {
            if (entry.name.endsWith('.png') || entry.name.endsWith('.jpg') || entry.name.endsWith('.jpeg')) {
                const file = await entry.getFile();
                files.push({ name: entryPath, lastModified: file.lastModified });
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

async function getDirectoryFiles(directoryHandle: FileSystemDirectoryHandle, directoryPath: string, recursive: boolean): Promise<{ name: string; lastModified: number }[]> {
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
                    files.push({ name: file.name, lastModified: file.lastModified });
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

async function getFileHandles(directoryHandle: FileSystemDirectoryHandle, directoryPath: string, files: { name: string; lastModified: number }[]): Promise<{handle: FileSystemFileHandle, path: string, lastModified: number}[]> {
    const handles: {handle: FileSystemFileHandle, path: string, lastModified: number}[] = [];

    if (getIsElectron()) {
        // Process paths in smaller chunks to avoid overwhelming IPC
        const CHUNK_SIZE = 1000;
        const fileNames = files.map(f => f.name);
        const joinResults: any[] = [];
        
        for (let i = 0; i < fileNames.length; i += CHUNK_SIZE) {
            const chunk = fileNames.slice(i, i + CHUNK_SIZE);
            const chunkResults = await Promise.all(
                chunk.map(fileName => window.electronAPI.joinPaths(directoryPath, fileName))
            );
            joinResults.push(...chunkResults);
        }

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const joinResult = joinResults[i];
            const filePath = joinResult.success ? joinResult.path : `${directoryPath}/${file.name}`;
            
            if (!joinResult.success) {
                console.error("Failed to join paths, falling back to manual concatenation:", joinResult.error);
            }

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
                        }
                    }
                    throw new Error(`Failed to read file: ${filePath}`);
                }
            };
            handles.push({ handle: mockHandle as any, path: file.name, lastModified: file.lastModified });
        }
    } else {
        // Browser implementation needs to handle sub-paths
        for (const file of files) {
            const handle = await getHandleFromPath(directoryHandle, file.name);
            if (handle) {
                handles.push({ handle, path: file.name, lastModified: file.lastModified });
            }
        }
    }
    return handles;
}

export function useImageLoader() {
    const {
        addDirectory, setLoading, setProgress, setError, setSuccess,
        setFilterOptions, removeImages, addImages, clearImages, setIndexingState
    } = useImageStore();

    // AbortController for cancelling ongoing operations
    const abortControllerRef = useRef<AbortController | null>(null);
    
    // Timeout for clearing completed state
    const completedTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    
    // Timer for indexing performance tracking
    const indexingStartTimeRef = useRef<number | null>(null);

    // Helper function to check if indexing should be cancelled
    const shouldCancelIndexing = useCallback(() => {
        // Always get the latest state from the store to avoid stale closures
        const currentState = useImageStore.getState().indexingState;
        return abortControllerRef.current?.signal.aborted || currentState === 'idle';
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
                if (image.loras && image.loras.length > 0) image.loras.forEach(lora => loras.add(lora));
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

    const finalizeDirectoryLoad = useCallback(async (directory: Directory) => {
        
        // Prevent multiple finalizations for the same directory
        const finalizationKey = `finalized_${directory.id}`;
        if ((window as any)[finalizationKey]) {
            return;
        }
        (window as any)[finalizationKey] = true;
        
        // Wait a bit to ensure all images are added to the store
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const finalDirectoryImages = useImageStore.getState().images.filter(img => img.directoryId === directory.id);
        
        if (finalDirectoryImages.length === 0) {
            console.warn(`⚠️ No images found for directory ${directory.name}, skipping cache save`);
            setSuccess(`Loaded 0 images from ${directory.name}.`);
            setLoading(false);
            return;
        }
        
        const shouldScanSubfolders = useImageStore.getState().scanSubfolders;
        await cacheManager.cacheData(directory.path, directory.name, finalDirectoryImages, shouldScanSubfolders);

        // Calculate and log indexing time
        if (indexingStartTimeRef.current !== null) {
            const elapsedSeconds = ((performance.now() - indexingStartTimeRef.current) / 1000).toFixed(2);
            console.log(`⏱️ Indexed in ${elapsedSeconds} seconds`);
            indexingStartTimeRef.current = null;
        }

        setSuccess(`Loaded ${finalDirectoryImages.length} images from ${directory.name}.`);
        setLoading(false);
        setIndexingState('completed');
        
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
    }, [setSuccess, setLoading, setIndexingState, setProgress]);

    const processDirectoryFiles = useCallback(async (directory: Directory, allCurrentFiles: { name: string; lastModified: number }[]) => {
        try {
            await cacheManager.init();
            const shouldScanSubfolders = useImageStore.getState().scanSubfolders;

            const diff = await cacheManager.validateCacheAndGetDiff(directory.path, directory.name, allCurrentFiles, shouldScanSubfolders);

            // Remove deleted files from the UI (if any were detected)
            if (diff.deletedFileIds.length > 0) {
                removeImages(diff.deletedFileIds);
            }
             // Get handles for cached images to update placeholders
            const regeneratedCachedImages = diff.cachedImages.length > 0
                ? await getFileHandles(directory.handle, directory.path, diff.cachedImages.map(img => ({ name: img.name, lastModified: img.lastModified })))
                : [];
            const handleMap = new Map(regeneratedCachedImages.map(h => [h.path, h.handle]));

            // Update placeholders with cached images
            if (diff.cachedImages.length > 0) {
                const finalCachedImages: IndexedImage[] = diff.cachedImages.map(img => ({
                    ...img,
                    handle: handleMap.get(img.name)!,
                    directoryId: directory.id,
                }));
                addImages(finalCachedImages); // addImages will overwrite placeholders
            }

            // Set progress for the deep scan part
            setProgress({ current: 0, total: diff.newAndModifiedFiles.length });

            if (diff.newAndModifiedFiles.length > 0) {
                console.log(`[processDirectoryFiles] Processing ${diff.newAndModifiedFiles.length} new files`);
                const sortedFiles = [...diff.newAndModifiedFiles].sort((a, b) => b.lastModified - a.lastModified);
                const fileHandles = await getFileHandles(directory.handle, directory.path, sortedFiles);

                const processPromise = processFiles(
                    fileHandles,
                    throttle(setProgress, 200),
                    (batch) => addImages(batch), // onBatchProcessed
                    directory.id,
                    directory.name,
                    shouldScanSubfolders,
                    (deletedIds) => removeImages(deletedIds), // onDeletion
                    abortControllerRef.current?.signal,
                    waitWhilePaused
                );

                if (shouldCancelIndexing()) {
                    setIndexingState('idle'); setLoading(false); return;
                }

                await processPromise;

                if (!shouldCancelIndexing()) {
                    finalizeDirectoryLoad(directory);
                }

            } else {
                console.log(`[processDirectoryFiles] No new files to process, finalizing immediately`);
                finalizeDirectoryLoad(directory);
            }

        } catch (err) {
             if (!(err instanceof DOMException && err.name === 'AbortError')) {
                console.error(err);
                setError(`Failed to process directory ${directory.name}. Check console for details.`);
            }
             setLoading(false);
             setIndexingState('idle');
             setProgress(null);
        }
    }, [addImages, removeImages, clearImages, setFilterOptions, setLoading, setProgress, setError, setSuccess, finalizeDirectoryLoad, waitWhilePaused, shouldCancelIndexing]);

    const fileQueueRef = useRef<Map<string, { name: string; lastModified: number }[]>>(new Map());
    useEffect(() => {
        if (!getIsElectron()) return;

        const removeScanBatchListener = (window as any).electronAPI.onDirectoryScanBatch(({ directoryId, files }) => {
            const directory = useImageStore.getState().directories.find(d => d.id === directoryId);
            if (!directory) return;

            const queue = fileQueueRef.current.get(directoryId) || [];
            queue.push(...files);
            fileQueueRef.current.set(directoryId, queue);

            const placeholderImages: IndexedImage[] = files.map(file => ({
                id: `${directoryId}::${file.name.replace(/\\/g, '/')}`,
                name: file.name.split(/\\|\//).pop() || file.name,
                directoryId: directoryId,
                lastModified: file.lastModified,
                handle: { name: file.name, kind: 'file', _filePath: `${directory.path}/${file.name}` } as any,
                metadata: { isPlaceholder: true },
            } as IndexedImage));

            addImages(placeholderImages);
        });

        const removeScanCompleteListener = (window as any).electronAPI.onDirectoryScanComplete(async ({ directoryId, total }) => {
            const directory = useImageStore.getState().directories.find(d => d.id === directoryId);
            const allFiles = fileQueueRef.current.get(directoryId) || [];
            if (!directory) return;

            console.log(`[ScanComplete] for ${directory.name}, found ${allFiles.length} of ${total} total. Starting deep scan.`);
            await processDirectoryFiles(directory, allFiles);
            fileQueueRef.current.delete(directoryId);
        });

        const removeScanErrorListener = (window as any).electronAPI.onDirectoryScanError(({ directoryId, error: errorMessage }) => {
            setError(`Error scanning directory ${directoryId}: ${errorMessage}`);
            setLoading(false);
            setIndexingState('idle');
        });

        return () => {
            removeScanBatchListener();
            removeScanCompleteListener();
            removeScanErrorListener();
        };
    }, [addImages, processDirectoryFiles, setError, setLoading, setIndexingState]);

    const loadDirectory = useCallback(async (directory: Directory, isUpdate: boolean) => {
        console.log(`[loadDirectory] Starting stream for ${directory.name}, isUpdate: ${isUpdate}`);
        setLoading(true);
        setError(null);
        setSuccess(null);
        setIndexingState('indexing');

        indexingStartTimeRef.current = performance.now();
        abortControllerRef.current = new AbortController();

        if (isUpdate) {
            clearImages(directory.id);
        }

        if (getIsElectron()) {
            try {
                const allPaths = useImageStore.getState().directories.map(d => d.path);
                await window.electronAPI.updateAllowedPaths(allPaths);

                await window.electronAPI.streamDirectoryFiles({
                    dirPath: directory.path,
                    recursive: useImageStore.getState().scanSubfolders,
                    directoryId: directory.id
                });
            } catch(err) {
                console.error("Failed to start directory stream", err);
                setError(`Failed to start loading directory ${directory.name}.`);
                setLoading(false);
                setIndexingState('idle');
            }
        } else {
            // Browser fallback (non-streaming)
            // This part can be implemented if needed, for now, we focus on Electron
            console.warn('Progressive loading not supported in browser.');
            setError("Progressive loading is only available in the Electron app.");
            setLoading(false);
            setIndexingState('idle');
        }

    }, [clearImages, setLoading, setError, setSuccess, setIndexingState]);

    const loadDirectoryFromCache = useCallback(async (directory: Directory) => {
        try {
            await cacheManager.init();
            const shouldScanSubfolders = useImageStore.getState().scanSubfolders;
            const cachedData = await cacheManager.getCachedData(directory.path, shouldScanSubfolders);

            if (cachedData && cachedData.length > 0) {
                const isElectron = getIsElectron();
                const filePaths = await Promise.all(
                    cachedData.map(meta => window.electronAPI.joinPaths(directory.path, meta.name))
                );

                const cachedImages: IndexedImage[] = cachedData.map((meta, i) => {
                    const joinResult = filePaths[i];
                    const filePath = joinResult.success ? joinResult.path : `${directory.path}/${meta.name}`;

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
                                }
                            }
                            throw new Error(`Failed to read file: ${meta.name}`);
                        }
                    };

                    return {
                        ...meta,
                        handle: mockHandle as any,
                        directoryId: directory.id,
                    };
                });
                
                const validImages = cachedImages.filter(image => {
                    const fileHandle = image.thumbnailHandle || image.handle;
                    return isElectron || (fileHandle && typeof fileHandle.getFile === 'function');
                });
                
                if (validImages.length !== cachedImages.length) {
                    console.warn(`Filtered out ${cachedImages.length - validImages.length} cached images that can't be loaded in current environment`);
                }
                
                addImages(validImages);
                log(`Loaded ${validImages.length} images from cache for ${directory.name}`);
            }
        } catch (err) {
            error(`Failed to load directory from cache ${directory.name}:`, err);
        }
    }, [addImages]);

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
                handle = { name, kind: 'directory' } as FileSystemDirectoryHandle;
            } else {
                handle = await window.showDirectoryPicker();
                path = handle.name;
                name = handle.name;
            }

            const directoryId = path;
            const { directories } = useImageStore.getState();

            if (directories.some(d => d.id === directoryId)) {
                setError(`Directory "${name}" is already loaded.`);
                return;
            }

            const newDirectory: Directory = { id: directoryId, path, name, handle };
            addDirectory(newDirectory);

            const updatedDirectories = useImageStore.getState().directories;
            if (getIsElectron()) {
                localStorage.setItem('image-metahub-directories', JSON.stringify(updatedDirectories.map(d => d.path)));
            }
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

                    for (const path of paths) {
                        const name = path.split(/\/|\\/).pop() || 'Loaded Folder';
                        const handle = { name, kind: 'directory' } as FileSystemDirectoryHandle;
                        const directoryId = path;
                        const newDirectory: Directory = { id: directoryId, path, name, handle };
                        addDirectory(newDirectory);
                    }

                    const allPaths = useImageStore.getState().directories.map(d => d.path);
                    await window.electronAPI.updateAllowedPaths(allPaths);
                    
                    const directoriesToLoad = useImageStore.getState().directories;
                    const loadPromises = directoriesToLoad.map(dir => loadDirectoryFromCache(dir));
                    await Promise.all(loadPromises);

                    const directoriesText = directoriesToLoad.length === 1 ? 'directory' : 'directories';
                    setSuccess(`Loaded ${directoriesToLoad.length} ${directoriesText} from cache.`);
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
    }, [loadDirectoryFromCache, addDirectory, setLoading, setError, setFilterOptions, setSuccess]);

    const handleRemoveDirectory = useCallback(async (directoryId: string) => {
        const { removeDirectory: removeDirectoryFromStore } = useImageStore.getState();
        
        removeDirectoryFromStore(directoryId);

        if (getIsElectron()) {
            const updatedDirectories = useImageStore.getState().directories;
            const allPaths = updatedDirectories.map(d => d.path);
            await window.electronAPI.updateAllowedPaths(allPaths);
        }
    }, []);

    useEffect(() => {
        return;
    }, []);

    return {
        handleSelectFolder,
        handleUpdateFolder,
        handleLoadFromStorage,
        handleRemoveDirectory,
        handleRefreshCache: useCallback(() => setSuccess('Cache refresh is no longer needed'), [setSuccess]),
        loadDirectory,
        loadDirectoryFromCache,
        cancelIndexing: () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        }
    };
}

export { getFileHandles };
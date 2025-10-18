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
        setFilterOptions, removeImages, addImages, clearImages, indexingState, setIndexingState
    } = useImageStore();

    // AbortController for cancelling ongoing operations
    const abortControllerRef = useRef<AbortController | null>(null);

    // Helper function to check if indexing should be cancelled
    const shouldCancelIndexing = useCallback(() => {
        return abortControllerRef.current?.signal.aborted || indexingState === 'idle';
    }, [indexingState]);

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
            });
        };

        const removeProgressListener = (window as any).electronAPI.onIndexingProgress((progress: { current: number, total: number }) => {
            setProgress(progress);
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
            // Only finalize if not paused or cancelled
            if (currentState === 'indexing') {
                const directory = useImageStore.getState().directories.find(d => d.id === directoryId);
                if (directory) {
                    finalizeDirectoryLoad(directory);
                }
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
        console.log(`🏁 FINALIZING LOAD for ${directory.name} (${directory.path})`);
        
        // Prevent multiple finalizations for the same directory
        const finalizationKey = `finalized_${directory.id}`;
        if ((window as any)[finalizationKey]) {
            console.log(`⚠️ Directory ${directory.name} already finalized, skipping`);
            return;
        }
        (window as any)[finalizationKey] = true;
        
        // Wait a bit to ensure all images are added to the store
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const finalDirectoryImages = useImageStore.getState().images.filter(img => img.directoryId === directory.id);
        console.log(`📊 Found ${finalDirectoryImages.length} images for directory ${directory.name}`);
        
        if (finalDirectoryImages.length === 0) {
            console.warn(`⚠️ No images found for directory ${directory.name}, skipping cache save`);
            setSuccess(`Loaded 0 images from ${directory.name}.`);
            setLoading(false);
            return;
        }
        
        const shouldScanSubfolders = useImageStore.getState().scanSubfolders;
        await cacheManager.cacheData(directory.path, directory.name, finalDirectoryImages, shouldScanSubfolders);

        setSuccess(`Loaded ${finalDirectoryImages.length} images from ${directory.name}.`);
        setLoading(false);
        setIndexingState('idle');
        setProgress(null);
    }, [setSuccess, setLoading, setIndexingState, setProgress]);


    const loadDirectoryFromCache = useCallback(async (directory: Directory) => {
        try {
            await cacheManager.init();
            const shouldScanSubfolders = useImageStore.getState().scanSubfolders;
            const cachedData = await cacheManager.getCachedData(directory.path, shouldScanSubfolders);

            if (cachedData && cachedData.metadata.length > 0) {
                const isElectron = getIsElectron();
                const filePaths = await Promise.all(
                    cachedData.metadata.map(meta => window.electronAPI.joinPaths(directory.path, meta.name))
                );

                const cachedImages: IndexedImage[] = cachedData.metadata.map((meta, i) => {
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
                
                // Filter out images that can't be loaded in current environment
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
            // Don't set global error for this, as it's a background process
        }
    }, [addImages]);

    const loadDirectory = useCallback(async (directory: Directory, isUpdate: boolean) => {
        setLoading(true);
        setError(null);
        setSuccess(null);
        setIndexingState('indexing');

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
            const diff = await cacheManager.validateCacheAndGetDiff(directory.path, directory.name, allCurrentFiles, shouldScanSubfolders);

            const regeneratedCachedImages = diff.cachedImages.length > 0
                ? await getFileHandles(directory.handle, directory.path, diff.cachedImages.map(img => ({ name: img.name, lastModified: img.lastModified })))
                : [];

            const handleMap = new Map(regeneratedCachedImages.map(h => [h.path, h.handle]));

            // Only add cached images if this is NOT an update (first load)
            // On update, cached images are already in the store, no need to re-add
            if (!isUpdate) {
                const finalCachedImages: IndexedImage[] = diff.cachedImages.map(img => ({
                    ...img,
                    handle: handleMap.get(img.name)!,
                    directoryId: directory.id,
                }));

                if (finalCachedImages.length > 0) {
                    addImages(finalCachedImages);
                }
            }

            // Remove deleted files from the UI
            if (diff.deletedFileIds.length > 0) {
                removeImages(diff.deletedFileIds);
            }

            // Set progress even if no new files to process
            setProgress({ current: 0, total: diff.newAndModifiedFiles.length });

            if (diff.newAndModifiedFiles.length > 0) {
                // Sort files by lastModified descending (newest first)
                const sortedFiles = [...diff.newAndModifiedFiles].sort((a, b) => b.lastModified - a.lastModified);
                const fileHandles = await getFileHandles(directory.handle, directory.path, sortedFiles);
                setProgress({ current: 0, total: diff.newAndModifiedFiles.length });

                const handleBatchProcessed = (batch: IndexedImage[]) => {
                    addImages(batch);
                };

                const throttledSetProgress = throttle(setProgress, 200);

                const handleDeletion = (deletedFileIds: string[]) => {
                    removeImages(deletedFileIds);
                };

                // This now delegates to the main process in Electron, and is awaited in browser
                const processPromise = processFiles(
                    fileHandles,
                    throttledSetProgress,
                    handleBatchProcessed,
                    directory.id,
                    directory.name,
                    shouldScanSubfolders,
                    handleDeletion,
                    abortControllerRef.current?.signal,
                    waitWhilePaused
                );

                // Check for cancellation before starting
                if (shouldCancelIndexing()) {
                    setIndexingState('idle');
                    setLoading(false);
                    return;
                }

                // In browser, we wait here. In Electron, this resolves immediately.
                if (!getIsElectron()) {
                    await processPromise;
                    if (!shouldCancelIndexing()) {
                        finalizeDirectoryLoad(directory);
                    }
                }
                // In Electron, the 'onIndexingComplete' listener will call finalizeDirectoryLoad.

            } else {
                // No new files to process, just finalize with what we have
                // But wait a bit to allow UI to show indexing state
                console.log(`[LOAD] No new files for ${directory.name}, finalizing after delay`);
                setTimeout(() => {
                    finalizeDirectoryLoad(directory);
                }, 100);
            }

        } catch (err) {
            if (!(err instanceof DOMException && err.name === 'AbortError')) {
                console.error(err);
                setError(`Failed to load directory ${directory.name}. Check console for details.`);
            }
             setLoading(false);
             setIndexingState('idle');
             setProgress(null);
        }
    }, [addImages, removeImages, clearImages, setFilterOptions, setLoading, setProgress, setError, setSuccess, finalizeDirectoryLoad]);


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

            const directoryId = path; // Use path as a unique ID
            const { directories } = useImageStore.getState();

            if (directories.some(d => d.id === directoryId)) {
                setError(`Directory "${name}" is already loaded.`);
                return;
            }

            const newDirectory: Directory = { id: directoryId, path, name, handle };

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
                    
                    // Then, load them all from cache in parallel.
                    const directoriesToLoad = useImageStore.getState().directories;
                    const loadPromises = directoriesToLoad.map(dir => loadDirectoryFromCache(dir));
                    await Promise.all(loadPromises);

                    // Final update for allowed paths.
                    const allPaths = useImageStore.getState().directories.map(d => d.path);
                    await window.electronAPI.updateAllowedPaths(allPaths);

                    setSuccess(`Loaded ${directoriesToLoad.length} director(y|ies) from cache.`);
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

    return {
        handleSelectFolder,
        handleUpdateFolder,
        handleLoadFromStorage,
        handleRemoveDirectory,
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
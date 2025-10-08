import { useCallback } from 'react';
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

async function getFileHandles(directoryHandle: FileSystemDirectoryHandle, directoryPath: string, fileNames: string[]): Promise<{handle: FileSystemFileHandle, path: string}[]> {
    const handles: {handle: FileSystemFileHandle, path: string}[] = [];

    if (getIsElectron()) {
        // Create lightweight handles that will be read during processing
        for (const fileName of fileNames) {
            // Use the new IPC call to join paths correctly on any OS
            const joinResult = await window.electronAPI.joinPaths(directoryPath, fileName);

            // Use the joined path, or fallback to manual concatenation if the IPC call fails
            const filePath = joinResult.success ? joinResult.path : `${directoryPath}/${fileName}`;
            if (!joinResult.success) {
                console.error("Failed to join paths, falling back to manual concatenation:", joinResult.error);
            }

            const mockHandle = {
                name: fileName,
                kind: 'file' as const,
                // Store file path for later retrieval during processing
                _filePath: filePath,
                getFile: async () => {
                    // Read file directly when needed (during processFiles)
                    if (getIsElectron()) {
                        const fileResult = await window.electronAPI.readFile(filePath);
                        if (fileResult.success && fileResult.data) {
                            const freshData = new Uint8Array(fileResult.data);
                            const lowerName = fileName.toLowerCase();
                            const type = lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg';
                            return new File([freshData as any], fileName, { type });
                        }
                    }
                    throw new Error(`Failed to read file: ${filePath}`);
                }
            };
            handles.push({ handle: mockHandle as any, path: fileName });
        }
    } else {
        // Browser implementation needs to handle sub-paths
        for (const fileName of fileNames) {
            const handle = await getHandleFromPath(directoryHandle, fileName);
            if (handle) {
                handles.push({ handle, path: fileName });
            }
        }
    }
    return handles;
}

export function useImageLoader() {
    const {
        addDirectory, setLoading, setProgress, setError, setSuccess,
        setFilterOptions, removeImages, addImages, clearImages
    } = useImageStore();

    const loadDirectoryFromCache = useCallback(async (directory: Directory) => {
        try {
            await cacheManager.init();
            const shouldScanSubfolders = useImageStore.getState().scanSubfolders;
            const cachedData = await cacheManager.getCachedData(directory.path, shouldScanSubfolders);

            if (cachedData && cachedData.metadata.length > 0) {
                const cachedImages: IndexedImage[] = await Promise.all(cachedData.metadata.map(async meta => {
                    // Create proper handle with _filePath and getFile() for Electron
                    let handle: any = { name: meta.name, kind: 'file' };
                    
                    if (getIsElectron()) {
                        // Build the full file path
                        const joinResult = await window.electronAPI.joinPaths(directory.path, meta.name);
                        const filePath = joinResult.success ? joinResult.path : `${directory.path}/${meta.name}`;
                        
                        handle = {
                            name: meta.name,
                            kind: 'file' as const,
                            _filePath: filePath, // For direct file:// protocol access
                            getFile: async () => {
                                // CRITICAL: Implement getFile() method for ImageGrid compatibility
                                if (getIsElectron()) {
                                    const fileResult = await window.electronAPI.readFile(filePath);
                                    if (fileResult.success && fileResult.data) {
                                        const freshData = new Uint8Array(fileResult.data);
                                        const lowerName = meta.name.toLowerCase();
                                        const type = lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg';
                                        return new File([freshData as any], meta.name, { type });
                                    }
                                }
                                throw new Error(`Failed to read file: ${filePath}`);
                            }
                        };
                    }
                    
                    return {
                        ...meta,
                        handle,
                        directoryId: directory.id,
                    };
                }));
                addImages(cachedImages);
                log(`Loaded ${cachedImages.length} images from cache for ${directory.name}`);
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

        try {
      // Always update the allowed paths in the main process
      if (getIsElectron()) {
        const allPaths = useImageStore.getState().directories.map(d => d.path);
        await window.electronAPI.updateAllowedPaths(allPaths);
            }

            await cacheManager.init();
            const shouldScanSubfolders = useImageStore.getState().scanSubfolders;

            if (isUpdate) {
                // Clear images for this specific directory before refreshing
                clearImages(directory.id);
                // NOTE: We do NOT clear the cache here!
                // validateCacheAndGetDiff will intelligently detect:
                // - New files (to be processed)
                // - Deleted files (to be removed)
                // - Modified files (to be re-processed)
                // - Unchanged files (loaded from cache - super fast!)
            }
            // Note: On first load (isUpdate=false), we don't clear anything - just add new images
            const allCurrentFiles = await getDirectoryFiles(directory.handle, directory.path, shouldScanSubfolders);
            const diff = await cacheManager.validateCacheAndGetDiff(directory.path, directory.name, allCurrentFiles, shouldScanSubfolders);

            const regeneratedCachedImages = diff.cachedImages.length > 0
                ? await getFileHandles(directory.handle, directory.path, diff.cachedImages.map(img => img.name))
                : [];

            const handleMap = new Map(regeneratedCachedImages.map(h => [h.path, h.handle]));

            const finalCachedImages: IndexedImage[] = diff.cachedImages.map(img => ({
                ...img,
                handle: handleMap.get(img.name)!,
                directoryId: directory.id, // CRITICAL: Associate cached images with current directory
            }));

            if (finalCachedImages.length > 0) {
                addImages(finalCachedImages);
            }

            let finalImages: IndexedImage[] = finalCachedImages;

            if (diff.deletedFileIds.length > 0) {
                removeImages(diff.deletedFileIds);
            }

            if (diff.newAndModifiedFiles.length > 0) {
                const filesToProcessNames = diff.newAndModifiedFiles.map(f => f.name);
                const fileHandles = await getFileHandles(directory.handle, directory.path, filesToProcessNames);

                setProgress({ current: 0, total: diff.newAndModifiedFiles.length });

                const newlyProcessedImages: IndexedImage[] = [];
                const handleBatchProcessed = (batch: IndexedImage[]) => {
                    addImages(batch);
                    newlyProcessedImages.push(...batch);
                };

                const throttledSetProgress = throttle(setProgress, 200);

                await processFiles(fileHandles, throttledSetProgress, handleBatchProcessed, directory.id);

                finalImages = [...finalImages, ...newlyProcessedImages];
            }

            // After a directory is loaded/updated, re-calculate filters from all images in the store.
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

            await cacheManager.cacheData(directory.path, directory.name, finalImages, shouldScanSubfolders);
            setSuccess(`Loaded ${finalImages.length} images from ${directory.name}. ${diff.newAndModifiedFiles.length} new/updated, ${diff.cachedImages.length} from cache.`);

        } catch (err) {
            if (!(err instanceof DOMException && err.name === 'AbortError')) {
                console.error(err);
                setError(`Failed to load directory ${directory.name}. Check console for details.`);
            }
        } finally {
            setLoading(false);
        }
    }, [addImages, removeImages, clearImages, setFilterOptions, setLoading, setProgress, setError, setSuccess]);


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

                    // And finally, update the filter options from all the loaded images.
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
        loadDirectoryFromCache
    };
}

export { getFileHandles };
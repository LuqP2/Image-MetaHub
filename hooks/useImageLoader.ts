import { useCallback } from 'react';
import { useImageStore } from '../store/useImageStore';
import { processFiles } from '../services/fileIndexer';
import { cacheManager } from '../services/cacheManager';
import { IndexedImage } from '../types';

console.log('🚀 useImageLoader module loaded');

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
    for await (const entry of directoryHandle.values()) {
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
                console.warn(`Could not read directory: ${entryPath}`, e);
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
            const filePath = `${directoryPath}/${fileName}`;

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
        setDirectory, setLoading, setProgress, setError, setSuccess,
        directoryHandle, directoryPath, setFilterOptions, removeImages, addImages,
        scanSubfolders
    } = useImageStore();

    const handleSelectFolder = useCallback(async (isUpdate = false) => {
        setLoading(true);
        setError(null);
        setSuccess(null);

        // Clear file data cache when starting a new folder load
        clearFileDataCache();

        try {
            let handle: FileSystemDirectoryHandle;
            let path: string;

            if (!isUpdate || !directoryHandle || !directoryPath) {
                if (window.electronAPI) {
                    const result = await window.electronAPI.showDirectoryDialog();
                    if (result.canceled || !result.path) {
                        setLoading(false);
                        return;
                    }
                    path = result.path;
                    handle = { name: result.name || 'Selected Folder', kind: 'directory' } as any;
                    localStorage.setItem('image-metahub-electron-directory-path', path);
                    // Set the current directory in Electron main process
                    await window.electronAPI.setCurrentDirectory(path);
                } else {
                    handle = await window.showDirectoryPicker();
                    path = handle.name; // For browser, path is just the name for cache key
                }
                setDirectory(handle, path);
                localStorage.setItem('image-metahub-directory-name', handle.name);
            } else {
                handle = directoryHandle;
                path = directoryPath;
            }

            await cacheManager.init();
            const allCurrentFiles = await getDirectoryFiles(handle, path, scanSubfolders);
            const diff = await cacheManager.validateCacheAndGetDiff(path, handle.name, allCurrentFiles);

            // --- FIX: Regenerate handles for cached images ---
            const regeneratedCachedImages = diff.cachedImages.length > 0
                ? await getFileHandles(handle, path, diff.cachedImages.map(img => img.name))
                : [];

            const handleMap = new Map(regeneratedCachedImages.map(h => [h.path, h.handle]));

            const finalCachedImages = diff.cachedImages.map(img => ({
                ...img,
                handle: handleMap.get(img.name)!,
            }));

            // Add images from cache to the store immediately
            if (finalCachedImages.length > 0) {
                addImages(finalCachedImages);
            }

            let finalImages = finalCachedImages;

            if (diff.deletedFileIds.length > 0) {
                removeImages(diff.deletedFileIds);
            }

            if (diff.newAndModifiedFiles.length > 0) {
                const filesToProcessNames = diff.newAndModifiedFiles.map(f => f.name);
                const fileHandles = await getFileHandles(handle, path, filesToProcessNames);

                // Initialize progress with total files to process
                setProgress({ current: 0, total: diff.newAndModifiedFiles.length });

                const newlyProcessedImages: IndexedImage[] = [];
                const handleBatchProcessed = (batch: IndexedImage[]) => {
                    addImages(batch); // Update the store incrementally
                    newlyProcessedImages.push(...batch); // Collect for final processing
                };

                // Create throttled progress update function (max 5 updates per second)
                const throttledSetProgress = throttle(setProgress, 200);

                await processFiles(fileHandles, throttledSetProgress, handleBatchProcessed);

                finalImages = [...finalImages, ...newlyProcessedImages];
            }

            // --- Recalculate Filters from the final complete list ---
            const models = new Set<string>();
            const loras = new Set<string>();
            const schedulers = new Set<string>();

            for (const image of finalImages) {
                if (image.models && image.models.length > 0) image.models.forEach(model => models.add(model));
                if (image.loras && image.loras.length > 0) image.loras.forEach(lora => loras.add(lora));
                if (image.scheduler) schedulers.add(image.scheduler);
            }

            setFilterOptions({
                models: Array.from(models).sort(),
                loras: Array.from(loras).sort(),
                schedulers: Array.from(schedulers).sort(),
            });
            // --- End of Filter Extraction ---

            await cacheManager.cacheData(path, handle.name, finalImages);
            setSuccess(`Loaded ${finalImages.length} images. ${diff.newAndModifiedFiles.length} new/updated, ${diff.cachedImages.length} from cache.`);

        } catch (err) {
            if (!(err instanceof DOMException && err.name === 'AbortError')) {
                console.error(err);
                setError("Failed to load directory. Check console for details.");
            }
        } finally {
            setLoading(false);
        }
    }, [directoryHandle, directoryPath, scanSubfolders, setDirectory, setLoading, setProgress, setError, setSuccess, setFilterOptions, addImages, removeImages]);

    const handleUpdateFolder = useCallback(async () => {
        if (!directoryHandle || !directoryPath) {
            setError("No directory selected to update.");
            return;
        }
        await handleSelectFolder(true);
    }, [directoryHandle, directoryPath, handleSelectFolder, setError]);

    return { handleSelectFolder, handleUpdateFolder };
}

export { getFileHandles };
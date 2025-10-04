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

// Dynamic Electron detection
const getIsElectron = () => typeof window !== 'undefined' && (window as any).electronAPI;

// Helper for getting files recursively in the browser
async function getFilesRecursivelyWeb(directoryHandle: FileSystemDirectoryHandle, path: string = ''): Promise<{ name: string; lastModified: number }[]> {
    const files = [];
    for await (const entry of (directoryHandle as any).values()) {
        const entryPath = path ? `${path}/${entry.name}` : entry.name;
        if (entry.kind === 'file' && (entry.name.endsWith('.png') || entry.name.endsWith('.jpg') || entry.name.endsWith('.jpeg'))) {
            const file = await entry.getFile();
            files.push({ name: entryPath, lastModified: file.lastModified });
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
        return result.success && result.files ? result.files : [];
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
        if (currentHandle.kind !== 'directory') return null;
        try {
            currentHandle = i === parts.length - 1 ? await currentHandle.getFileHandle(part) : await currentHandle.getDirectoryHandle(part);
        } catch (e) {
            return null;
        }
    }
    return currentHandle.kind === 'file' ? currentHandle as FileSystemFileHandle : null;
}

async function getFileHandles(directoryHandle: FileSystemDirectoryHandle, directoryPath: string, fileNames: string[]): Promise<{handle: FileSystemFileHandle, path: string}[]> {
    const handles: {handle: FileSystemFileHandle, path: string}[] = [];

    if (getIsElectron()) {
        for (const fileName of fileNames) {
            const joinResult = await window.electronAPI.joinPaths(directoryPath, fileName);
            const filePath = joinResult.success ? joinResult.path : `${directoryPath}/${fileName}`;
            const mockHandle = {
                name: fileName,
                kind: 'file' as const,
                _filePath: filePath,
                getFile: async () => {
                    const fileResult = await window.electronAPI.readFile(filePath);
                    if (fileResult.success && fileResult.data) {
                        const type = fileName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                        return new File([new Uint8Array(fileResult.data)], fileName, { type });
                    }
                    throw new Error(`Failed to read file: ${filePath}`);
                }
            };
            handles.push({ handle: mockHandle as any, path: fileName });
        }
    } else {
        for (const fileName of fileNames) {
            const handle = await getHandleFromPath(directoryHandle, fileName);
            if (handle) handles.push({ handle, path: fileName });
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
            const cachedImages = await cacheManager.getCachedImagesForDirectory(directory.id);

            if (cachedImages.length > 0) {
                const imagesWithHandles = cachedImages.map(img => ({
                    ...img,
                    handle: { name: img.name, kind: 'file' } as any, // Mock handle
                }));
                addImages(imagesWithHandles);
                log(`Loaded ${cachedImages.length} images from cache for ${directory.name}`);
            }
        } catch (err) {
            error(`Failed to load directory from cache ${directory.name}:`, err);
        }
    }, [addImages]);

    const loadDirectory = useCallback(async (directory: Directory, isUpdate: boolean) => {
        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            if (getIsElectron()) {
                await window.electronAPI.updateAllowedPaths(useImageStore.getState().directories.map(d => d.path));
            }

            await cacheManager.init();
            const shouldScanSubfolders = useImageStore.getState().scanSubfolders;

            if (isUpdate) {
                clearImages(directory.id);
            }

            const allCurrentFiles = await getDirectoryFiles(directory.handle, directory.path, shouldScanSubfolders);
            const diff = await cacheManager.validateCacheAndGetDiff(directory.id, allCurrentFiles);

            const regeneratedCachedImages = diff.cachedImages.length > 0
                ? await getFileHandles(directory.handle, directory.path, diff.cachedImages.map(img => img.name))
                : [];

            const handleMap = new Map(regeneratedCachedImages.map(h => [h.path, h.handle]));
            const finalCachedImages = diff.cachedImages.map(img => ({
                ...img,
                handle: handleMap.get(img.name)!,
            }));

            if (finalCachedImages.length > 0) {
                addImages(finalCachedImages);
            }

            if (diff.deletedFileIds.length > 0) {
                removeImages(diff.deletedFileIds);
            }

            let newlyProcessedImages: IndexedImage[] = [];
            if (diff.newAndModifiedFiles.length > 0) {
                const fileHandles = await getFileHandles(directory.handle, directory.path, diff.newAndModifiedFiles.map(f => f.name));
                setProgress({ current: 0, total: fileHandles.length });

                const handleBatchProcessed = (batch: IndexedImage[]) => {
                    addImages(batch);
                    newlyProcessedImages.push(...batch);
                };
                const throttledSetProgress = throttle(setProgress, 200);

                await processFiles(fileHandles, throttledSetProgress, handleBatchProcessed, directory.id);
            }

            // After processing, cache only the newly processed images
            if (newlyProcessedImages.length > 0) {
                await cacheManager.cacheImages(newlyProcessedImages);
            }

            // After everything, re-calculate filters from the entire store.
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

            setSuccess(`Scan complete for ${directory.name}. Found ${diff.newAndModifiedFiles.length} new/updated images, loaded ${finalCachedImages.length} from cache.`);

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
                path = handle.name;
                name = handle.name;
            }

            const directoryId = path;
            if (useImageStore.getState().directories.some(d => d.id === directoryId)) {
                setError(`Directory "${name}" is already loaded.`);
                return;
            }

            const newDirectory: Directory = { id: directoryId, path, name, handle };
            addDirectory(newDirectory);

            if (getIsElectron()) {
                localStorage.setItem('image-metahub-directories', JSON.stringify(useImageStore.getState().directories.map(d => d.path)));
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
                    if (paths.length === 0) return setLoading(false);

                    for (const path of paths) {
                        const newDirectory: Directory = {
                            id: path,
                            path,
                            name: path.split(/\/|\\/).pop() || 'Loaded Folder',
                            handle: { name: path, kind: 'directory' } as any,
                        };
                        addDirectory(newDirectory);
                    }

                    const directoriesToLoad = useImageStore.getState().directories;
                    await Promise.all(directoriesToLoad.map(dir => loadDirectoryFromCache(dir)));

                    await window.electronAPI.updateAllowedPaths(directoriesToLoad.map(d => d.path));

                    const allImages = useImageStore.getState().images;
                    const models = new Set<string>();
                    const loras = new Set<string>();
                    const schedulers = new Set<string>();

                    for (const image of allImages) {
                        if (image.models?.length) image.models.forEach(m => models.add(m));
                        if (image.loras?.length) image.loras.forEach(l => loras.add(l));
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
        const { removeDirectory: removeDirectoryFromStore, clearImages } = useImageStore.getState();
        
        // Clear images from the specific directory in the UI
        clearImages(directoryId);
        // Remove the directory from the store, which also updates localStorage
        removeDirectoryFromStore(directoryId);
        // Clear the actual cache for this directory in IndexedDB
        await cacheManager.clearDirectoryCache(directoryId);

        if (getIsElectron()) {
            const updatedPaths = useImageStore.getState().directories.map(d => d.path);
            await window.electronAPI.updateAllowedPaths(updatedPaths);
        }
    }, []);

    return {
        handleSelectFolder,
        handleUpdateFolder,
        handleLoadFromStorage,
        handleRemoveDirectory,
        loadDirectory
    };
}

export { getFileHandles };
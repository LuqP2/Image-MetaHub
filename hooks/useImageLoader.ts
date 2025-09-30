import { useCallback } from 'react';
import { useImageStore } from '../store/useImageStore';
import { processFiles } from '../services/fileIndexer';
import { cacheManager } from '../services/cacheManager';
import { IndexedImage } from '../types';

console.log('🚀 useImageLoader module loaded');

// Dynamic Electron detection - check at runtime, not module load time
const getIsElectron = () => {
  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
  console.log('🔍 Electron detection:', {
    isElectron,
    hasWindow: typeof window !== 'undefined',
    hasElectronAPI: !!(window as any).electronAPI,
    electronAPIMethods: isElectron ? Object.keys((window as any).electronAPI) : []
  });
  return isElectron;
};

// Global cache for file data to avoid Zustand serialization issues
const fileDataCache = new Map<string, Uint8Array>();

// Function to clear file data cache
function clearFileDataCache() {
  console.log(`🧹 Clearing file data cache (${fileDataCache.size} entries)`);
  fileDataCache.clear();
}

async function getDirectoryFiles(directoryHandle: FileSystemDirectoryHandle, directoryPath: string): Promise<{ name: string; lastModified: number }[]> {
    if (getIsElectron()) {
        const result = await (window as any).electronAPI.listDirectoryFiles(directoryPath);
        if (result.success && result.files) {
            return result.files;
        }
        return [];
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

async function getFileHandles(directoryHandle: FileSystemDirectoryHandle, directoryPath: string, fileNames: string[]): Promise<{handle: FileSystemFileHandle, path: string}[]> {
    const handles: {handle: FileSystemFileHandle, path: string}[] = [];
    const filesToGet = new Set(fileNames);

    if (getIsElectron()) {
        console.log('🚀 Electron detected: Using batch file reading optimization');
        // Use batch reading for Electron to reduce IPC overhead
        const fileNamesArray = Array.from(filesToGet);
        const BATCH_SIZE = 50; // Read 50 files at a time
        const batches: string[][] = [];

        // Split files into batches
        for (let i = 0; i < fileNamesArray.length; i += BATCH_SIZE) {
            batches.push(fileNamesArray.slice(i, i + BATCH_SIZE));
        }

        console.log(`📦 Reading ${fileNamesArray.length} files in ${batches.length} batches of ${BATCH_SIZE} files each`);

        // Process each batch
        for (const batch of batches) {
            const filePaths = batch.map(name => `${directoryPath}/${name}`);
            console.log(`🔄 Processing batch of ${batch.length} files...`);
            const batchResult = await window.electronAPI.readFilesBatch(filePaths);

            if (batchResult.success && batchResult.files) {
                for (const fileResult of batchResult.files) {
                    if (fileResult.success && fileResult.data) {
                        const fileName = fileResult.path.split('/').pop() || fileResult.path.split('\\').pop() || '';
                        const lowerName = fileName.toLowerCase();
                        const type = lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg';

                        // Create a lightweight handle that references the file by path
                        // File data is stored in global cache, not in the handle itself
                        const filePath = `${directoryPath}/${fileName}`;

                        const mockHandle = {
                            name: fileName,
                            kind: 'file' as const,
                            // Store file path for later retrieval
                            _filePath: filePath,
                            getFile: async () => {
                                // Get file data from global cache
                                const cachedData = fileDataCache.get(filePath);
                                if (!cachedData) {
                                    // If not in cache, read from disk (fallback)
                                    if (getIsElectron()) {
                                        const fileResult = await window.electronAPI.readFile(filePath);
                                        if (fileResult.success && fileResult.data) {
                                            const freshData = new Uint8Array(fileResult.data);
                                            fileDataCache.set(filePath, freshData);
                                            const lowerName = fileName.toLowerCase();
                                            const type = lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg';
                                            return new File([freshData as any], fileName, { type });
                                        }
                                    }
                                    throw new Error(`File data not available: ${filePath}`);
                                }
                                const lowerName = fileName.toLowerCase();
                                const type = lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg';
                                return new File([cachedData as any], fileName, { type });
                            }
                        };
                        handles.push({ handle: mockHandle as any, path: fileName });
                    } else {
                        console.warn(`Failed to read file in batch: ${fileResult.path}`, fileResult.error);
                    }
                }
            } else {
                console.error('Batch read failed:', batchResult.error);
                // Fallback to individual reads for this batch
                for (const filePath of filePaths) {
                    try {
                        const fileResult = await window.electronAPI.readFile(filePath);
                        if (fileResult.success && fileResult.data) {
                            const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '';
                            const lowerName = fileName.toLowerCase();
                            const type = lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg';

                            const mockHandle = {
                                name: fileName,
                                kind: 'file' as const,
                                // Store file path for later retrieval
                                _filePath: filePath,
                                getFile: async () => {
                                    // Get file data from global cache
                                    const cachedData = fileDataCache.get(filePath);
                                    if (!cachedData) {
                                        // If not in cache, read from disk (fallback)
                                        if (getIsElectron()) {
                                            const fileResult = await window.electronAPI.readFile(filePath);
                                            if (fileResult.success && fileResult.data) {
                                                const freshData = new Uint8Array(fileResult.data);
                                                fileDataCache.set(filePath, freshData);
                                                const lowerName = fileName.toLowerCase();
                                                const type = lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg';
                                                return new File([freshData as any], fileName, { type });
                                            }
                                        }
                                        throw new Error(`File data not available: ${filePath}`);
                                    }
                                    const lowerName = fileName.toLowerCase();
                                    const type = lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg';
                                    return new File([cachedData as any], fileName, { type });
                                }
                            };
                            handles.push({ handle: mockHandle as any, path: fileName });
                        }
                    } catch (error) {
                        console.warn(`Failed to read file individually: ${filePath}`, error);
                    }
                }
            }
        }
    } else {
        // Browser implementation remains unchanged
        for await (const entry of (directoryHandle as any).values()) {
            if (filesToGet.has(entry.name)) {
                handles.push({ handle: entry, path: entry.name });
            }
        }
    }
    return handles;
}

export function useImageLoader() {
    const {
        setDirectory, setLoading, setProgress, setError, setSuccess,
        directoryHandle, directoryPath, setFilterOptions, removeImages, addImages
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
            const allCurrentFiles = await getDirectoryFiles(handle, path);
            const diff = await cacheManager.validateCacheAndGetDiff(handle.name, allCurrentFiles);

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

                await processFiles(fileHandles, setProgress, handleBatchProcessed);

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

            await cacheManager.cacheData(handle.name, finalImages);
            setSuccess(`Loaded ${finalImages.length} images. ${diff.newAndModifiedFiles.length} new/updated, ${diff.cachedImages.length} from cache.`);

        } catch (err) {
            if (!(err instanceof DOMException && err.name === 'AbortError')) {
                console.error(err);
                setError("Failed to load directory. Check console for details.");
            }
        } finally {
            setLoading(false);
        }
    }, [directoryHandle, directoryPath, setDirectory, setLoading, setProgress, setError, setSuccess, setFilterOptions, addImages, removeImages]);

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
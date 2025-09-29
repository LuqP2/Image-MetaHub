import { useCallback, useRef } from 'react';
import { useImageStore } from '../store/useImageStore';
import { processDirectory, processFiles } from '../services/fileIndexer';
import { cacheManager } from '../services/cacheManager';
import { IndexedImage } from '../types';

const isElectron = typeof window !== 'undefined' && window.electronAPI;

async function getDirectoryFiles(directoryHandle: FileSystemDirectoryHandle, directoryPath: string): Promise<{ name: string; lastModified: number }[]> {
    if (isElectron) {
        const result = await window.electronAPI.listDirectoryFiles(directoryPath);
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

    if (isElectron) {
        for (const name of filesToGet) {
            const mockHandle = {
                name,
                kind: 'file' as const,
                getFile: async () => {
                    const fullPath = `${directoryPath}/${name}`;
                    const fileResult = await window.electronAPI.readFile(fullPath);
                    if (fileResult.success && fileResult.data) {
                        // We don't have the real lastModified here without another IPC call, but it's only used for diffing which is already done.
                        return new File([new Uint8Array(fileResult.data)], name, { type: 'image/png' });
                    }
                    throw new Error(`Failed to read file in Electron: ${name}`);
                }
            };
            handles.push({ handle: mockHandle as any, path: name });
        }
    } else {
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
        setDirectory, setLoading, setProgress, setImages, setError, setSuccess,
        directoryHandle, directoryPath, setFilterOptions, removeImages, addImages
    } = useImageStore();

    const handleSelectFolder = useCallback(async (isUpdate = false) => {
        setLoading(true);
        setError(null);
        setSuccess(null);

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

            let finalImages = diff.cachedImages;

            if (diff.deletedFileIds.length > 0) {
                removeImages(diff.deletedFileIds);
            }

            if (diff.newAndModifiedFiles.length > 0) {
                const filesToProcessNames = diff.newAndModifiedFiles.map(f => f.name);
                const fileHandles = await getFileHandles(handle, path, filesToProcessNames);

                const newIndexedImages = await processFiles(fileHandles, setProgress);

                addImages(newIndexedImages);
                finalImages = [...finalImages, ...newIndexedImages];
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
    }, [directoryHandle, directoryPath, setDirectory, setLoading, setProgress, setImages, setError, setSuccess, setFilterOptions, addImages, removeImages]);

    const handleUpdateFolder = useCallback(async () => {
        if (!directoryHandle || !directoryPath) {
            setError("No directory selected to update.");
            return;
        }
        await handleSelectFolder(true);
    }, [directoryHandle, directoryPath, handleSelectFolder, setError]);

    return { handleSelectFolder, handleUpdateFolder };
}
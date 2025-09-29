import { useCallback, useRef } from 'react';
import { useImageStore } from '../store/useImageStore';
import { processDirectory, processFiles } from '../services/fileIndexer';
import { cacheManager } from '../services/cacheManager';
import { IndexedImage } from '../types';

const isElectron = typeof window !== 'undefined' && window.electronAPI;

async function getAllFileHandles(directoryHandle: FileSystemDirectoryHandle, directoryPath: string): Promise<{handle: FileSystemFileHandle, path: string}[]> {
    const entries = [];

    if (isElectron) {
        const result = await window.electronAPI.listDirectoryFiles(directoryPath);
        if (result.success && result.files) {
            for (const fileInfo of result.files) {
                const mockHandle = {
                    name: fileInfo.name,
                    kind: 'file' as const,
                    getFile: async () => {
                        const fullPath = `${directoryPath}/${fileInfo.name}`;
                        const fileResult = await window.electronAPI.readFile(fullPath);
                        if (fileResult.success && fileResult.data) {
                            return new File([new Uint8Array(fileResult.data)], fileInfo.name, { type: 'image/png', lastModified: fileInfo.lastModified });
                        }
                        throw new Error(`Failed to read file in Electron: ${fileInfo.name}`);
                    }
                };
                entries.push({ handle: mockHandle as any, path: fileInfo.name });
            }
        }
    } else {
        for await (const entry of (directoryHandle as any).values()) {
            if (entry.kind === 'file' && (entry.name.endsWith('.png') || entry.name.endsWith('.jpg') || entry.name.endsWith('.jpeg'))) {
                entries.push({ handle: entry, path: entry.name });
            }
        }
    }
    return entries;
}

export function useImageLoader() {
    const {
        setDirectory, setLoading, setProgress, setImages, setError, setSuccess,
        directoryHandle, directoryPath, setFilterOptions
    } = useImageStore();

    const fileHandlesCache = useRef<Map<string, {handle: FileSystemFileHandle, path: string}[]>>(new Map());

    const handleSelectFolder = useCallback(async () => {
        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            let handle: FileSystemDirectoryHandle;
            let path: string;

            if (window.electronAPI) {
                const result = await window.electronAPI.showDirectoryDialog();
                if (result.canceled || !result.path) {
                    setLoading(false);
                    return;
                }
                path = result.path;
                handle = { name: result.name || 'Selected Folder', kind: 'directory' } as any;
                localStorage.setItem('invokeai-electron-directory-path', path);
            } else {
                handle = await window.showDirectoryPicker();
                path = handle.name;
            }

            setDirectory(handle, path);
            localStorage.setItem('invokeai-directory-name', handle.name);

            await cacheManager.init();
            const allFiles = await getAllFileHandles(handle, path);
            const indexedImages = isElectron ? await processFiles(allFiles, setProgress) : await processDirectory(handle, setProgress);

            // --- Filter Extraction ---
            const models = new Set<string>();
            const loras = new Set<string>();
            const schedulers = new Set<string>();

            for (const image of indexedImages) {
                if (image.models && image.models.length > 0) {
                    image.models.forEach(model => models.add(model));
                }
                if (image.loras && image.loras.length > 0) {
                    image.loras.forEach(lora => loras.add(lora));
                }
                if (image.scheduler) {
                    schedulers.add(image.scheduler);
                }
            }

            setFilterOptions({
                models: Array.from(models).sort(),
                loras: Array.from(loras).sort(),
                schedulers: Array.from(schedulers).sort(),
            });
            // --- End of Filter Extraction ---

            setImages(indexedImages);
            await cacheManager.cacheData(handle.name, indexedImages);
            setSuccess(`Loaded ${indexedImages.length} images.`);

        } catch (err) {
            if (!(err instanceof DOMException && err.name === 'AbortError')) {
                setError("Failed to load directory. Check console for details.");
            }
        } finally {
            setLoading(false);
        }
    }, [setDirectory, setLoading, setProgress, setImages, setError, setSuccess, setFilterOptions]);

    const handleUpdateFolder = useCallback(async () => {
        if (!directoryHandle || !directoryPath) {
            setError("No directory selected to update.");
            return;
        }
        setLoading(true);
        // This logic can be expanded to do incremental updates
        await handleSelectFolder();
    }, [directoryHandle, directoryPath, handleSelectFolder, setError, setLoading]);

    return { handleSelectFolder, handleUpdateFolder };
}
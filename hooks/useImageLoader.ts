import { useCallback, useEffect } from 'react';
import { useImageStore } from '../store/useImageStore';
import { Directory, IndexedImage, ImageMetadata } from '../types';

// Type for database records
interface DatabaseImageRecord {
  id: string;
  directory_id: number;
  relative_path: string;
  last_modified: number;
  metadata_string: string;
}

const getIsElectron = () => {
  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI && typeof (window as any).electronAPI.getDirectoryId === 'function';
  console.log('[getIsElectron] Is Electron:', isElectron, 'electronAPI exists:', !!(window as any).electronAPI, 'getDirectoryId exists:', typeof (window as any).electronAPI?.getDirectoryId);
  return isElectron;
};

export function useImageLoader() {
  const {
    addDirectory,
    setLoading,
    setProgress,
    setError,
    setSuccess,
    addImages,
    clearImages,
    setIndexingState,
  } = useImageStore();

  useEffect(() => {
    if (!getIsElectron()) return;

    const removeProgressListener = window.electronAPI.onIndexingProgress(setProgress);
    const removeBatchListener = window.electronAPI.onIndexingBatchResult(({ batch }) => addImages(batch));
    const removeErrorListener = window.electronAPI.onIndexingError(({ error }) => setError(error));
    const removeCompleteListener = window.electronAPI.onIndexingComplete(async ({ directoryId }) => {
      setSuccess(`Finished indexing directory.`);
      setIndexingState('completed');
      
      // After indexing completes, try to load the newly indexed images from database
      const { directories } = useImageStore.getState();
      const directory = directories.find(d => d.id === directoryId.toString());
      if (directory) {
        await loadImagesFromDatabase(directory);
      }
      
      setTimeout(() => setIndexingState('idle'), 3000);
    });

    return () => {
      removeProgressListener();
      removeBatchListener();
      removeErrorListener();
      removeCompleteListener();
    };
  }, [addImages, setError, setSuccess, setProgress, setIndexingState]);

  const loadImagesFromDatabase = useCallback(async (directory: Directory) => {
    if (!getIsElectron()) return false;

    try {
      console.log(`[loadImagesFromDatabase] Loading images from database for: ${directory.path}`);
      
      // Get the database directory ID from the path
      const directoryId = await window.electronAPI.getDirectoryId(directory.path);
      console.log(`[loadImagesFromDatabase] Database directory ID: ${directoryId}`);
      
      if (!directoryId) {
        console.log(`[loadImagesFromDatabase] Directory not found in database: ${directory.path}`);
        return false;
      }

      const result = await window.electronAPI.getImages({ directoryId });
      console.log(`[loadImagesFromDatabase] Got result:`, result);
      console.log(`[loadImagesFromDatabase] Result type:`, typeof result);
      console.log(`[loadImagesFromDatabase] Result keys:`, result ? Object.keys(result) : 'null/undefined');
      if (!result || !result.images || result.images.length === 0) {
        console.log(`[loadImagesFromDatabase] No images in database for directory ${directory.path}`);
        return false; // No images in database
      }

      console.log(`[loadImagesFromDatabase] Processing ${result.images.length} images from database`);
      // Convert database records to IndexedImage objects
      const indexedImages: IndexedImage[] = [];

      for (const dbRecord of result.images as unknown as DatabaseImageRecord[]) {
        try {
          // For Electron, we need to create a file handle from the path
          // Since we don't have a direct API, we'll create a minimal handle object
          const joinResult = await window.electronAPI.joinPaths(directory.path, dbRecord.relative_path);
          if (!joinResult.success || !joinResult.path) {
            console.error(`[loadImagesFromDatabase] Failed to join paths: ${joinResult.error}`);
            continue;
          }
          const fullPath = joinResult.path;
          const pathParts = fullPath.split(/[/\\]/);
          const fileName = pathParts[pathParts.length - 1];
          const handle = {
            _filePath: fullPath, // Store the path for Electron APIs
            name: fileName,
            kind: 'file' as const,
            getFile: async () => {
              console.log('[RENDERER] getFile called for path:', fullPath);
              // Read file using Electron API when needed
              const fileResult = await window.electronAPI.readFile(fullPath);
              console.log('[RENDERER] readFile result:', { success: fileResult.success, error: fileResult.error, hasData: !!fileResult.data });
              if (fileResult.success && fileResult.data) {
                // Convert the data to a File object
                const data = new Uint8Array(fileResult.data);
                const blob = new Blob([data]);
                return new File([blob], fileName, { 
                  lastModified: dbRecord.last_modified 
                });
              }
              throw new Error(`Failed to read file: ${fileResult.error || 'Unknown error'}`);
            }
          } as unknown as FileSystemFileHandle;

          // Parse metadata from stored string
          let metadata: ImageMetadata = {};
          let normalizedMetadata: Record<string, unknown> = {};

          if (dbRecord.metadata_string) {
            try {
              metadata = JSON.parse(dbRecord.metadata_string);
              // Basic normalization - extract common fields
              normalizedMetadata = {
                models: Array.isArray(metadata.models) ? metadata.models : [],
                loras: Array.isArray(metadata.loras) ? metadata.loras : [],
                scheduler: typeof metadata.scheduler === 'string' ? metadata.scheduler : '',
                prompt: typeof metadata.prompt === 'string' ? metadata.prompt : '',
                negativePrompt: typeof metadata.negative_prompt === 'string' ? metadata.negative_prompt : '',
                cfgScale: typeof metadata.cfg_scale === 'number' ? metadata.cfg_scale : 
                         typeof (metadata as unknown as Record<string, unknown>).cfgScale === 'number' ? (metadata as unknown as Record<string, unknown>).cfgScale as number : null,
                steps: typeof metadata.steps === 'number' ? metadata.steps : null,
                seed: typeof metadata.seed === 'number' ? metadata.seed : null,
                width: typeof metadata.width === 'number' ? metadata.width : null,
                height: typeof metadata.height === 'number' ? metadata.height : null,
                dimensions: typeof metadata.dimensions === 'string' ? metadata.dimensions : 
                          `${((metadata as unknown as Record<string, unknown>).width as number) || 0}x${((metadata as unknown as Record<string, unknown>).height as number) || 0}`,
              };
            } catch (parseError) {
              console.warn(`[loadImagesFromDatabase] Failed to parse metadata for ${dbRecord.relative_path}:`, parseError);
            }
          }

          const indexedImage: IndexedImage = {
            id: dbRecord.id,
            name: dbRecord.relative_path.split(/[/\\]/).pop() || dbRecord.relative_path,
            handle: handle as unknown as FileSystemFileHandle,
            directoryId: directory.id,
            metadata: metadata as ImageMetadata,
            metadataString: dbRecord.metadata_string || '',
            lastModified: dbRecord.last_modified,
            models: Array.isArray(normalizedMetadata.models) ? normalizedMetadata.models as string[] : [],
            loras: Array.isArray(normalizedMetadata.loras) ? normalizedMetadata.loras as string[] : [],
            scheduler: typeof normalizedMetadata.scheduler === 'string' ? normalizedMetadata.scheduler : '',
            board: typeof normalizedMetadata.board === 'string' ? normalizedMetadata.board : '',
            prompt: typeof normalizedMetadata.prompt === 'string' ? normalizedMetadata.prompt : '',
            negativePrompt: typeof normalizedMetadata.negativePrompt === 'string' ? normalizedMetadata.negativePrompt : '',
            cfgScale: typeof normalizedMetadata.cfgScale === 'number' ? normalizedMetadata.cfgScale : null,
            steps: typeof normalizedMetadata.steps === 'number' ? normalizedMetadata.steps : null,
            seed: typeof normalizedMetadata.seed === 'number' ? normalizedMetadata.seed : null,
            dimensions: typeof normalizedMetadata.dimensions === 'string' ? normalizedMetadata.dimensions : '',
          };

          indexedImages.push(indexedImage);
        } catch (error) {
          console.warn(`[loadImagesFromDatabase] Failed to create IndexedImage for ${dbRecord.relative_path}:`, error);
        }
      }

      console.log(`[loadImagesFromDatabase] Successfully created ${indexedImages.length} IndexedImage objects`);
      if (indexedImages.length > 0) {
        addImages(indexedImages);
        setSuccess(`Loaded ${indexedImages.length} images from database.`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[loadImagesFromDatabase] Failed to load images from database:', error);
      return false;
    }
  }, [addImages, setSuccess]);

  const loadDirectory = useCallback(async (directory: Directory) => {
    console.log(`[loadDirectory] Starting load for directory: ${directory.id} (${directory.path})`);
    console.log(`[loadDirectory] Checking Electron...`);
    const isElectronCheck = getIsElectron();
    console.log(`[loadDirectory] Is Electron result: ${isElectronCheck}`);
    
    setLoading(true);
    setError(null);
    setSuccess(null);
    setIndexingState('indexing');
    clearImages(directory.id); // Clear previous images for this directory

    if (isElectronCheck) {
      // Update allowed paths for security
      const { directories } = useImageStore.getState();
      const directoryPaths = directories.map(d => d.path);
      console.log('[loadDirectory] Updating allowed paths:', directoryPaths);
      await window.electronAPI.updateAllowedPaths(directoryPaths);
      
      console.log(`[loadDirectory] Electron detected, trying to load from database first`);
      // First try to load from database
      const loadedFromDb = await loadImagesFromDatabase(directory);
      console.log(`[loadDirectory] Database load result: ${loadedFromDb}`);
      if (loadedFromDb) {
        // Images were loaded from database, no need to re-index
        console.log(`[loadDirectory] Images loaded from database, skipping indexing`);
        setIndexingState('completed');
        setLoading(false);
        setTimeout(() => setIndexingState('idle'), 3000);
        return;
      }

      console.log(`[loadDirectory] No images in database, starting fresh indexing`);
      // No images in database, start fresh indexing
      await window.electronAPI.startIndexing(directory.path);
    } else {
      setError('File system access is only available in the Electron app.');
      setLoading(false);
    }
  }, [setLoading, setError, setSuccess, setIndexingState, clearImages, loadImagesFromDatabase]);

  const handleSelectFolder = useCallback(async () => {
    if (!getIsElectron()) {
      setError('Folder selection is only available in the Electron app.');
      return;
    }

    const result = await window.electronAPI.showDirectoryDialog();
    if (result.canceled || !result.path) return;

    const { path, name } = result;
    const directoryId = path;

    if (useImageStore.getState().directories.some(d => d.id === directoryId)) {
      setError(`Directory "${name}" is already loaded.`);
      return;
    }

    const newDirectory: Directory = { id: directoryId, path, name, handle: {} as FileSystemDirectoryHandle };
    addDirectory(newDirectory);
    await loadDirectory(newDirectory);
  }, [addDirectory, loadDirectory, setError]);

  const handleLoadFromStorage = useCallback(async () => {
    console.log('[RENDERER] handleLoadFromStorage called - checking Electron...');
    if (!getIsElectron()) {
      console.log('[RENDERER] Not in Electron, skipping handleLoadFromStorage');
      return;
    }

    console.log('[RENDERER] In Electron, proceeding with handleLoadFromStorage');
    const storedPaths = localStorage.getItem('image-metahub-directories');
    console.log('[RENDERER] localStorage storedPaths:', storedPaths);
    if (storedPaths) {
      try {
        const paths = JSON.parse(storedPaths) as string[];
        console.log(`[handleLoadFromStorage] Found ${paths.length} stored paths:`, paths);
        for (const path of paths) {
          const name = path.split(/[/\\\\]/).pop() || 'Loaded Folder';
          const newDirectory: Directory = { id: path, path, name, handle: {} as FileSystemDirectoryHandle };
          console.log(`[handleLoadFromStorage] Adding directory: ${path}`);
          addDirectory(newDirectory);
          // Load directories one by one
          console.log(`[handleLoadFromStorage] Loading directory: ${path}`);
          await loadDirectory(newDirectory);
        }
        
        // Update allowed paths after loading all directories
        const { directories } = useImageStore.getState();
        const directoryPaths = directories.map(d => d.path);
        console.log('[handleLoadFromStorage] Updating allowed paths:', directoryPaths);
        await window.electronAPI.updateAllowedPaths(directoryPaths);
      } catch {
        setError('Failed to load previously saved directories.');
      }
    } else {
      console.log('[handleLoadFromStorage] No stored paths found');
    }
  }, [addDirectory, loadDirectory, setError]);

  const handleUpdateFolder = useCallback(async (directoryId: string) => {
    const directory = useImageStore.getState().directories.find(d => d.id === directoryId);
    if (directory) {
      await loadDirectory(directory);
    }
  }, [loadDirectory]);

  const handleRemoveDirectory = useCallback((directoryId: string) => {
    const { removeDirectory } = useImageStore.getState();
    removeDirectory(directoryId);
  }, []);

  const cancelIndexing = useCallback(() => {
    // For now, just reset the indexing state
    // TODO: Implement proper cancellation in Electron main process
    setIndexingState('idle');
    setLoading(false);
    setProgress(null);
  }, [setIndexingState, setLoading, setProgress]);

  return {
    handleSelectFolder,
    handleUpdateFolder,
    handleLoadFromStorage,
    handleRemoveDirectory,
    loadDirectory,
    cancelIndexing,
  };
}

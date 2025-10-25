import { useCallback, useEffect } from 'react';
import { useImageStore } from '../store/useImageStore';
import { Directory } from '../types';

const getIsElectron = () => typeof window !== 'undefined' && (window as any).electronAPI;

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
    const removeCompleteListener = window.electronAPI.onIndexingComplete(({ directoryId }) => {
      setSuccess(`Finished indexing directory.`);
      setIndexingState('completed');
      setTimeout(() => setIndexingState('idle'), 3000);
    });

    return () => {
      removeProgressListener();
      removeBatchListener();
      removeErrorListener();
      removeCompleteListener();
    };
  }, [addImages, setError, setSuccess, setProgress, setIndexingState]);

  const loadDirectory = useCallback(async (directory: Directory) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    setIndexingState('indexing');
    clearImages(directory.id); // Clear previous images for this directory

    if (getIsElectron()) {
      await window.electronAPI.startIndexing(directory.path);
    } else {
      setError('File system access is only available in the Electron app.');
      setLoading(false);
    }
  }, [setLoading, setError, setSuccess, setIndexingState, clearImages]);

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
    if (!getIsElectron()) return;

    const storedPaths = localStorage.getItem('image-metahub-directories');
    if (storedPaths) {
      try {
        const paths = JSON.parse(storedPaths) as string[];
        for (const path of paths) {
          const name = path.split(/[/\\\\]/).pop() || 'Loaded Folder';
          const newDirectory: Directory = { id: path, path, name, handle: {} as FileSystemDirectoryHandle };
          addDirectory(newDirectory);
          // Load directories one by one
          await loadDirectory(newDirectory);
        }
      } catch (e) {
        setError('Failed to load previously saved directories.');
      }
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

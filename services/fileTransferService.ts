import { processFiles } from './fileIndexer';
import { transferImagePersistence } from './imageAnnotationsStorage';
import { useImageStore } from '../store/useImageStore';
import type {
  Directory,
  IndexedImage,
  IndexedImageTransferMode,
  IndexedImageTransferResultItem,
} from '../types';

interface TransferIndexedImagesParams {
  images: IndexedImage[];
  destinationDirectory: Directory;
  mode: IndexedImageTransferMode;
  onStatus?: (status: string) => void;
}

interface TransferIndexedImagesResult {
  success: boolean;
  transferredCount: number;
  failedCount: number;
  error?: string;
}

interface ElectronFileHandle extends FileSystemFileHandle {
  _filePath?: string;
}

function createMockFileHandle(fileName: string, absolutePath: string): FileSystemFileHandle {
  return {
    name: fileName,
    kind: 'file',
    _filePath: absolutePath,
    getFile: async () => {
      const fileResult = await window.electronAPI!.readFile(absolutePath);
      if (!fileResult.success || !fileResult.data) {
        throw new Error(fileResult.error || `Failed to read file: ${fileName}`);
      }

      const freshData = new Uint8Array(fileResult.data);
      return new File([freshData as any], fileName, {
        type: inferMimeTypeFromName(fileName),
        lastModified: Date.now(),
      });
    },
  } as ElectronFileHandle as FileSystemFileHandle;
}

function inferMimeTypeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.avi')) return 'video/x-msvideo';
  return 'image/jpeg';
}

function buildTransferredEntry(item: IndexedImageTransferResultItem) {
  return {
    handle: createMockFileHandle(item.fileName, item.destinationAbsolutePath),
    path: item.destinationRelativePath,
    lastModified: item.lastModified ?? Date.now(),
    size: item.size,
    type: item.type,
    birthtimeMs: item.lastModified ?? Date.now(),
  };
}

export async function transferIndexedImages({
  images,
  destinationDirectory,
  mode,
  onStatus,
}: TransferIndexedImagesParams): Promise<TransferIndexedImagesResult> {
  const setError = useImageStore.getState().setError;

  if (!window.electronAPI) {
    const error = 'File transfer is only available in the desktop app version.';
    setError(error);
    return {
      success: false,
      transferredCount: 0,
      failedCount: 0,
      error,
    };
  }

  if (!images.length) {
    const error = 'No images selected for transfer.';
    setError(error);
    return {
      success: false,
      transferredCount: 0,
      failedCount: 0,
      error,
    };
  }

  const sourceFiles = images
    .filter((image) => image.directoryId)
    .map((image) => ({
      directoryPath: image.directoryId!,
      relativePath: image.name,
    }));

  if (!sourceFiles.length) {
    const error = 'Selected images are missing source folder data.';
    setError(error);
    return {
      success: false,
      transferredCount: 0,
      failedCount: 0,
      error,
    };
  }

  const transferResult = await window.electronAPI.transferIndexedImages({
    files: sourceFiles,
    destDir: destinationDirectory.path,
    mode,
  });

  if (!transferResult.success || transferResult.transferred.length === 0) {
    setError(transferResult.error || `Failed to ${mode} images.`);
    return {
      success: false,
      transferredCount: 0,
      failedCount: transferResult.failedCount ?? 0,
      error: transferResult.error || `Failed to ${mode} images.`,
    };
  }

  const sourceByPath = new Map(
    images.map((image) => [`${image.directoryId}::${image.name}`, image]),
  );
  const annotationsMap = new Map(useImageStore.getState().annotations);

  const persistenceTransfers: Array<{ sourceImage: IndexedImage; targetImageId: string }> = [];

  onStatus?.('Preserving tags and metadata...');
  for (const item of transferResult.transferred) {
    const sourceImage = sourceByPath.get(`${item.sourceDirectoryPath}::${item.sourceRelativePath}`);
    if (!sourceImage) {
      continue;
    }

    const targetImageId = `${destinationDirectory.id}::${item.destinationRelativePath}`;
    persistenceTransfers.push({ sourceImage, targetImageId });
    await transferImagePersistence(sourceImage.id, targetImageId, 'copy');

    const sourceAnnotation = annotationsMap.get(sourceImage.id);
    if (sourceAnnotation) {
      annotationsMap.set(targetImageId, {
        ...sourceAnnotation,
        imageId: targetImageId,
        updatedAt: Date.now(),
      });
    }
  }

  const transferredEntries = transferResult.transferred.map(buildTransferredEntry);
  const fileStatsMap = new Map(
    transferResult.transferred.map((item) => [
      item.destinationRelativePath,
      {
        size: item.size,
        type: item.type,
        birthtimeMs: item.lastModified,
      },
    ]),
  );

  const addImages = useImageStore.getState().addImages;
  const flushPendingImages = useImageStore.getState().flushPendingImages;
  const removeImages = useImageStore.getState().removeImages;
  const clearImageSelection = useImageStore.getState().clearImageSelection;
  const setSuccess = useImageStore.getState().setSuccess;
  const refreshAvailableTags = useImageStore.getState().refreshAvailableTags;

  if (mode === 'move') {
    for (const transfer of persistenceTransfers) {
      annotationsMap.delete(transfer.sourceImage.id);
    }
  }

  useImageStore.setState({ annotations: annotationsMap });

  const transferredCount = transferResult.transferred.length;
  const failedCount = transferResult.failedCount ?? 0;
  const actionLabel = mode === 'move' ? 'Moved' : 'Copied';
  const shouldRelyOnWatcher = destinationDirectory.autoWatch === true;

  if (shouldRelyOnWatcher) {
    if (mode === 'move') {
      for (const transfer of persistenceTransfers) {
        await transferImagePersistence(transfer.sourceImage.id, transfer.targetImageId, 'move');
      }
    }

    if (mode === 'move') {
      removeImages(images.map((image) => image.id));
    }

    clearImageSelection();
    void refreshAvailableTags();

    const statusMessage = failedCount > 0
      ? `${actionLabel} ${transferredCount} image${transferredCount === 1 ? '' : 's'} with ${failedCount} failure${failedCount === 1 ? '' : 's'}. Destination will refresh shortly.`
      : `${actionLabel} ${transferredCount} image${transferredCount === 1 ? '' : 's'} to ${destinationDirectory.name}. Destination will refresh shortly.`;

    setSuccess(statusMessage);

    return {
      success: transferredCount > 0,
      transferredCount,
      failedCount,
      error: transferResult.error,
    };
  }

  onStatus?.('Indexing transferred files...');
  const { phaseB } = await processFiles(
    transferredEntries,
    () => {},
    () => {},
    destinationDirectory.id,
    destinationDirectory.name,
    false,
    () => {},
    undefined,
    undefined,
    {
      fileStats: fileStatsMap,
      onEnrichmentBatch: (batch) => {
        addImages(batch);
      },
    },
  );

  await phaseB;
  flushPendingImages();

  if (mode === 'move') {
    for (const transfer of persistenceTransfers) {
      await transferImagePersistence(transfer.sourceImage.id, transfer.targetImageId, 'move');
    }
    removeImages(images.map((image) => image.id));
  }

  clearImageSelection();
  void refreshAvailableTags();
  const statusMessage = failedCount > 0
    ? `${actionLabel} ${transferredCount} image${transferredCount === 1 ? '' : 's'} with ${failedCount} failure${failedCount === 1 ? '' : 's'}.`
    : `${actionLabel} ${transferredCount} image${transferredCount === 1 ? '' : 's'} to ${destinationDirectory.name}.`;

  if (transferredCount > 0) {
    setSuccess(statusMessage);
  } else {
    setError(transferResult.error || `Failed to ${mode} images.`);
  }

  return {
    success: transferredCount > 0,
    transferredCount,
    failedCount,
    error: transferResult.error,
  };
}

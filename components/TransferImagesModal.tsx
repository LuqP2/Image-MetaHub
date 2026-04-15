import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Copy, Folder, MoveRight, X } from 'lucide-react';
import type { Directory, IndexedImage, IndexedImageTransferMode, IndexedImageTransferProgress } from '../types';

export type TransferDestination = Directory & {
  rootDirectoryPath: string;
  destinationRelativePath: string;
  displayName: string;
};

interface TransferImagesModalProps {
  isOpen: boolean;
  images: IndexedImage[];
  directories: Directory[];
  mode: IndexedImageTransferMode;
  isSubmitting: boolean;
  statusText?: string;
  progress?: IndexedImageTransferProgress | null;
  onClose: () => void;
  onConfirm: (directory: TransferDestination) => Promise<void> | void;
}

interface DestinationOption {
  id: string;
  rootDirectory: Directory;
  name: string;
  path: string;
  realPath?: string;
  relativePath: string;
  depth: number;
}

const toForwardSlashes = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');

const getRelativePath = (rootPath: string, targetPath: string) => {
  const normalizedRoot = toForwardSlashes(rootPath);
  const normalizedTarget = toForwardSlashes(targetPath);
  if (!normalizedRoot || normalizedRoot === normalizedTarget) {
    return '';
  }
  if (normalizedTarget.startsWith(`${normalizedRoot}/`)) {
    return normalizedTarget.slice(normalizedRoot.length + 1);
  }
  return '';
};

const TransferImagesModal: React.FC<TransferImagesModalProps> = ({
  isOpen,
  images,
  directories,
  mode,
  isSubmitting,
  statusText,
  progress,
  onClose,
  onConfirm,
}) => {
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string>('');
  const [subfolderOptions, setSubfolderOptions] = useState<DestinationOption[]>([]);
  const [isLoadingSubfolders, setIsLoadingSubfolders] = useState(false);
  const [subfolderLoadError, setSubfolderLoadError] = useState<string | null>(null);

  const imageCount = images.length;
  const firstImage = images[0];
  const title = mode === 'move' ? 'Move To' : 'Copy To';

  const sortedDirectories = useMemo(
    () => [...directories].sort((a, b) => a.name.localeCompare(b.name)),
    [directories],
  );

  const destinationOptions = useMemo<DestinationOption[]>(() => {
    const rootOptions = sortedDirectories.map((directory) => ({
      id: `${directory.id}::.`,
      rootDirectory: directory,
      name: directory.name,
      path: directory.path,
      relativePath: '',
      depth: 0,
    }));

    return [...rootOptions, ...subfolderOptions].sort((a, b) => {
      const rootCompare = a.rootDirectory.name.localeCompare(b.rootDirectory.name);
      if (rootCompare !== 0) return rootCompare;
      return a.relativePath.localeCompare(b.relativePath);
    });
  }, [sortedDirectories, subfolderOptions]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSelectedDirectoryId((current) => (
      current && destinationOptions.some((option) => option.id === current)
        ? current
        : destinationOptions[0]?.id ?? ''
    ));
  }, [isOpen, destinationOptions]);

  useEffect(() => {
    if (!isOpen) {
      setSubfolderOptions([]);
      setIsLoadingSubfolders(false);
      setSubfolderLoadError(null);
      return;
    }

    let cancelled = false;

    const loadSubfolders = async () => {
      const canListSubfolders = typeof window !== 'undefined' && window.electronAPI?.listSubfolders;
      if (!canListSubfolders || sortedDirectories.length === 0) {
        setSubfolderOptions([]);
        setSubfolderLoadError(null);
        return;
      }

      setIsLoadingSubfolders(true);
      setSubfolderLoadError(null);
      const loadedOptions: DestinationOption[] = [];
      const visitedRealPaths = new Set<string>();

      const visit = async (rootDirectory: Directory, folderPath: string, depth: number) => {
        const result = await window.electronAPI!.listSubfolders(folderPath);
        if (!result.success) {
          if (!cancelled) {
            setSubfolderLoadError(result.error || 'Some subfolders could not be loaded.');
          }
          return;
        }

        const subfolders = [...(result.subfolders ?? [])].sort((a, b) => a.name.localeCompare(b.name));
        for (const subfolder of subfolders) {
          const visitKey = (subfolder.realPath || subfolder.path).replace(/\\/g, '/').toLowerCase();
          if (visitedRealPaths.has(visitKey)) {
            continue;
          }
          visitedRealPaths.add(visitKey);

          const relativePath = getRelativePath(rootDirectory.path, subfolder.path);
          if (!relativePath) {
            continue;
          }

          loadedOptions.push({
            id: `${rootDirectory.id}::${relativePath}`,
            rootDirectory,
            name: subfolder.name,
            path: subfolder.path,
            realPath: subfolder.realPath,
            relativePath,
            depth,
          });

          await visit(rootDirectory, subfolder.path, depth + 1);
        }
      };

      try {
        for (const directory of sortedDirectories) {
          const rootKey = directory.path.replace(/\\/g, '/').toLowerCase();
          visitedRealPaths.add(rootKey);
          await visit(directory, directory.path, 1);
        }
      } finally {
        if (!cancelled) {
          setSubfolderOptions(loadedOptions);
          setIsLoadingSubfolders(false);
        }
      }
    };

    void loadSubfolders();

    return () => {
      cancelled = true;
    };
  }, [isOpen, sortedDirectories]);


  if (!isOpen) return null;

  const selectedOption = destinationOptions.find((directory) => directory.id === selectedDirectoryId);
  const selectedDirectory: TransferDestination | null = selectedOption
    ? {
        ...selectedOption.rootDirectory,
        path: selectedOption.path,
        name: selectedOption.relativePath || selectedOption.rootDirectory.name,
        rootDirectoryPath: selectedOption.rootDirectory.path,
        destinationRelativePath: selectedOption.relativePath,
        displayName: selectedOption.relativePath
          ? `${selectedOption.rootDirectory.name}/${selectedOption.relativePath}`
          : selectedOption.rootDirectory.name,
      }
    : null;
  const actionIcon = mode === 'move' ? <MoveRight className="w-5 h-5 text-amber-300" /> : <Copy className="w-5 h-5 text-blue-300" />;

  const progressPercent = progress && progress.total > 0
    ? Math.max(0, Math.min(100, Math.round((progress.processed / progress.total) * 100)))
    : 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 border border-gray-700">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-800 rounded-lg">
              {actionIcon}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{title}</h2>
              <p className="text-sm text-gray-400">
                {imageCount} image{imageCount === 1 ? '' : 's'} selected
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            title="Close"
            disabled={isSubmitting}
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-4">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <ArrowRightLeft className="w-4 h-4 text-gray-400" />
              <span>
                {mode === 'move' ? 'Move' : 'Copy'} will preserve tags, favorites, and shadow metadata.
              </span>
            </div>
            {firstImage && (
              <p className="mt-2 text-xs text-gray-400 truncate">
                Example: {firstImage.name}
              </p>
            )}
            {isSubmitting && (
              <div className="mt-3 space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-gray-700">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-300 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="text-xs text-blue-200">
                  {statusText || progress?.statusText || (mode === 'move' ? 'Moving files...' : 'Copying files...')}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-300">Destination folder</label>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {destinationOptions.map((directory) => (
                <button
                  key={directory.id}
                  type="button"
                  onClick={() => setSelectedDirectoryId(directory.id)}
                  className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
                    selectedDirectoryId === directory.id
                      ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                      : 'border-gray-700 bg-gray-800/40 text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-2" style={{ paddingLeft: `${directory.depth * 16}px` }}>
                    <Folder className="w-4 h-4 flex-shrink-0" />
                    <span className="font-medium truncate">
                      {directory.depth === 0 ? directory.name : directory.relativePath}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400 truncate">{directory.path}</p>
                </button>
              ))}
              {isLoadingSubfolders && (
                <div className="rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-3 text-sm text-gray-400">
                  Loading subfolders...
                </div>
              )}
              {!isLoadingSubfolders && subfolderLoadError && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {subfolderLoadError}
                </div>
              )}
              {!isLoadingSubfolders && !subfolderLoadError && destinationOptions.length === sortedDirectories.length && (
                <div className="rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-3 text-sm text-gray-400">
                  No subfolders found. Root folders are still available.
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors"
            >
              {isSubmitting ? 'Hide' : 'Cancel'}
            </button>
            <button
              onClick={() => selectedDirectory && onConfirm(selectedDirectory)}
              className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={!selectedDirectory || isSubmitting}
            >
              {isSubmitting
                ? (mode === 'move' ? 'Moving...' : 'Copying...')
                : `${mode === 'move' ? 'Move' : 'Copy'} ${imageCount} image${imageCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransferImagesModal;

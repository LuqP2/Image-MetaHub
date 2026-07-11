import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Copy, Folder, FolderPlus, MoveRight, X } from 'lucide-react';
import type { Directory, IndexedImage, IndexedImageTransferMode, IndexedImageTransferProgress } from '../types';
import { validateFolderName } from '../utils/folderName';

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
  // Folders created via "New folder" during this session. Kept separate from the
  // scanned subfolderOptions so an in-flight loadSubfolders() cannot overwrite
  // and lose a just-created destination.
  const [createdFolderOptions, setCreatedFolderOptions] = useState<DestinationOption[]>([]);
  const [isLoadingSubfolders, setIsLoadingSubfolders] = useState(false);
  const [subfolderLoadError, setSubfolderLoadError] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);
  const [isSubmittingNewFolder, setIsSubmittingNewFolder] = useState(false);

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

    // Dedupe by id so a created folder that a later scan also returns appears once.
    const byId = new Map<string, DestinationOption>();
    for (const option of [...rootOptions, ...subfolderOptions, ...createdFolderOptions]) {
      if (!byId.has(option.id)) {
        byId.set(option.id, option);
      }
    }

    return [...byId.values()].sort((a, b) => {
      const rootCompare = a.rootDirectory.name.localeCompare(b.rootDirectory.name);
      if (rootCompare !== 0) return rootCompare;
      return a.relativePath.localeCompare(b.relativePath);
    });
  }, [sortedDirectories, subfolderOptions, createdFolderOptions]);

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
      setCreatedFolderOptions([]);
      setIsLoadingSubfolders(false);
      setSubfolderLoadError(null);
      setIsCreatingFolder(false);
      setNewFolderName('');
      setCreateFolderError(null);
      setIsSubmittingNewFolder(false);
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
          const visitKey = (subfolder.realPath || subfolder.path).replace(/\\/g, '/');
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
          const rootKey = directory.path.replace(/\\/g, '/');
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
  const canCreateFolder = Boolean(selectedOption) && typeof window !== 'undefined' && Boolean(window.electronAPI?.createSubfolder);

  const handleCreateFolder = async () => {
    const parentOption = selectedOption;
    if (!parentOption) {
      return;
    }

    const validation = validateFolderName(newFolderName);
    if (!validation.ok || !validation.value) {
      setCreateFolderError(validation.error ?? 'Invalid folder name.');
      return;
    }

    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.createSubfolder) {
      setCreateFolderError('Creating folders is not supported in this environment.');
      return;
    }

    setIsSubmittingNewFolder(true);
    setCreateFolderError(null);
    try {
      const result = await api.createSubfolder(parentOption.path, validation.value);
      if (!result.success || !result.folder) {
        setCreateFolderError(result.error ?? 'Could not create the folder.');
        return;
      }

      const relativePath = getRelativePath(parentOption.rootDirectory.path, result.folder.path);
      const newOption: DestinationOption = {
        id: `${parentOption.rootDirectory.id}::${relativePath}`,
        rootDirectory: parentOption.rootDirectory,
        name: result.folder.name,
        path: result.folder.path,
        realPath: result.folder.realPath,
        relativePath,
        depth: parentOption.depth + 1,
      };

      setCreatedFolderOptions((prev) => (
        prev.some((option) => option.id === newOption.id) ? prev : [...prev, newOption]
      ));
      setSelectedDirectoryId(newOption.id);
      setNewFolderName('');
      setIsCreatingFolder(false);
    } finally {
      setIsSubmittingNewFolder(false);
    }
  };

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
            aria-label="Close transfer modal"
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
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-300">Destination folder</label>
              {canCreateFolder && !isCreatingFolder && (
                <button
                  type="button"
                  onClick={() => { setIsCreatingFolder(true); setCreateFolderError(null); }}
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <FolderPlus className="w-4 h-4" />
                  New folder
                </button>
              )}
            </div>

            {isCreatingFolder && (
              <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3 space-y-2">
                <p className="text-xs text-gray-400 truncate">
                  New folder inside: <span className="text-gray-300">{selectedOption ? (selectedOption.relativePath ? `${selectedOption.rootDirectory.name}/${selectedOption.relativePath}` : selectedOption.rootDirectory.name) : ''}</span>
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => { setNewFolderName(e.target.value); if (createFolderError) setCreateFolderError(null); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void handleCreateFolder(); }
                      if (e.key === 'Escape') { e.preventDefault(); setIsCreatingFolder(false); setNewFolderName(''); setCreateFolderError(null); }
                    }}
                    placeholder="Folder name"
                    disabled={isSubmittingNewFolder}
                    className="flex-1 rounded-md border border-gray-600 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateFolder()}
                    disabled={isSubmittingNewFolder || newFolderName.trim().length === 0}
                    className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    {isSubmittingNewFolder ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsCreatingFolder(false); setNewFolderName(''); setCreateFolderError(null); }}
                    disabled={isSubmittingNewFolder}
                    className="px-3 py-1.5 rounded-md border border-gray-600 bg-gray-800 text-gray-200 text-sm hover:bg-gray-700 disabled:opacity-60 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                {createFolderError && (
                  <p className="text-xs text-red-300">{createFolderError}</p>
                )}
              </div>
            )}

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

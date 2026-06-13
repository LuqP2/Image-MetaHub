import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Copy, Folder, FolderPlus, MoveRight, X } from 'lucide-react';
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
  parentId: string | null;
  hasSubfolders?: boolean;
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
  const [expandedDirectoryIds, setExpandedDirectoryIds] = useState<Set<string>>(new Set());
  const [isLoadingSubfolders, setIsLoadingSubfolders] = useState(false);
  const [subfolderLoadError, setSubfolderLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [isNewFolderFormOpen, setIsNewFolderFormOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [pendingSelectedDirectoryId, setPendingSelectedDirectoryId] = useState<string | null>(null);

  const imageCount = images.length;
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
      parentId: null,
    }));

    const options = [...rootOptions, ...subfolderOptions].sort((a, b) => {
      const rootCompare = a.rootDirectory.name.localeCompare(b.rootDirectory.name);
      if (rootCompare !== 0) return rootCompare;
      return a.relativePath.localeCompare(b.relativePath);
    });

    const childCountByParent = new Map<string, number>();
    for (const option of options) {
      if (option.parentId) {
        childCountByParent.set(option.parentId, (childCountByParent.get(option.parentId) ?? 0) + 1);
      }
    }

    return options.map((option) => ({
      ...option,
      hasSubfolders: (childCountByParent.get(option.id) ?? 0) > 0,
    }));
  }, [sortedDirectories, subfolderOptions]);

  const visibleDestinationOptions = useMemo(() => {
    const byId = new Map(destinationOptions.map((option) => [option.id, option]));

    const isVisible = (option: DestinationOption): boolean => {
      let parentId = option.parentId;
      while (parentId) {
        if (!expandedDirectoryIds.has(parentId)) {
          return false;
        }
        parentId = byId.get(parentId)?.parentId ?? null;
      }
      return true;
    };

    return destinationOptions.filter(isVisible);
  }, [destinationOptions, expandedDirectoryIds]);

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
      setExpandedDirectoryIds(new Set());
      setIsLoadingSubfolders(false);
      setSubfolderLoadError(null);
      setIsNewFolderFormOpen(false);
      setNewFolderName('');
      setNewFolderError(null);
      setIsCreatingFolder(false);
      setPendingSelectedDirectoryId(null);
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

      const visit = async (rootDirectory: Directory, folderPath: string, depth: number, parentId: string) => {
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
            parentId,
          });

          await visit(rootDirectory, subfolder.path, depth + 1, `${rootDirectory.id}::${relativePath}`);
        }
      };

      try {
        for (const directory of sortedDirectories) {
          const rootKey = directory.path.replace(/\\/g, '/');
          visitedRealPaths.add(rootKey);
          await visit(directory, directory.path, 1, `${directory.id}::.`);
        }
      } finally {
        if (!cancelled) {
          setSubfolderOptions(loadedOptions);
          setIsLoadingSubfolders(false);
          if (pendingSelectedDirectoryId && [
            ...sortedDirectories.map((directory) => `${directory.id}::.`),
            ...loadedOptions.map((option) => option.id),
          ].includes(pendingSelectedDirectoryId)) {
            setSelectedDirectoryId(pendingSelectedDirectoryId);
            setPendingSelectedDirectoryId(null);
          }
        }
      }
    };

    void loadSubfolders();

    return () => {
      cancelled = true;
    };
  }, [isOpen, pendingSelectedDirectoryId, reloadToken, sortedDirectories]);


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

  const toggleExpanded = (directoryId: string) => {
    setExpandedDirectoryIds((current) => {
      const next = new Set(current);
      if (next.has(directoryId)) {
        next.delete(directoryId);
      } else {
        next.add(directoryId);
      }
      return next;
    });
  };

  const handleCreateFolder = async () => {
    if (!selectedOption || isCreatingFolder) {
      return;
    }

    const trimmedName = newFolderName.trim();
    if (!trimmedName) {
      setNewFolderError('Enter a folder name.');
      return;
    }
    if (/[<>:"/\\|?*]/.test(trimmedName)) {
      setNewFolderError('Folder name contains invalid characters.');
      return;
    }
    if (!window.electronAPI?.joinPaths || !window.electronAPI?.ensureDirectory) {
      setNewFolderError('Creating folders is only available in the desktop app.');
      return;
    }

    setIsCreatingFolder(true);
    setNewFolderError(null);
    try {
      const joined = await window.electronAPI.joinPaths(selectedOption.path, trimmedName);
      if (!joined.success || !joined.path) {
        setNewFolderError(joined.error || 'Failed to resolve folder path.');
        return;
      }

      const result = await window.electronAPI.ensureDirectory(joined.path);
      if (!result.success) {
        setNewFolderError(result.error || 'Failed to create folder.');
        return;
      }

      const relativePath = getRelativePath(selectedOption.rootDirectory.path, joined.path);
      const nextId = `${selectedOption.rootDirectory.id}::${relativePath || '.'}`;
      setExpandedDirectoryIds((current) => new Set(current).add(selectedOption.id));
      setPendingSelectedDirectoryId(nextId);
      setNewFolderName('');
      setIsNewFolderFormOpen(false);
      setReloadToken((current) => current + 1);
    } finally {
      setIsCreatingFolder(false);
    }
  };

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
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-gray-300">Destination folder</label>
              <button
                type="button"
                onClick={() => {
                  setIsNewFolderFormOpen(true);
                  setNewFolderError(null);
                }}
                disabled={!selectedOption || isSubmitting}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800/40 px-2.5 py-1 text-xs font-medium text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                New Folder
              </button>
            </div>
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {visibleDestinationOptions.map((directory) => (
                <div
                  key={directory.id}
                  className={`flex w-full items-stretch rounded-lg border transition-colors ${
                    selectedDirectoryId === directory.id
                      ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                      : 'border-gray-700 bg-gray-800/25 text-gray-200 hover:bg-gray-800/70'
                  }`}
                >
                  <div className="flex items-center py-1.5 pl-2" style={{ paddingLeft: `${8 + directory.depth * 18}px` }}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (directory.hasSubfolders) {
                          toggleExpanded(directory.id);
                        }
                      }}
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-xs font-semibold text-gray-400 ${
                        directory.hasSubfolders ? 'hover:bg-gray-700 hover:text-gray-100' : 'opacity-30'
                      }`}
                      aria-label={expandedDirectoryIds.has(directory.id) ? 'Collapse folder' : 'Expand folder'}
                      disabled={!directory.hasSubfolders || isSubmitting}
                    >
                      {directory.hasSubfolders ? (expandedDirectoryIds.has(directory.id) ? '-' : '+') : ''}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedDirectoryId(directory.id)}
                    disabled={isSubmitting}
                    className="min-w-0 flex-1 px-2 py-1.5 pr-3 text-left disabled:cursor-not-allowed"
                    title={directory.path}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Folder className={`w-4 h-4 flex-shrink-0 ${directory.depth === 0 ? 'text-blue-300' : 'text-amber-300'}`} />
                      <span className="truncate font-medium">
                        {directory.name}
                      </span>
                    </div>
                  </button>
                </div>
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
            {isNewFolderFormOpen && (
              <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-2.5">
                <div className="mb-2 truncate text-xs text-gray-400">
                  New folder inside: {selectedDirectory?.displayName || 'Select a destination first'}
                </div>
                <div className="flex gap-2">
                  <input
                    value={newFolderName}
                    onChange={(event) => {
                      setNewFolderName(event.target.value);
                      setNewFolderError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleCreateFolder();
                      }
                    }}
                    disabled={!selectedOption || isCreatingFolder || isSubmitting}
                    placeholder="Folder name"
                    className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateFolder()}
                    disabled={!selectedOption || isCreatingFolder || isSubmitting}
                    className="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsNewFolderFormOpen(false);
                      setNewFolderName('');
                      setNewFolderError(null);
                    }}
                    disabled={isCreatingFolder || isSubmitting}
                    className="rounded-md border border-gray-700 px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
                {newFolderError && (
                  <p className="mt-2 text-xs text-amber-200">{newFolderError}</p>
                )}
              </div>
            )}
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

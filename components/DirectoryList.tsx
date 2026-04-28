import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Directory, IndexedImage } from '../types';
import { FolderOpen, RotateCcw, Trash2, ChevronDown, Folder, FolderTree, X, EyeOff, Eye, FolderPlus, Edit2, Clipboard } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { transferIndexedImages } from '../services/fileTransferService';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { getActiveDragImageIds, clearActiveDragImageIds } from './ImageGrid';

interface DirectoryListProps {
  directories: Directory[];
  onRemoveDirectory: (directoryId: string) => void;
  onUpdateDirectory: (directoryId: string, subPath?: string) => void;
  refreshingDirectories?: Set<string>;
  directoryProgress?: Record<string, { current: number; total: number }>;
  onToggleFolderSelection?: (path: string, ctrlKey: boolean) => void;
  onClearFolderSelection?: () => void;
  isFolderSelected?: (path: string) => boolean;
  selectedFolders?: Set<string>;
  includeSubfolders?: boolean;
  onToggleIncludeSubfolders?: () => void;
  isIndexing?: boolean;
  scanSubfolders?: boolean;
  excludedFolders?: Set<string>;
  onExcludeFolder?: (path: string) => void;
  onIncludeFolder?: (path: string) => void;
}

interface SubfolderNode {
  name: string;
  path: string;
  relativePath: string;
}

interface VisibleDirectoryNode {
  key: string;
  path: string;
  parentKey: string | null;
  depth: number;
  hasSubfolders: boolean;
  isExpanded: boolean;
  rootDirectory: Directory;
}

const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');
const toForwardSlashes = (path: string) => normalizePath(path);
const makeNodeKey = (rootId: string, relativePath: string) => `${rootId}::${relativePath === '' ? '.' : relativePath}`;

const getRelativePath = (rootPath: string, targetPath: string) => {
  const normalizedRoot = toForwardSlashes(rootPath);
  const normalizedTarget = toForwardSlashes(targetPath);
  if (!normalizedRoot) {
    return normalizedTarget;
  }
  if (normalizedRoot === normalizedTarget) {
    return '';
  }
  if (normalizedTarget.startsWith(`${normalizedRoot}/`)) {
    return normalizedTarget.slice(normalizedRoot.length + 1);
  }
  return normalizedTarget;
};

const findRootDirectoryForPath = (directories: Directory[], targetPath: string): Directory | undefined => {
  const normalizedTarget = toForwardSlashes(targetPath).toLowerCase();

  return directories
    .filter((directory) => {
      const normalizedRoot = toForwardSlashes(directory.path).toLowerCase();
      return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
    })
    .sort((a, b) => b.path.length - a.path.length)[0];
};

const createTransferDestination = (directories: Directory[], destinationPath: string) => {
  const rootDirectory = findRootDirectoryForPath(directories, destinationPath);
  if (!rootDirectory) {
    return null;
  }

  const relativePath = getRelativePath(rootDirectory.path, destinationPath);

  return {
    ...rootDirectory,
    path: destinationPath,
    name: relativePath || rootDirectory.name,
    rootDirectoryPath: rootDirectory.path,
    destinationRelativePath: relativePath,
    displayName: relativePath ? `${rootDirectory.name}/${relativePath}` : rootDirectory.name,
  };
};

const joinElectronPath = async (...paths: string[]): Promise<string | null> => {
  const result = await (window as any).electronAPI.joinPaths(...paths);
  if (typeof result === 'string') {
    return result;
  }
  if (result?.success && typeof result.path === 'string') {
    return result.path;
  }
  useImageStore.getState().setError(result?.error || 'Failed to resolve folder path.');
  return null;
};

const renameIndexedRootInStore = (oldPath: string, newPath: string, newName: string) => {
  const store = useImageStore.getState();
  const replaceImageId = (imageId: string) => (
    imageId.startsWith(`${oldPath}::`) ? `${newPath}::${imageId.slice(oldPath.length + 2)}` : imageId
  );
  const remapImage = (image: IndexedImage | null): IndexedImage | null => (
    image && normalizePath(image.directoryId ?? '') === normalizePath(oldPath)
      ? { ...image, id: replaceImageId(image.id), directoryId: newPath }
      : image
  );
  const remapImageList = (images: IndexedImage[] | null): IndexedImage[] | null => (
    images ? images.map((image) => remapImage(image) ?? image) : null
  );

  const nextDirectories = store.directories.map((directory) =>
    normalizePath(directory.path) === normalizePath(oldPath)
      ? { ...directory, id: newPath, path: newPath, name: newName }
      : directory
  );

  const nextImages = store.images.map((image) =>
    normalizePath(image.directoryId ?? '') === normalizePath(oldPath)
      ? {
          ...image,
          id: replaceImageId(image.id),
          directoryId: newPath,
        }
      : image
  );

  const nextSelectedImages = new Set(Array.from(store.selectedImages).map(replaceImageId));
  const nextClipboard = store.clipboard
    ? { ...store.clipboard, imageIds: store.clipboard.imageIds.map(replaceImageId) }
    : null;
  const nextSelectedFolders = new Set(Array.from(store.selectedFolders).map((folderPath) =>
    normalizePath(folderPath) === normalizePath(oldPath) ||
    normalizePath(folderPath).startsWith(`${normalizePath(oldPath)}/`)
      ? `${newPath}${folderPath.slice(oldPath.length)}`
      : folderPath
  ));

  const nextAnnotations = new Map<string, any>();
  store.annotations.forEach((annotation, imageId) => {
    const nextImageId = replaceImageId(imageId);
    nextAnnotations.set(nextImageId, { ...annotation, imageId: nextImageId });
  });
  const nextFilteredImages = remapImageList(store.filteredImages) ?? [];
  const nextActiveImageScope = remapImageList(store.activeImageScope);
  const nextClusterNavigationContext = remapImageList(store.clusterNavigationContext);
  const nextComparisonImages = remapImageList(store.comparisonImages) ?? [];

  useImageStore.setState({
    directories: nextDirectories,
    images: nextImages,
    filteredImages: nextFilteredImages,
    selectedImage: remapImage(store.selectedImage),
    previewImage: remapImage(store.previewImage),
    activeImageScope: nextActiveImageScope,
    clusterNavigationContext: nextClusterNavigationContext,
    comparisonImages: nextComparisonImages,
    selectedImages: nextSelectedImages,
    clipboard: nextClipboard,
    selectedFolders: nextSelectedFolders,
    annotations: nextAnnotations,
  });

  localStorage.setItem('image-metahub-directories', JSON.stringify(nextDirectories.map((directory) => directory.path)));
  localStorage.setItem(
    'image-metahub-directory-watchers',
    JSON.stringify(Object.fromEntries(nextDirectories.map((directory) => [
      directory.id,
      { enabled: !!directory.autoWatch, path: directory.path },
    ]))),
  );
};

const rebindRootWatcher = async (oldDirectoryId: string, newDirectoryId: string, newPath: string) => {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return;
  }

  const stopResult = await window.electronAPI.stopWatchingDirectory?.({ directoryId: oldDirectoryId });
  if (stopResult && !stopResult.success) {
    console.warn('Failed to stop watcher for renamed folder:', (stopResult as { error?: string }).error);
  }

  const startResult = await window.electronAPI.startWatchingDirectory?.({
    directoryId: newDirectoryId,
    dirPath: newPath,
  });
  if (startResult && !startResult.success) {
    useImageStore.getState().setError(startResult.error || 'Folder renamed, but auto-watch could not be restarted.');
  }
};

export default function DirectoryList({
  directories,
  onRemoveDirectory,
  onUpdateDirectory,
  refreshingDirectories,
  directoryProgress,
  onToggleFolderSelection,
  onClearFolderSelection,
  isFolderSelected,
  selectedFolders = new Set<string>(),
  includeSubfolders = true,
  onToggleIncludeSubfolders,
  isIndexing = false,
  scanSubfolders = false,
  excludedFolders,
  onExcludeFolder,
  onIncludeFolder
}: DirectoryListProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [subfolderCache, setSubfolderCache] = useState<Map<string, SubfolderNode[]>>(new Map());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [autoMarkedNodes, setAutoMarkedNodes] = useState<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = useState(true);
  const [autoExpandedDirs, setAutoExpandedDirs] = useState<Set<string>>(new Set());
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const clipboard = useImageStore(state => state.clipboard);
  const { canUseFileManagement, showProModal } = useFeatureAccess();
  const [folderPrompt, setFolderPrompt] = useState<{
    mode: 'new' | 'rename';
    targetPath: string;
    defaultValue: string;
    onConfirm: (value: string) => void;
  } | null>(null);
  const [folderPromptValue, setFolderPromptValue] = useState('');
  const folderPromptInputRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    path: string;
  } | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const treeKeyboardActiveRef = useRef(false);

  // Focus input when prompt opens
  useEffect(() => {
    if (folderPrompt) {
      setFolderPromptValue(folderPrompt.defaultValue);
      setTimeout(() => folderPromptInputRef.current?.focus(), 50);
    }
  }, [folderPrompt]);

  const loadSubfolders = useCallback(async (
    nodeKey: string,
    nodePath: string,
    rootDirectory: Directory
  ) => {
    try {
      setLoadingNodes(prev => {
        const next = new Set(prev);
        next.add(nodeKey);
        return next;
      });

      const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
      if (isElectron && (window as any).electronAPI.listSubfolders) {
        const result = await (window as any).electronAPI.listSubfolders(nodePath);

        if (result.success) {
          const subfolders: SubfolderNode[] = (result.subfolders || []).map((subfolder: { name: string; path: string }) => ({
            name: subfolder.name,
            path: subfolder.path,
            relativePath: getRelativePath(rootDirectory.path, subfolder.path)
          }));

          setSubfolderCache(prev => {
            const next = new Map(prev);
            next.set(nodeKey, subfolders);
            return next;
          });
        } else {
          console.error('Failed to load subfolders:', result.error);
        }
      }
    } catch (error) {
      console.error('Error loading subfolders:', error);
    } finally {
      setLoadingNodes(prev => {
        const next = new Set(prev);
        next.delete(nodeKey);
        return next;
      });
    }
  }, []);

  // Auto-expand and load subfolders for newly added directories
  useEffect(() => {
    if (!scanSubfolders || !directories.length) return;

    directories.forEach(dir => {
      const rootKey = makeNodeKey(dir.id, '');
      
      // Only auto-expand if not already expanded/loading and not previously auto-expanded
      if (!expandedNodes.has(rootKey) && !loadingNodes.has(rootKey) && !autoExpandedDirs.has(dir.id)) {
        setAutoExpandedDirs(prev => new Set(prev).add(dir.id));
        setExpandedNodes(prev => new Set(prev).add(rootKey));
        
        // Load subfolders if not already cached
        if (!subfolderCache.has(rootKey)) {
          void loadSubfolders(rootKey, dir.path, dir);
        }
      }
    });
  }, [directories, scanSubfolders, expandedNodes, loadingNodes, subfolderCache, autoExpandedDirs, loadSubfolders]);

  const handleToggleNode = useCallback((nodeKey: string, nodePath: string, rootDirectory: Directory) => {
    let shouldLoad = false;
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeKey)) {
        next.delete(nodeKey);
      } else {
        next.add(nodeKey);
        if (!subfolderCache.has(nodeKey)) {
          shouldLoad = true;
        }
      }
      return next;
    });

    if (shouldLoad) {
      void loadSubfolders(nodeKey, nodePath, rootDirectory);
    }
  }, [loadSubfolders, subfolderCache]);

  const handleOpenInExplorer = async (path: string) => {
    try {
      const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
      if (isElectron && (window as any).electronAPI.showItemInFolder) {
        const result = await (window as any).electronAPI.showItemInFolder(path);
        if (!result.success) {
          console.error('Failed to open folder:', result.error);
          alert(result.error || 'Failed to open folder. Please check the path.');
        }
      } else {
        alert('This feature requires the desktop app. Please use the Image MetaHub application.');
      }
    } catch (error) {
      console.error('Error opening folder:', error);
      alert('Failed to open folder. Please check the path.');
    }
  };

  const handleFolderClick = useCallback((
    path: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    treeKeyboardActiveRef.current = true;
    treeRef.current?.focus({ preventScroll: true });
    if (!onToggleFolderSelection) return;
    onToggleFolderSelection(path, event.ctrlKey || event.metaKey);
  }, [onToggleFolderSelection]);

  const handleContextMenu = useCallback((
    event: React.MouseEvent,
    path: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      path
    });
  }, []);

  // Click outside handler to close context menu
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    if (contextMenu) {
      // Use bubble phase (not capture) so stopPropagation on the menu container works
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

  const handleDragOver = useCallback((e: React.DragEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = e.ctrlKey || e.altKey ? 'copy' : 'move';
    }
    setDragOverPath(normalizePath(path));
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, destPath: string, rootDirId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);

    if (!canUseFileManagement) {
      showProModal('file_management');
      return;
    }

    // Prefer module-level variable (works in Electron native drag)
    // Fall back to dataTransfer for browser env
    let imageIds: string[] = getActiveDragImageIds();
    clearActiveDragImageIds();

    if (imageIds.length === 0) {
      try {
        const data = e.dataTransfer.getData('application/x-image-metahub-drag');
        if (data) {
          const payload = JSON.parse(data);
          imageIds = payload.imageIds || [];
        }
      } catch (_) { /* ignore */ }
    }

    if (imageIds.length === 0) return;

    try {
      const imagesToTransfer = useImageStore.getState().images.filter(img => imageIds.includes(img.id));
      const destinationDirectory = createTransferDestination(directories, destPath);
      if (imagesToTransfer.length > 0 && destinationDirectory) {
        setIsTransferring(true);
        await transferIndexedImages({
          images: imagesToTransfer,
          destinationDirectory,
          mode: e.ctrlKey || e.altKey ? 'copy' : 'move',
        });
        onUpdateDirectory(destinationDirectory.id, destPath);
      }
    } catch (err) {
      console.error('Drop transfer failed:', err);
    } finally {
      setIsTransferring(false);
    }
  }, [canUseFileManagement, showProModal, onUpdateDirectory, directories]);

  const renderSubfolderList = useCallback((rootDirectory: Directory, parentKey: string): React.ReactNode => {
    const children = subfolderCache.get(parentKey) || [];

    return children.map(child => {
      const childKey = makeNodeKey(rootDirectory.id, child.relativePath);
      const isExpandedNode = expandedNodes.has(childKey);
      const isLoadingNode = loadingNodes.has(childKey);
      const grandchildren = subfolderCache.get(childKey) || [];
      const isSelected = isFolderSelected ? isFolderSelected(child.path) : false;

      const isExcluded = excludedFolders && excludedFolders.has(normalizePath(child.path));

      const hasSubfolders = isLoadingNode || !subfolderCache.has(childKey) || (subfolderCache.get(childKey)?.length ?? 0) > 0;

      return (
        <li key={childKey} className="py-1">
          <div
            className={`flex items-center cursor-pointer rounded px-2 py-1 transition-colors group ${
              isSelected
                ? 'bg-blue-500/15 ring-1 ring-blue-500/30 hover:bg-blue-500/20'
                : 'hover:bg-gray-700/50'
            } ${dragOverPath === normalizePath(child.path) ? 'ring-2 ring-blue-400 bg-blue-500/20' : ''}`}
            onClick={(e) => handleFolderClick(child.path, e)}
            onContextMenu={(e) => handleContextMenu(e, child.path)}
            onDragOver={(e) => handleDragOver(e, child.path)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, child.path, rootDirectory.id)}
          >
            {hasSubfolders ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleNode(childKey, child.path, rootDirectory);
                }}
                className="text-gray-500 hover:text-gray-300 transition-colors mr-1 flex-shrink-0"
                title={isExpandedNode ? 'Hide subfolders' : 'Show subfolders'}
              >
                <ChevronDown
                  className={`w-3 h-3 transition-transform ${isExpandedNode ? 'rotate-0' : '-rotate-90'}`}
                />
              </button>
            ) : (
              <div className="w-4 mr-1 flex-shrink-0" /> // Spacer
            )}
            
            <Folder className={`w-3 h-3 mr-2 ${isExcluded ? 'text-gray-600' : isSelected ? 'text-blue-300' : 'text-gray-400'}`} />
            <span className={`text-sm truncate flex-1 ${isExcluded ? 'text-gray-500 line-through' : isSelected ? 'text-blue-100' : 'text-gray-300'}`}>{child.name}</span>
            
            {/* Action Buttons (Visible on Hover) */}
            <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                {isExcluded ? (
                  onIncludeFolder && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onIncludeFolder(normalizePath(child.path));
                        }}
                        disabled={isIndexing}
                        className={`p-1 rounded hover:bg-gray-600 transition-colors ${
                            isIndexing ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-gray-100'
                        }`}
                        title="Include folder"
                    >
                        <Eye className="w-3 h-3" />
                    </button>
                  )
                ) : (
                  <>
                     <button
                        onClick={(e) => {
                            e.stopPropagation();
                            // Refresh via parent, passing specific subpath
                            onUpdateDirectory(rootDirectory.id, child.path);
                            
                            // Also refresh subfolders for this specific node
                            setSubfolderCache(prev => {
                              const next = new Map(prev);
                              next.delete(childKey);
                              return next;
                            });
                            // If it was expanded or has subfolders, reload them
                            // Even if it wasn't, checking again is good practice on refresh
                            void loadSubfolders(childKey, child.path, rootDirectory);
                        }}
                        disabled={isIndexing}
                        className={`p-1 rounded hover:bg-gray-600 transition-colors ${
                            isIndexing ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white'
                        }`}
                        title="Refresh folder"
                    >
                        <RotateCcw className="w-3 h-3" />
                    </button>
                    {onExcludeFolder && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onExcludeFolder(normalizePath(child.path));
                            }}
                            disabled={isIndexing}
                            className={`p-1 rounded hover:bg-gray-600 transition-colors ${
                                isIndexing ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-red-400'
                            }`}
                            title="Exclude folder"
                        >
                            <EyeOff className="w-3 h-3" />
                        </button>
                    )}
                  </>
                )}
            </div>
          </div>
          {isExpandedNode && hasSubfolders && (
            <ul className="ml-4 mt-1 space-y-1 border-l border-gray-700 pl-2">
              {isLoadingNode ? (
                <li className="text-xs text-gray-500 italic py-1">Loading subfolders...</li>
              ) : grandchildren.length > 0 ? (
                renderSubfolderList(rootDirectory, childKey)
              ) : null}
            </ul>
          )}
        </li>
      );
    });
  }, [
    dragOverPath,
    expandedNodes,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFolderClick,
    handleContextMenu,
    handleToggleNode,
    isFolderSelected,
    loadingNodes,
    subfolderCache,
    excludedFolders,
    onIncludeFolder,
    onExcludeFolder,
    isIndexing,
    onUpdateDirectory,
    loadSubfolders,
  ]);

  const visibleNodes = useMemo<VisibleDirectoryNode[]>(() => {
    const nodes: VisibleDirectoryNode[] = [];

    const appendChildren = (
      rootDirectory: Directory,
      parentKey: string,
      depth: number,
    ) => {
      const children = subfolderCache.get(parentKey) || [];

      for (const child of children) {
        const childKey = makeNodeKey(rootDirectory.id, child.relativePath);
        const hasSubfolders =
          loadingNodes.has(childKey) ||
          !subfolderCache.has(childKey) ||
          (subfolderCache.get(childKey)?.length ?? 0) > 0;
        const isExpandedNode = expandedNodes.has(childKey);

        nodes.push({
          key: childKey,
          path: child.path,
          parentKey,
          depth,
          hasSubfolders,
          isExpanded: isExpandedNode,
          rootDirectory,
        });

        if (isExpandedNode && hasSubfolders) {
          appendChildren(rootDirectory, childKey, depth + 1);
        }
      }
    };

    for (const dir of directories) {
      const rootKey = makeNodeKey(dir.id, '');
      const hasSubfolders =
        loadingNodes.has(rootKey) ||
        !subfolderCache.has(rootKey) ||
        (subfolderCache.get(rootKey)?.length ?? 0) > 0;
      const isExpandedNode = expandedNodes.has(rootKey);

      nodes.push({
        key: rootKey,
        path: dir.path,
        parentKey: null,
        depth: 0,
        hasSubfolders,
        isExpanded: isExpandedNode,
        rootDirectory: dir,
      });

      if (scanSubfolders && isExpandedNode && hasSubfolders) {
        appendChildren(dir, rootKey, 1);
      }
    }

    return nodes;
  }, [directories, expandedNodes, loadingNodes, scanSubfolders, subfolderCache]);

  useEffect(() => {
    const handleGlobalPointerDown = (event: MouseEvent) => {
      if (!treeRef.current?.contains(event.target as Node)) {
        treeKeyboardActiveRef.current = false;
      }
    };

    const handleGlobalFocusIn = (event: FocusEvent) => {
      if (!treeRef.current?.contains(event.target as Node)) {
        treeKeyboardActiveRef.current = false;
      }
    };

    document.addEventListener('mousedown', handleGlobalPointerDown, true);
    document.addEventListener('focusin', handleGlobalFocusIn);

    return () => {
      document.removeEventListener('mousedown', handleGlobalPointerDown, true);
      document.removeEventListener('focusin', handleGlobalFocusIn);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!treeKeyboardActiveRef.current || !visibleNodes.length || !onToggleFolderSelection) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTyping = !!target?.closest('input, textarea, select, [contenteditable="true"]');
      const isInModal = document.querySelector('[role="dialog"]') !== null;
      if (isTyping || isInModal) {
        return;
      }

      const selectedPaths = Array.from(selectedFolders);
      const selectedIndex = visibleNodes.findIndex((node) =>
        selectedPaths.includes(normalizePath(node.path))
      );
      const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
      const currentNode = visibleNodes[currentIndex];
      const pageStep = Math.max(5, Math.min(12, visibleNodes.length > 20 ? 10 : 5));

      const selectNodeAt = (index: number) => {
        const safeIndex = Math.max(0, Math.min(visibleNodes.length - 1, index));
        if (selectedIndex >= 0 && safeIndex === currentIndex) {
          treeRef.current?.focus({ preventScroll: true });
          return;
        }
        onToggleFolderSelection(visibleNodes[safeIndex].path, false);
        treeRef.current?.focus({ preventScroll: true });
      };

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectNodeAt(currentIndex + 1);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectNodeAt(currentIndex - 1);
        return;
      }

      if (event.key === 'PageDown') {
        event.preventDefault();
        selectNodeAt(currentIndex + pageStep);
        return;
      }

      if (event.key === 'PageUp') {
        event.preventDefault();
        selectNodeAt(currentIndex - pageStep);
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        selectNodeAt(0);
        return;
      }

      if (event.key === 'End') {
        event.preventDefault();
        selectNodeAt(visibleNodes.length - 1);
        return;
      }

      if (event.key === 'ArrowRight' && scanSubfolders && currentNode.hasSubfolders) {
        event.preventDefault();
        if (!currentNode.isExpanded) {
          handleToggleNode(currentNode.key, currentNode.path, currentNode.rootDirectory);
          return;
        }

        const nextNode = visibleNodes[currentIndex + 1];
        if (nextNode && nextNode.parentKey === currentNode.key) {
          selectNodeAt(currentIndex + 1);
        }
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (currentNode.isExpanded && currentNode.hasSubfolders) {
          handleToggleNode(currentNode.key, currentNode.path, currentNode.rootDirectory);
          return;
        }

        if (currentNode.parentKey) {
          const parentIndex = visibleNodes.findIndex((node) => node.key === currentNode.parentKey);
          if (parentIndex >= 0) {
            selectNodeAt(parentIndex);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleNode, onToggleFolderSelection, scanSubfolders, selectedFolders, visibleNodes]);

  return (
    <div
      ref={treeRef}
      className="border-b border-gray-700 outline-none"
      data-sidebar-tree="true"
      tabIndex={0}
      onFocus={() => {
        treeKeyboardActiveRef.current = true;
      }}
      onMouseDownCapture={() => {
        treeKeyboardActiveRef.current = true;
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setIsExpanded(prev => !prev);
          }
        }}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-700/50 transition-colors"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center space-x-2">
          <span className="text-gray-300 font-medium">Folders</span>
          <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded border border-gray-600">
            {directories.length}
          </span>
          {onToggleIncludeSubfolders && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleIncludeSubfolders();
              }}
              className={`p-1.5 rounded-md border transition-all ${
                includeSubfolders
                  ? 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'
                  : 'bg-transparent border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-700/50'
              }`}
              title={includeSubfolders ? 'Including subfolders (Recursive)' : 'Direct folder only (Flat)'}
            >
              {includeSubfolders ? <FolderTree className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
            </button>
          )}
          {selectedFolders.size > 0 && onClearFolderSelection && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClearFolderSelection();
              }}
              className="p-1 rounded-full text-gray-500 hover:text-red-400 hover:bg-gray-700/50 transition-colors"
              title="Clear folder selection"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </div>
      {isExpanded && (
        <div className="px-4 pb-4">
          <ul className="space-y-1">
            {directories.map((dir) => {
              const rootKey = makeNodeKey(dir.id, '');
              const isRootExpanded = expandedNodes.has(rootKey);
              const isRootLoading = loadingNodes.has(rootKey);
              const rootChildren = subfolderCache.get(rootKey) || [];
              const isRefreshing = refreshingDirectories?.has(dir.id) ?? false;
              const isRootSelected = isFolderSelected ? isFolderSelected(dir.path) : false;
              const progressEntry = directoryProgress?.[dir.id];
              const isScanning = !!progressEntry && progressEntry.total === 0;
              const progressPercent = progressEntry && progressEntry.total > 0
                ? Math.max(0, Math.min(100, (progressEntry.current / progressEntry.total) * 100))
                : 0;
              
              // Determine if we should show the expander
              // Show if loading, or if not yet loaded (not in cache), or if loaded and has children
              const hasSubfolders = isRootLoading || !subfolderCache.has(rootKey) || (subfolderCache.get(rootKey)?.length ?? 0) > 0;

              return (
                <li key={dir.id}>
                  <div
                    className={`relative overflow-hidden flex items-center justify-between p-2 rounded-md transition-colors ${
                      isRootSelected
                        ? 'bg-blue-500/15 ring-1 ring-blue-500/30 hover:bg-blue-500/20'
                        : 'bg-gray-800 hover:bg-gray-700/50'
                    } ${dragOverPath === normalizePath(dir.path) ? 'ring-2 ring-blue-400 bg-blue-500/20' : ''}`}
                    onDragOver={(e) => handleDragOver(e, dir.path)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, dir.path, dir.id)}
                  >
                    {progressEntry && (
                      <div className="absolute inset-0 pointer-events-none">
                        {isScanning ? (
                          <div className="absolute inset-0 bg-blue-400/8 animate-pulse" />
                        ) : (
                          <div
                            className="absolute inset-y-0 left-0 bg-blue-400/12 transition-[width] duration-300 ease-out"
                            style={{ width: `${progressPercent}%` }}
                          />
                        )}
                      </div>
                    )}

                    <div className="relative z-10 flex items-center overflow-hidden flex-1 min-w-0">
                      {hasSubfolders ? (
                        <button
                          onClick={() => handleToggleNode(rootKey, dir.path, dir)}
                          className="text-gray-400 hover:text-gray-300 transition-colors flex-shrink-0"
                          title={isRootExpanded ? 'Hide subfolders' : 'Show subfolders'}
                        >
                          <ChevronDown
                            className={`w-4 h-4 transition-transform ${isRootExpanded ? 'rotate-0' : '-rotate-90'}`}
                          />
                        </button>
                      ) : (
                        <div className="w-4 h-4 ml-1 flex-shrink-0" /> // Spacer
                      )}
                      
                      <FolderOpen className={`w-4 h-4 flex-shrink-0 ml-1 ${isRootSelected ? 'text-blue-300' : 'text-gray-400'}`} />
                      <button
                        onClick={(e) => handleFolderClick(dir.path, e)}
                        onContextMenu={(e) => handleContextMenu(e, dir.path)}
                        className={`ml-2 text-sm truncate text-left transition-colors flex-1 ${
                          isRootSelected ? 'text-blue-100' : 'text-gray-300 hover:text-gray-100'
                        }`}
                        title={`Select folder: ${dir.path}`}
                      >
                        {dir.name}
                      </button>
                    </div>
                    <div className="relative z-10 flex items-center space-x-2 flex-shrink-0">
                      {progressEntry && (
                        <span
                          className="text-[10px] font-medium text-gray-300 tabular-nums"
                          title={isScanning ? 'Scanning folder...' : `${progressEntry.current} / ${progressEntry.total} items loaded`}
                        >
                          {isScanning ? 'Scanning...' : `${Math.round(progressPercent)}%`}
                        </span>
                      )}
                      <button
                        onClick={() => {
                            onUpdateDirectory(dir.id);
                            // Also refresh subfolders
                            setSubfolderCache(prev => {
                                const next = new Map(prev);
                                next.delete(rootKey);
                                return next;
                            });
                            void loadSubfolders(rootKey, dir.path, dir);
                        }}
                        disabled={isIndexing || isRefreshing}
                        className={`transition-colors ${
                          isRefreshing
                            ? 'text-gray-200'
                            : isIndexing
                              ? 'text-gray-600 cursor-not-allowed'
                              : 'text-gray-400 hover:text-gray-50'
                        }`}
                        title={
                          isRefreshing
                            ? 'Refreshing folder'
                            : isIndexing
                              ? 'Cannot refresh during indexing'
                              : 'Refresh folder'
                        }
                      >
                        <RotateCcw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={() => onRemoveDirectory(dir.id)}
                        disabled={isIndexing || isRefreshing}
                        className={`transition-colors ${
                          isRefreshing || isIndexing
                            ? 'text-gray-600 cursor-not-allowed'
                            : 'text-gray-400 hover:text-red-500'
                        }`}
                        title={
                          isRefreshing
                            ? 'Cannot remove while refreshing'
                            : isIndexing
                              ? 'Cannot remove during indexing'
                              : 'Remove folder'
                        }
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {isRootExpanded && hasSubfolders && (
                    <div className="ml-4 mt-1 space-y-1 border-l-2 border-gray-700 pl-2">
                      {scanSubfolders ? (
                        <>
                          <ul className="ml-3 space-y-1">
                            {isRootLoading ? (
                              <li className="text-xs text-gray-500 italic py-1">Loading subfolders...</li>
                            ) : rootChildren.length > 0 ? (
                              renderSubfolderList(dir, rootKey)
                            ) : null}
                          </ul>
                        </>
                      ) : (
                        <div className="text-xs text-gray-500 italic py-1">
                          No subfolders (folder loaded without "Scan Subfolders")
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-gray-800 border border-gray-600 rounded shadow-lg z-50 py-1 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
            onClick={() => {
              handleOpenInExplorer(contextMenu.path);
              setContextMenu(null);
            }}
          >
            <FolderOpen className="w-4 h-4" />
            Open in Explorer
          </button>
          
          <button
            className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
            onClick={() => {
                // Find root directory for this path to trigger refresh
                const rootDir = directories.find(d => contextMenu.path.startsWith(d.path));
                if (rootDir) {
                    onUpdateDirectory(rootDir.id, contextMenu.path);
                } else {
                    // Fallback or specific logic if needed
                    console.warn("Could not find root directory for", contextMenu.path);
                }
                setContextMenu(null);
            }}
            disabled={isIndexing}
          >
            <RotateCcw className={`w-4 h-4 ${isIndexing ? 'text-gray-600' : ''}`} />
            Refresh Folder
          </button>

          <div className="h-px bg-gray-700 my-1" />

          {clipboard && clipboard.imageIds.length > 0 && (
            <button
              className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
              onClick={async () => {
                if (!canUseFileManagement) {
                  showProModal('file_management');
                  setContextMenu(null);
                  return;
                }
                const destPath = contextMenu.path;
                const destinationDirectory = createTransferDestination(directories, destPath);
                const imagesToTransfer = useImageStore.getState().images.filter(img => clipboard.imageIds.includes(img.id));
                if (imagesToTransfer.length > 0 && destinationDirectory) {
                  setIsTransferring(true);
                  try {
                    await transferIndexedImages({
                      images: imagesToTransfer,
                      destinationDirectory,
                      mode: clipboard.mode,
                    });
                    if (clipboard.mode === 'move') {
                      useImageStore.getState().setClipboard(null);
                    }
                    onUpdateDirectory(destinationDirectory.id, destPath);
                  } catch (err) {
                    console.error('Paste failed:', err);
                  } finally {
                    setIsTransferring(false);
                  }
                }
                setContextMenu(null);
              }}
            >
              <Clipboard className="w-4 h-4 text-blue-400" />
              Paste {clipboard.imageIds.length} image(s)
            </button>
          )}

          <button
            className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
            onClick={() => {
              if (!canUseFileManagement) {
                showProModal('file_management');
                setContextMenu(null);
                return;
              }
              const targetPath = contextMenu.path;
              setContextMenu(null);
              setFolderPrompt({
                mode: 'new',
                targetPath,
                defaultValue: '',
                onConfirm: async (newName) => {
                  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
                  if (isElectron && newName.trim()) {
                    const newPath = await joinElectronPath(targetPath, newName.trim());
                    if (!newPath) return;
                    const result = await (window as any).electronAPI.ensureDirectory(newPath);
                    if (!result?.success) {
                      useImageStore.getState().setError(result?.error || 'Failed to create folder.');
                      return;
                    }
                    const rootDir = findRootDirectoryForPath(directories, targetPath);
                    if (rootDir) {
                      const nodeKey = makeNodeKey(rootDir.id, getRelativePath(rootDir.path, targetPath));
                      setSubfolderCache(prev => {
                        const next = new Map(prev);
                        next.delete(nodeKey);
                        return next;
                      });
                      setExpandedNodes(prev => new Set(prev).add(nodeKey));
                      await loadSubfolders(nodeKey, targetPath, rootDir);
                      onUpdateDirectory(rootDir.id, targetPath);
                    }
                  }
                },
              });
            }}
          >
            <FolderPlus className="w-4 h-4 text-green-400" />
            New Folder
          </button>

          <button
            className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
            onClick={() => {
              if (!canUseFileManagement) {
                showProModal('file_management');
                setContextMenu(null);
                return;
              }
              const folderName = contextMenu.path.split(/[\\/]/).pop() ?? '';
              if (!folderName) { setContextMenu(null); return; }
              const targetPath = contextMenu.path;
              setContextMenu(null);
              setFolderPrompt({
                mode: 'rename',
                targetPath,
                defaultValue: folderName,
                onConfirm: async (newName) => {
                  if (newName.trim() && newName.trim() !== folderName) {
                    const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
                    if (isElectron) {
                      const parentPath = targetPath.substring(0, targetPath.length - folderName.length - 1);
                      const newPath = await joinElectronPath(parentPath, newName.trim());
                      if (!newPath) return;
                      const result = await (window as any).electronAPI.renameFile(targetPath, newPath);
                      if (!result?.success) {
                        useImageStore.getState().setError(result?.error || 'Failed to rename folder.');
                        return;
                      }
                      const rootDir = findRootDirectoryForPath(directories, targetPath);
                      if (rootDir) {
                        const isRootRename = normalizePath(rootDir.path) === normalizePath(targetPath);
                        if (isRootRename) {
                          renameIndexedRootInStore(targetPath, newPath, newName.trim());
                          if (rootDir.autoWatch) {
                            await rebindRootWatcher(targetPath, newPath, newPath);
                          }
                          onUpdateDirectory(newPath);
                          return;
                        }

                        const parentKey = makeNodeKey(rootDir.id, getRelativePath(rootDir.path, parentPath));
                        setSubfolderCache(prev => {
                          const next = new Map(prev);
                          next.delete(parentKey);
                          next.delete(makeNodeKey(rootDir.id, getRelativePath(rootDir.path, targetPath)));
                          return next;
                        });
                        setExpandedNodes(prev => new Set(prev).add(parentKey));
                        await loadSubfolders(parentKey, parentPath, rootDir);
                        onUpdateDirectory(rootDir.id);
                      }
                    }
                  }
                },
              });
            }}
          >
            <Edit2 className="w-4 h-4 text-yellow-400" />
            Rename Folder
          </button>

          <div className="h-px bg-gray-700 my-1" />

          {excludedFolders?.has(normalizePath(contextMenu.path)) ? (
            onIncludeFolder && (
              <button
                className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
                onClick={() => {
                  onIncludeFolder(normalizePath(contextMenu.path));
                  setContextMenu(null);
                }}
              >
                <Eye className="w-4 h-4" />
                Include Folder
              </button>
            )
          ) : (
            onExcludeFolder && (
              <button
                className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
                onClick={() => {
                  // No confirmation dialog as requested
                  onExcludeFolder(normalizePath(contextMenu.path));
                  setContextMenu(null);
                }}
              >
                <EyeOff className="w-4 h-4" />
                Exclude Folder
              </button>
            )
          )}
        </div>
      )}

      {/* Custom folder prompt modal (replaces window.prompt which is unsupported in Electron) */}
      {folderPrompt && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setFolderPrompt(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl p-5 w-80 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-white">
              {folderPrompt.mode === 'new' ? 'New Folder' : 'Rename Folder'}
            </h3>
            <input
              ref={folderPromptInputRef}
              type="text"
              value={folderPromptValue}
              onChange={(e) => setFolderPromptValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  folderPrompt.onConfirm(folderPromptValue);
                  setFolderPrompt(null);
                } else if (e.key === 'Escape') {
                  setFolderPrompt(null);
                }
              }}
              placeholder={folderPrompt.mode === 'new' ? 'Folder name…' : 'New name…'}
              className="bg-gray-700 border border-gray-500 rounded px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
                onClick={() => setFolderPrompt(null)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                onClick={() => {
                  folderPrompt.onConfirm(folderPromptValue);
                  setFolderPrompt(null);
                }}
              >
                {folderPrompt.mode === 'new' ? 'Create' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


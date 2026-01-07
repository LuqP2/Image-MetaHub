import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Directory } from '../types';
import { FolderOpen, RotateCcw, Trash2, ChevronDown, Folder, Eye } from 'lucide-react';

interface DirectoryListProps {
  directories: Directory[];
  onRemoveDirectory: (directoryId: string) => void;
  onUpdateDirectory: (directoryId: string) => void;
  onToggleVisibility: (directoryId: string) => void;
  onToggleAutoWatch: (directoryId: string) => void;
  refreshingDirectories?: Set<string>;
  onUpdateSelection?: (
    path: string,
    state: 'checked' | 'unchecked',
    options?: { applyToDescendants?: boolean; clearDescendantOverrides?: boolean }
  ) => void;
  getSelectionState?: (path: string) => 'checked' | 'unchecked';
  folderSelection?: Map<string, 'checked' | 'unchecked'>;
  isIndexing?: boolean;
  scanSubfolders?: boolean;
}

interface SubfolderNode {
  name: string;
  path: string;
  relativePath: string;
}

const normalizePath = (path: string) => path.replace(/[\\/]+$/, '');
const toForwardSlashes = (path: string) => normalizePath(path).replace(/\\/g, '/');
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

export default function DirectoryList({
  directories,
  onRemoveDirectory,
  onUpdateDirectory,
  onToggleVisibility,
  onToggleAutoWatch,
  refreshingDirectories,
  onUpdateSelection,
  getSelectionState,
  folderSelection = new Map<string, 'checked' | 'unchecked'>(),
  isIndexing = false,
  scanSubfolders = false
}: DirectoryListProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [subfolderCache, setSubfolderCache] = useState<Map<string, SubfolderNode[]>>(new Map());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [autoMarkedNodes, setAutoMarkedNodes] = useState<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = useState(true);
  const [autoExpandedDirs, setAutoExpandedDirs] = useState<Set<string>>(new Set());

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

          if (
            scanSubfolders &&
            onUpdateSelection &&
            getSelectionState &&
            !autoMarkedNodes.has(nodeKey)
          ) {
            if (getSelectionState(nodePath) !== 'checked') {
              onUpdateSelection(nodePath, 'checked');
            }

            subfolders.forEach(subfolder => {
              if (getSelectionState(subfolder.path) !== 'checked') {
                onUpdateSelection(subfolder.path, 'checked');
              }
            });

            setAutoMarkedNodes(prev => {
              const next = new Set(prev);
              next.add(nodeKey);
              return next;
            });
          }
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
  }, [autoMarkedNodes, getSelectionState, onUpdateSelection, scanSubfolders]);

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
        await (window as any).electronAPI.showItemInFolder(path);
      } else {
        alert('This feature requires the desktop app. Please use the Image MetaHub application.');
      }
    } catch (error) {
      console.error('Error opening folder:', error);
      alert('Failed to open folder. Please check the path.');
    }
  };

  const handleSelectAll = useCallback((dirPath: string) => {
    if (onUpdateSelection) {
      onUpdateSelection(dirPath, 'checked', { clearDescendantOverrides: true });
    }
  }, [onUpdateSelection]);

  const handleDeselectAll = useCallback((dirPath: string) => {
    if (onUpdateSelection) {
      onUpdateSelection(dirPath, 'unchecked', { applyToDescendants: true });
    }
  }, [onUpdateSelection]);

  const renderSubfolderList = useCallback((rootDirectory: Directory, parentKey: string): React.ReactNode => {
    const children = subfolderCache.get(parentKey) || [];

    return children.map(child => {
      const childKey = makeNodeKey(rootDirectory.id, child.relativePath);
      const isExpandedNode = expandedNodes.has(childKey);
      const isLoadingNode = loadingNodes.has(childKey);
      const grandchildren = subfolderCache.get(childKey) || [];
      const childPaths = grandchildren.map(grandchild => grandchild.path);

      return (
        <li key={childKey} className="py-1">
          <div className="flex items-center">
            <button
              onClick={() => handleToggleNode(childKey, child.path, rootDirectory)}
              className="text-gray-500 hover:text-gray-300 transition-colors mr-1 flex-shrink-0"
              title={isExpandedNode ? 'Hide subfolders' : 'Show subfolders'}
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform ${isExpandedNode ? 'rotate-0' : '-rotate-90'}`}
              />
            </button>
            <FolderCheckbox
              path={child.path}
              childPaths={childPaths}
              getSelectionState={getSelectionState}
              onUpdateSelection={onUpdateSelection}
              selectionMap={folderSelection}
              title="Show/hide images from this subfolder"
              className="mr-2"
            />
            <button
              onClick={() => handleOpenInExplorer(child.path)}
              className="flex items-center text-sm text-gray-400 hover:text-blue-400 hover:underline transition-colors"
              title={`Click to open: ${child.path}`}
            >
              <Folder className="w-3 h-3 mr-1" />
              {child.name}
            </button>
          </div>
          {isExpandedNode && (
            <ul className="ml-4 mt-1 space-y-1 border-l border-gray-700 pl-2">
              {isLoadingNode ? (
                <li className="text-xs text-gray-500 italic py-1">Loading subfolders...</li>
              ) : grandchildren.length > 0 ? (
                renderSubfolderList(rootDirectory, childKey)
              ) : (
                <li className="text-xs text-gray-500 italic py-1">No subfolders found</li>
              )}
            </ul>
          )}
        </li>
      );
    });
  }, [expandedNodes, folderSelection, getSelectionState, handleOpenInExplorer, handleToggleNode, loadingNodes, onUpdateSelection, subfolderCache]);

  return (
    <div className="border-b border-gray-700">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <span className="text-gray-300 font-medium">Folders</span>
          <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded border border-gray-600">
            {directories.length}
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>
      {isExpanded && (
        <div className="px-4 pb-4">
          <ul className="space-y-1">
            {directories.map((dir) => {
              const rootKey = makeNodeKey(dir.id, '');
              const isRootExpanded = expandedNodes.has(rootKey);
              const isRootLoading = loadingNodes.has(rootKey);
              const rootChildren = subfolderCache.get(rootKey) || [];
              const rootChildPaths = rootChildren.map(child => child.path);
              const isRefreshing = refreshingDirectories?.has(dir.id) ?? false;

              return (
                <li key={dir.id}>
                  <div className="flex items-center justify-between bg-gray-800 p-2 rounded-md">
                    <div className="flex items-center overflow-hidden flex-1">
                      <input
                        type="checkbox"
                        checked={dir.visible ?? true}
                        onChange={() => onToggleVisibility(dir.id)}
                        className="mr-2 w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer flex-shrink-0"
                        title="Show/hide images from this folder"
                      />
                      <button
                        onClick={() => handleToggleNode(rootKey, dir.path, dir)}
                        className="text-gray-400 hover:text-gray-300 transition-colors flex-shrink-0"
                        title={isRootExpanded ? 'Hide subfolders' : 'Show subfolders'}
                      >
                        <ChevronDown
                          className={`w-4 h-4 transition-transform ${isRootExpanded ? 'rotate-0' : '-rotate-90'}`}
                        />
                      </button>
                      <FolderOpen className="w-4 h-4 text-gray-400 flex-shrink-0 ml-1" />
                      <button
                        onClick={() => handleOpenInExplorer(dir.path)}
                        className="ml-2 text-sm text-gray-300 hover:text-blue-400 hover:underline truncate text-left transition-colors flex-1"
                        title={`Click to open: ${dir.path}`}
                      >
                        {dir.name}
                      </button>
                    </div>
                    <div className="flex items-center space-x-2 flex-shrink-0">
                      <button
                        onClick={() => onUpdateDirectory(dir.id)}
                        disabled={isIndexing || isRefreshing}
                        className={`transition-colors ${
                          isRefreshing
                            ? 'text-blue-400'
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
                        onClick={() => onToggleAutoWatch(dir.id)}
                        disabled={isIndexing}
                        className={`transition-colors ${
                          isIndexing
                            ? 'text-gray-600 cursor-not-allowed'
                            : dir.autoWatch
                              ? 'text-green-500 hover:text-green-400'
                              : 'text-gray-400 hover:text-gray-50'
                        }`}
                        title={
                          isIndexing
                            ? 'Cannot toggle during indexing'
                            : dir.autoWatch
                              ? 'Auto-watch enabled - click to disable'
                              : 'Enable auto-watch for new images'
                        }
                      >
                        <Eye className={`w-4 h-4 ${dir.autoWatch ? 'fill-current' : ''}`} />
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

                  {isRootExpanded && (
                    <div className="ml-4 mt-1 space-y-1 border-l-2 border-gray-700 pl-2">
                      {scanSubfolders ? (
                        <>
                          <div className="py-1 flex items-center justify-between">
                            <span className="text-xs text-gray-500">Subfolder Selection:</span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleSelectAll(dir.path)}
                                className="text-xs px-2 py-0.5 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                                title="Select all subfolders and root"
                              >
                                Select All
                              </button>
                              <button
                                onClick={() => handleDeselectAll(dir.path)}
                                className="text-xs px-2 py-0.5 bg-gray-600 hover:bg-gray-500 rounded transition-colors"
                                title="Deselect all subfolders and root"
                              >
                                Clear
                              </button>
                            </div>
                          </div>

                          <div className="py-1 flex items-center">
                            <FolderCheckbox
                              path={dir.path}
                              childPaths={rootChildPaths}
                              getSelectionState={getSelectionState}
                              onUpdateSelection={onUpdateSelection}
                              selectionMap={folderSelection}
                              title="Show/hide images from root directory only"
                              className="mr-2"
                            />
                            <button
                              onClick={() => handleOpenInExplorer(dir.path)}
                              className="flex items-center text-sm text-gray-400 hover:text-blue-400 hover:underline transition-colors"
                              title={`Click to open: ${dir.path}`}
                            >
                              <Folder className="w-3 h-3 mr-1" />
                              <span className="italic">(root)</span>
                            </button>
                          </div>

                          <ul className="ml-3 space-y-1">
                            {isRootLoading ? (
                              <li className="text-xs text-gray-500 italic py-1">Loading subfolders...</li>
                            ) : rootChildren.length > 0 ? (
                              renderSubfolderList(dir, rootKey)
                            ) : (
                              <li className="text-xs text-gray-500 italic py-1">No subfolders found</li>
                            )}
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
    </div>
  );
}

interface FolderCheckboxProps {
  path: string;
  childPaths: string[];
  getSelectionState?: (path: string) => 'checked' | 'unchecked';
  onUpdateSelection?: (path: string, state: 'checked' | 'unchecked') => void;
  selectionMap: Map<string, 'checked' | 'unchecked'>;
  title: string;
  className?: string;
}

const FolderCheckbox: React.FC<FolderCheckboxProps> = ({
  path,
  childPaths,
  getSelectionState,
  onUpdateSelection,
  selectionMap,
  title,
  className
}) => {
  const checkboxRef = useRef<HTMLInputElement>(null);
  const ownState = getSelectionState ? getSelectionState(path) : 'unchecked';

  const displayState = useMemo(() => {
    let hasChecked = ownState === 'checked';
    let hasUnchecked = ownState === 'unchecked';

    childPaths.forEach(childPath => {
      const childState = getSelectionState ? getSelectionState(childPath) : 'unchecked';
      if (childState === 'checked') {
        hasChecked = true;
      } else {
        hasUnchecked = true;
      }
    });

    if (hasChecked && hasUnchecked) {
      return 'partial';
    }

    return hasChecked ? 'checked' : 'unchecked';
  }, [childPaths, getSelectionState, ownState, selectionMap]);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = displayState === 'partial';
    }
  }, [displayState, selectionMap]);

  const handleChange = () => {
    if (!onUpdateSelection) {
      return;
    }

    const nextState = ownState === 'checked' ? 'unchecked' : 'checked';
    onUpdateSelection(path, nextState);
  };

  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      checked={ownState === 'checked'}
      onChange={handleChange}
      className={`w-3 h-3 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer flex-shrink-0 ${className ?? ''}`.trim()}
      title={title}
    />
  );
};

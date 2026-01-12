import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Directory } from '../types';
import { FolderOpen, RotateCcw, Trash2, ChevronDown, Folder } from 'lucide-react';

interface DirectoryListProps {
  directories: Directory[];
  onRemoveDirectory: (directoryId: string) => void;
  onUpdateDirectory: (directoryId: string) => void;
  refreshingDirectories?: Set<string>;
  onToggleFolderSelection?: (path: string, ctrlKey: boolean) => void;
  isFolderSelected?: (path: string) => boolean;
  selectedFolders?: Set<string>;
  includeSubfolders?: boolean;
  onToggleIncludeSubfolders?: () => void;
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
  refreshingDirectories,
  onToggleFolderSelection,
  isFolderSelected,
  selectedFolders = new Set<string>(),
  includeSubfolders = true,
  onToggleIncludeSubfolders,
  isIndexing = false,
  scanSubfolders = false
}: DirectoryListProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [subfolderCache, setSubfolderCache] = useState<Map<string, SubfolderNode[]>>(new Map());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [autoMarkedNodes, setAutoMarkedNodes] = useState<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = useState(true);
  const [autoExpandedDirs, setAutoExpandedDirs] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    path: string;
  } | null>(null);

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
        await (window as any).electronAPI.showItemInFolder(path);
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
    if (!onToggleFolderSelection) return;
    onToggleFolderSelection(path, event.ctrlKey);
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
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

  const renderSubfolderList = useCallback((rootDirectory: Directory, parentKey: string): React.ReactNode => {
    const children = subfolderCache.get(parentKey) || [];

    return children.map(child => {
      const childKey = makeNodeKey(rootDirectory.id, child.relativePath);
      const isExpandedNode = expandedNodes.has(childKey);
      const isLoadingNode = loadingNodes.has(childKey);
      const grandchildren = subfolderCache.get(childKey) || [];
      const isSelected = isFolderSelected ? isFolderSelected(child.path) : false;

      return (
        <li key={childKey} className="py-1">
          <div
            className={`flex items-center cursor-pointer rounded px-2 py-1 transition-colors ${
              isSelected
                ? 'bg-blue-600/30 hover:bg-blue-600/40'
                : 'hover:bg-gray-700/50'
            }`}
            onClick={(e) => handleFolderClick(child.path, e)}
            onContextMenu={(e) => handleContextMenu(e, child.path)}
          >
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
            <Folder className="w-3 h-3 mr-2 text-gray-400" />
            <span className="text-sm text-gray-300">{child.name}</span>
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
  }, [expandedNodes, handleFolderClick, handleContextMenu, handleToggleNode, isFolderSelected, loadingNodes, subfolderCache]);

  return (
    <div className="border-b border-gray-700">
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
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                includeSubfolders
                  ? 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500'
                  : 'bg-gray-700 border-gray-600 text-gray-400 hover:bg-gray-600'
              }`}
              title={includeSubfolders ? 'Including subfolders (click to disable)' : 'Not including subfolders (click to enable)'}
            >
              {includeSubfolders ? '📁 + Subfolders' : '📁 Direct'}
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

              return (
                <li key={dir.id}>
                  <div
                    className={`flex items-center justify-between p-2 rounded-md transition-colors ${
                      isRootSelected
                        ? 'bg-blue-600/30 hover:bg-blue-600/40'
                        : 'bg-gray-800 hover:bg-gray-700/50'
                    }`}
                  >
                    <div className="flex items-center overflow-hidden flex-1">
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
                        onClick={(e) => handleFolderClick(dir.path, e)}
                        onContextMenu={(e) => handleContextMenu(e, dir.path)}
                        className={`ml-2 text-sm truncate text-left transition-colors flex-1 ${
                          isRootSelected ? 'text-white' : 'text-gray-300 hover:text-gray-100'
                        }`}
                        title={`Select folder: ${dir.path}`}
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
        </div>
      )}
    </div>
  );
}


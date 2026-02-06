import React, { useCallback, useEffect, useState } from 'react';
import { Directory } from '../types';
import { FolderOpen, RotateCcw, Trash2, ChevronDown, Folder, FolderTree, X, EyeOff } from 'lucide-react';

interface DirectoryListProps {
  directories: Directory[];
  onRemoveDirectory: (directoryId: string) => void;
  onUpdateDirectory: (directoryId: string, subPath?: string) => void;
  refreshingDirectories?: Set<string>;
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
}

interface SubfolderNode {
  name: string;
  path: string;
  relativePath: string;
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

export default function DirectoryList({
  directories,
  onRemoveDirectory,
  onUpdateDirectory,
  refreshingDirectories,
  onToggleFolderSelection,
  onClearFolderSelection,
  isFolderSelected,
  selectedFolders = new Set<string>(),
  includeSubfolders = true,
  onToggleIncludeSubfolders,
  isIndexing = false,
  scanSubfolders = false,
  excludedFolders,
  onExcludeFolder
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
      
      if (!isElectron) {
        alert('This feature requires the desktop app. Please use the Image MetaHub application.');
        return;
      }

      // Prefer openPath to actually enter/open the directory
      if ((window as any).electronAPI.openPath) {
        const result = await (window as any).electronAPI.openPath(path);
        if (!result.success) {
            console.error('Failed to open folder:', result.error);
            // Display error to user so they know why "nothing happened"
            alert(`Failed to open folder: ${result.error}`);
        }
      } 
      // Fallback to showItemInFolder (reveal parent)
      else if ((window as any).electronAPI.showItemInFolder) {
        const result = await (window as any).electronAPI.showItemInFolder(path);
        if (!result.success) {
             console.error('Failed to reveal folder:', result.error);
             alert(`Failed to reveal folder: ${result.error}`);
        }
      } else {
         console.error('Electron API found but file operations missing.');
         alert('File operations are not supported in this version.');
      }
    } catch (error) {
      console.error('Error opening folder:', error);
      alert('Failed to open folder. Please check the path and try again.');
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
      window.addEventListener('click', handleClickOutside, true);
      return () => window.removeEventListener('click', handleClickOutside, true);
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

      // Skip excluded folders
      if (excludedFolders && excludedFolders.has(normalizePath(child.path))) {
        return null;
      }

      const hasSubfolders = isLoadingNode || !subfolderCache.has(childKey) || (subfolderCache.get(childKey)?.length ?? 0) > 0;

      return (
        <li key={childKey} className="py-1">
          <div
            className={`flex items-center cursor-pointer rounded px-2 py-1 transition-colors group ${
              isSelected
                ? 'bg-blue-600/30 hover:bg-blue-600/40'
                : 'hover:bg-gray-700/50'
            }`}
            onClick={(e) => handleFolderClick(child.path, e)}
            onContextMenu={(e) => handleContextMenu(e, child.path)}
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
            
            <Folder className="w-3 h-3 mr-2 text-gray-400" />
            <span className="text-sm text-gray-300 truncate flex-1">{child.name}</span>
            
            {/* Action Buttons (Visible on Hover) */}
            <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
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
                        <Trash2 className="w-3 h-3" />
                    </button>
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
  }, [expandedNodes, handleFolderClick, handleContextMenu, handleToggleNode, isFolderSelected, loadingNodes, subfolderCache, excludedFolders]);

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
              className={`p-1.5 rounded-md border transition-all ${
                includeSubfolders
                  ? 'bg-blue-600/20 border-blue-500/30 text-blue-400 hover:bg-blue-600/30'
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
              
              // Determine if we should show the expander
              // Show if loading, or if not yet loaded (not in cache), or if loaded and has children
              const hasSubfolders = isRootLoading || !subfolderCache.has(rootKey) || (subfolderCache.get(rootKey)?.length ?? 0) > 0;

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

          {onExcludeFolder && (
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
          )}
        </div>
      )}
    </div>
  );
}


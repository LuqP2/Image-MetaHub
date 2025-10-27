import React from 'react';
import { Directory } from '../types';
import { FolderOpen, RotateCcw, Trash2, ChevronDown, Folder } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

interface DirectoryListProps {
  directories: Directory[];
  onRemoveDirectory: (directoryId: string) => void;
  onUpdateDirectory: (directoryId: string) => void;
  onToggleVisibility: (directoryId: string) => void;
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

interface Subfolder {
  name: string;
  path: string;
}

export default function DirectoryList({
  directories,
  onRemoveDirectory,
  onUpdateDirectory,
  onToggleVisibility,
  onUpdateSelection,
  getSelectionState,
  folderSelection = new Map<string, 'checked' | 'unchecked'>(),
  isIndexing = false,
  scanSubfolders = false
}: DirectoryListProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [subfolders, setSubfolders] = useState<Map<string, Subfolder[]>>(new Map());
  const [loadingSubfolders, setLoadingSubfolders] = useState<Set<string>>(new Set());
  const [autoMarkedDirs, setAutoMarkedDirs] = useState<Set<string>>(new Set()); // Track which directories have been auto-marked

  const toggleExpanded = async (dirId: string) => {
    const newExpanded = new Set(expandedDirs);
    const isExpanding = !newExpanded.has(dirId);
    
    if (newExpanded.has(dirId)) {
      newExpanded.delete(dirId);
    } else {
      newExpanded.add(dirId);
    }
    setExpandedDirs(newExpanded);

    // Load subfolders when expanding for the first time
    if (isExpanding && !subfolders.has(dirId)) {
      const dir = directories.find(d => d.id === dirId);
      if (dir) {
        await loadSubfolders(dirId, dir.path);
      }
    }
  };

  const loadSubfolders = async (dirId: string, dirPath: string) => {
    try {
      setLoadingSubfolders(prev => new Set(prev).add(dirId));
      
      const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
      if (isElectron && (window as any).electronAPI.listSubfolders) {
        const result = await (window as any).electronAPI.listSubfolders(dirPath);
        
        if (result.success) {
          setSubfolders(prev => new Map(prev).set(dirId, result.subfolders || []));
          
          // Auto-mark root and subfolders ONLY if:
          // 1. scanSubfolders was enabled during indexing
          // 2. This directory hasn't been auto-marked before (first time loading)
          if (scanSubfolders && result.subfolders && result.subfolders.length > 0 && !autoMarkedDirs.has(dirId)) {
            if (onUpdateSelection && getSelectionState) {
              if (getSelectionState(dirPath) !== 'checked') {
                onUpdateSelection(dirPath, 'checked', { clearDescendantOverrides: true });
              }

              result.subfolders.forEach((subfolder: { path: string }) => {
                if (getSelectionState(subfolder.path) !== 'checked') {
                  onUpdateSelection(subfolder.path, 'checked', { clearDescendantOverrides: true });
                }
              });
            }

            // Mark this directory as auto-marked
            setAutoMarkedDirs(prev => new Set(prev).add(dirId));
          }
        } else {
          console.error('Failed to load subfolders:', result.error);
        }
      }
    } catch (error) {
      console.error('Error loading subfolders:', error);
    } finally {
      setLoadingSubfolders(prev => {
        const newSet = new Set(prev);
        newSet.delete(dirId);
        return newSet;
      });
    }
  };

  const handleOpenInExplorer = async (path: string) => {
    try {
      // Use Electron API to open folder in Explorer/Finder/File Manager
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

  const handleSelectAll = (dirPath: string) => {
    if (onUpdateSelection) {
      onUpdateSelection(dirPath, 'checked', { clearDescendantOverrides: true });
    }
  };

  const handleDeselectAll = (dirPath: string) => {
    if (onUpdateSelection) {
      onUpdateSelection(dirPath, 'unchecked', { applyToDescendants: true });
    }
  };

  const [isExpanded, setIsExpanded] = React.useState(true);

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
          {/* No scroll here - uses parent sidebar scroll */}
          <ul className="space-y-1">
            {directories.map((dir) => (
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
                  onClick={() => toggleExpanded(dir.id)}
                  className="text-gray-400 hover:text-gray-300 transition-colors flex-shrink-0"
                  title={expandedDirs.has(dir.id) ? "Hide subfolders" : "Show subfolders"}
                >
                  <ChevronDown 
                    className={`w-4 h-4 transition-transform ${expandedDirs.has(dir.id) ? 'rotate-0' : '-rotate-90'}`}
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
                  disabled={isIndexing}
                  className={`transition-colors ${isIndexing ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white'}`}
                  title={isIndexing ? "Cannot refresh during indexing" : "Refresh folder"}
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onRemoveDirectory(dir.id)}
                  disabled={isIndexing}
                  className={`transition-colors ${isIndexing ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-red-500'}`}
                  title={isIndexing ? "Cannot remove during indexing" : "Remove folder"}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            {/* Subfolders list */}
            {expandedDirs.has(dir.id) && (
              <ul className="ml-4 mt-1 space-y-1 border-l-2 border-gray-700 pl-2">
                {loadingSubfolders.has(dir.id) ? (
                  <li className="text-xs text-gray-500 italic py-1">
                    Loading subfolders...
                  </li>
                ) : (
                  <>
                    {/* Only show subfolder controls if scanSubfolders was enabled */}
                    {scanSubfolders ? (
                      <>
                        {/* Select All / Deselect All buttons */}
                        <li className="py-1 flex items-center justify-between">
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
                        </li>
                        
                        {/* Root directory checkbox */}
                        <li className="py-1">
                          <div className="flex items-center">
                            <RootCheckbox
                              directoryPath={dir.path}
                              dirId={dir.id}
                              getSelectionState={getSelectionState}
                              subfolders={subfolders}
                              onUpdateSelection={onUpdateSelection}
                              selectionMap={folderSelection}
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
                        </li>
                        
                        {/* Subfolders list */}
                        {subfolders.get(dir.id)?.length ? (
                          subfolders.get(dir.id)!.map((subfolder) => (
                            <li key={subfolder.path} className="py-1">
                              <div className="flex items-center">
                                <SubfolderCheckbox
                                  path={subfolder.path}
                                  getSelectionState={getSelectionState}
                                  onUpdateSelection={onUpdateSelection}
                                  selectionMap={folderSelection}
                                />
                                <button
                                  onClick={() => handleOpenInExplorer(subfolder.path)}
                                  className="flex items-center text-sm text-gray-400 hover:text-blue-400 hover:underline transition-colors"
                                  title={`Click to open: ${subfolder.path}`}
                                >
                                  <Folder className="w-3 h-3 mr-1" />
                                  {subfolder.name}
                                </button>
                              </div>
                            </li>
                          ))
                        ) : (
                          <li className="text-xs text-gray-500 italic py-1">
                            No subfolders found
                          </li>
                        )}
                      </>
                    ) : (
                      <li className="text-xs text-gray-500 italic py-1">
                        No subfolders (folder loaded without "Scan Subfolders")
                      </li>
                    )}
                  </>
                )}
              </ul>
            )}
          </li>
        ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface RootCheckboxProps {
  directoryPath: string;
  dirId: string;
  subfolders: Map<string, Subfolder[]>;
  getSelectionState?: (path: string) => 'checked' | 'unchecked';
  onUpdateSelection?: (
    path: string,
    state: 'checked' | 'unchecked',
    options?: { applyToDescendants?: boolean; clearDescendantOverrides?: boolean }
  ) => void;
  selectionMap: Map<string, 'checked' | 'unchecked'>;
}

const RootCheckbox: React.FC<RootCheckboxProps> = ({
  directoryPath,
  dirId,
  subfolders,
  getSelectionState,
  onUpdateSelection,
  selectionMap,
}) => {
  const checkboxRef = useRef<HTMLInputElement>(null);

  const childPaths = useMemo(
    () => subfolders.get(dirId)?.map((subfolder) => subfolder.path) ?? [],
    [subfolders, dirId]
  );

  const ownState = getSelectionState ? getSelectionState(directoryPath) : 'checked';

  const displayState = useMemo(() => {
    let hasChecked = ownState === 'checked';
    let hasUnchecked = ownState === 'unchecked';

    childPaths.forEach((childPath) => {
      const childState = getSelectionState ? getSelectionState(childPath) : 'checked';
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
  }, [displayState]);

  const handleChange = () => {
    if (!onUpdateSelection) {
      return;
    }

    const nextState = ownState === 'checked' ? 'unchecked' : 'checked';
    const options = nextState === 'checked'
      ? { clearDescendantOverrides: true }
      : { applyToDescendants: true };

    onUpdateSelection(directoryPath, nextState, options);
  };

  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      checked={ownState === 'checked'}
      onChange={handleChange}
      className="mr-2 w-3 h-3 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer flex-shrink-0"
      title="Show/hide images from root directory only"
    />
  );
};

interface SubfolderCheckboxProps {
  path: string;
  getSelectionState?: (path: string) => 'checked' | 'unchecked';
  onUpdateSelection?: (
    path: string,
    state: 'checked' | 'unchecked',
    options?: { applyToDescendants?: boolean; clearDescendantOverrides?: boolean }
  ) => void;
  selectionMap: Map<string, 'checked' | 'unchecked'>;
}

const SubfolderCheckbox: React.FC<SubfolderCheckboxProps> = ({
  path,
  getSelectionState,
  onUpdateSelection,
  selectionMap,
}) => {
  const checkboxRef = useRef<HTMLInputElement>(null);
  const currentState = getSelectionState ? getSelectionState(path) : 'checked';

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = false;
    }
  }, [selectionMap, currentState]);

  const handleChange = () => {
    if (!onUpdateSelection) {
      return;
    }

    const nextState = currentState === 'checked' ? 'unchecked' : 'checked';
    const options = nextState === 'checked'
      ? { clearDescendantOverrides: true }
      : { applyToDescendants: true };
    onUpdateSelection(path, nextState, options);
  };

  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      checked={currentState === 'checked'}
      onChange={handleChange}
      className="mr-2 w-3 h-3 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer flex-shrink-0"
      title="Show/hide images from this subfolder"
    />
  );
};
import React from 'react';
import { Directory } from '../types';
import { FolderOpen, RotateCcw, Trash2, ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface DirectoryListProps {
  directories: Directory[];
  onRemoveDirectory: (directoryId: string) => void;
  onUpdateDirectory: (directoryId: string) => void;
  onToggleVisibility: (directoryId: string) => void;
  isIndexing?: boolean;
}

export default function DirectoryList({ directories, onRemoveDirectory, onUpdateDirectory, onToggleVisibility, isIndexing = false }: DirectoryListProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const toggleExpanded = (dirId: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(dirId)) {
      newExpanded.delete(dirId);
    } else {
      newExpanded.add(dirId);
    }
    setExpandedDirs(newExpanded);
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
  return (
    <div className="p-4 border-t border-gray-700">
      <h3 className="text-lg font-semibold text-gray-300 mb-3">Folders</h3>
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
                <li className="text-xs text-gray-500 italic py-1">
                  Subfolder detection coming soon...
                </li>
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
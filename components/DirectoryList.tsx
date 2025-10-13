import React from 'react';
import { Directory } from '../types';

// Placeholder for icons - you can replace these with actual icon components
const FolderIcon = () => <span>📁</span>;
const RefreshIcon = () => <span>🔄</span>;
const TrashIcon = () => <span>🗑️</span>;

interface DirectoryListProps {
  directories: Directory[];
  onRemoveDirectory: (directoryId: string) => void;
  onUpdateDirectory: (directoryId: string) => void;
  onToggleVisibility: (directoryId: string) => void;
  isIndexing?: boolean;
}

export default function DirectoryList({ directories, onRemoveDirectory, onUpdateDirectory, onToggleVisibility, isIndexing = false }: DirectoryListProps) {
  return (
    <div className="p-4 border-t border-gray-700">
      <h3 className="text-lg font-semibold text-gray-300 mb-3">Folders</h3>
      <ul className="space-y-2">
        {directories.map((dir) => (
          <li
            key={dir.id}
            className="flex items-center justify-between bg-gray-800 p-2 rounded-md"
          >
            <div className="flex items-center overflow-hidden">
              <input
                type="checkbox"
                checked={dir.visible ?? true}
                onChange={() => onToggleVisibility(dir.id)}
                className="mr-2 w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer"
                title="Show/hide images from this folder"
              />
              <FolderIcon />
              <span className="ml-2 text-sm text-gray-300 truncate" title={dir.path}>
                {dir.name}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => onUpdateDirectory(dir.id)}
                disabled={isIndexing}
                className={`transition-colors ${isIndexing ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white'}`}
                title={isIndexing ? "Cannot refresh during indexing" : "Refresh folder"}
              >
                <RefreshIcon />
              </button>
              <button
                onClick={() => onRemoveDirectory(dir.id)}
                disabled={isIndexing}
                className={`transition-colors ${isIndexing ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-red-500'}`}
                title={isIndexing ? "Cannot remove during indexing" : "Remove folder"}
              >
                <TrashIcon />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
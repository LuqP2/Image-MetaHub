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
}

export default function DirectoryList({ directories, onRemoveDirectory, onUpdateDirectory }: DirectoryListProps) {
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
              <FolderIcon />
              <span className="ml-2 text-sm text-gray-300 truncate" title={dir.path}>
                {dir.name}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => onUpdateDirectory(dir.id)}
                className="text-gray-400 hover:text-white transition-colors"
                title="Refresh folder"
              >
                <RefreshIcon />
              </button>
              <button
                onClick={() => onRemoveDirectory(dir.id)}
                className="text-gray-400 hover:text-red-500 transition-colors"
                title="Remove folder"
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
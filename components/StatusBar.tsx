import React from 'react';

interface StatusBarProps {
  filteredCount: number;
  totalCount: number;
  directoryCount: number;
}

const StatusBar: React.FC<StatusBarProps> = ({ filteredCount, totalCount, directoryCount }) => {
  const folderText = directoryCount === 1 ? 'folder' : 'folders';
  return (
    <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700 text-gray-300 flex justify-between items-center">
      <span>
        Found <span className="font-bold text-blue-400">{filteredCount}</span> of <span className="font-bold text-green-400">{totalCount}</span> images across <span className="font-bold text-purple-400">{directoryCount}</span> {folderText}
      </span>
      <span className="text-xs text-gray-500">v0.9.2-beta.1</span>
    </div>
  );
};

export default StatusBar;
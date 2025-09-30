import React from 'react';

interface StatusBarProps {
  filteredCount: number;
  totalCount: number;
  directoryName: string;
}

const StatusBar: React.FC<StatusBarProps> = ({ filteredCount, totalCount, directoryName }) => {
  return (
    <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700 text-gray-300">
      Found <span className="font-bold text-blue-400">{filteredCount}</span> of <span className="font-bold text-green-400">{totalCount}</span> images in <span className="font-mono text-blue-300">{directoryName}</span>
    </div>
  );
};

export default StatusBar;
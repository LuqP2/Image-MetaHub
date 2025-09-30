import React from 'react';
import { resetAllCaches } from '../utils/cacheReset';

interface ActionToolbarProps {
  sortOrder: string;
  onSortOrderChange: (value: any) => void;
  selectedCount: number;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onTestBatchReading?: () => void; // Temporary test function
}

const ActionToolbar: React.FC<ActionToolbarProps> = ({
  sortOrder,
  onSortOrderChange,
  selectedCount,
  onClearSelection,
  onDeleteSelected,
  onTestBatchReading
}) => {
  return (
    <div className="flex justify-between items-center mb-4 p-3 bg-gray-800/60 rounded-lg border border-gray-700">
      <div>
        <label htmlFor="sortOrder" className="mr-2 text-gray-300">Sort by:</label>
        <select
          id="sortOrder"
          value={sortOrder}
          onChange={(e) => onSortOrderChange(e.target.value)}
          className="bg-gray-700 text-gray-200 border-gray-600 rounded-md p-1"
        >
          <option value="date-desc">Newest First</option>
          <option value="date-asc">Oldest First</option>
          <option value="asc">A-Z</option>
          <option value="desc">Z-A</option>
        </select>
        {onTestBatchReading && (
          <button
            onClick={onTestBatchReading}
            className="ml-4 px-3 py-1 bg-purple-600 text-white rounded-md hover:bg-purple-500 text-sm"
          >
            Test Batch Reading
          </button>
        )}
      </div>
      {selectedCount > 0 && (
        <div className="flex items-center gap-4">
          <span className="text-gray-300">{selectedCount} selected</span>
          <button onClick={onClearSelection} className="text-blue-400 hover:text-blue-300">
            Clear Selection
          </button>
          <button onClick={onDeleteSelected} className="text-red-500 hover:text-red-400">
            Delete Selected
          </button>
        </div>
      )}
    </div>
  );
};

export default ActionToolbar;
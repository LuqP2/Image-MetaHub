import React from 'react';
import ImageSizeSlider from './ImageSizeSlider';

interface ActionToolbarProps {
  sortOrder: string;
  onSortOrderChange: (value: any) => void;
  selectedCount: number;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
}

const ActionToolbar: React.FC<ActionToolbarProps> = ({
  sortOrder,
  onSortOrderChange,
  selectedCount,
  onClearSelection,
  onDeleteSelected,
}) => {
  return (
    <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-200">
      <div className="flex items-center gap-2">
        <label htmlFor="sortOrder" className="text-sm text-gray-600">Sort by:</label>
        <select
          id="sortOrder"
          value={sortOrder}
          onChange={(e) => onSortOrderChange(e.target.value)}
          className="px-2 py-1.5 text-sm border border-gray-300 rounded bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="date-desc">Newest First</option>
          <option value="date-asc">Oldest First</option>
          <option value="asc">A-Z</option>
          <option value="desc">Z-A</option>
        </select>
      </div>

      <ImageSizeSlider />

      <div>
        {selectedCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700">{selectedCount} selected</span>
            <button
              onClick={onClearSelection}
              className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-white rounded hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Clear
            </button>
            <button
              onClick={onDeleteSelected}
              className="px-3 py-1.5 text-sm font-medium text-red-600 bg-white rounded hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionToolbar;
import React from 'react';
import ImageSizeSlider from './ImageSizeSlider';
import { Grid3X3, List, Eye, EyeOff } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';

interface ActionToolbarProps {
  sortOrder: string;
  onSortOrderChange: (value: any) => void;
  selectedCount: number;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  onTestBatchReading?: () => void; // Temporary test function
  filteredCount?: number;
  totalCount?: number;
  directoryCount?: number;
  enrichmentProgress?: { processed: number; total: number } | null;
}

const ActionToolbar: React.FC<ActionToolbarProps> = ({
  sortOrder,
  onSortOrderChange,
  selectedCount,
  onClearSelection,
  onDeleteSelected,
  viewMode,
  onViewModeChange,
  onTestBatchReading,
  filteredCount,
  totalCount,
  directoryCount,
  enrichmentProgress
}) => {
  const folderText = directoryCount === 1 ? 'folder' : 'folders';
  const enableSafeMode = useSettingsStore((state) => state.enableSafeMode);
  const setEnableSafeMode = useSettingsStore((state) => state.setEnableSafeMode);
  
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center px-4 py-2 bg-gray-800/60 rounded-lg border border-gray-700">
        <div className="flex items-center gap-4">
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
          
          {filteredCount !== undefined && totalCount !== undefined && directoryCount !== undefined && (
            <>
              <div className="border-l border-gray-600 h-6 mx-2"></div>
              <span className="text-gray-400 text-sm">
                Displaying <span className="font-semibold text-gray-200">{filteredCount}</span> of <span className="font-semibold text-gray-200">{totalCount}</span> images across <span className="font-semibold text-gray-200">{directoryCount}</span> {folderText}
              </span>
            </>
          )}
          {onTestBatchReading && (
            <button
              onClick={onTestBatchReading}
              className="ml-4 px-3 py-1 bg-purple-600 text-white rounded-md hover:bg-purple-500 text-sm"
            >
              Test Batch Reading
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          <ImageSizeSlider />
          <button
            onClick={() => setEnableSafeMode(!enableSafeMode)}
            className="p-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md transition-colors"
            title={enableSafeMode ? 'Safe Mode on: sensitive tags are filtered or blurred' : 'Safe Mode off: sensitive tags are ignored'}
          >
            {enableSafeMode ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
          </button>
          <button
            onClick={() => onViewModeChange(viewMode === 'grid' ? 'list' : 'grid')}
            className="p-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md transition-colors"
            title={`Switch to ${viewMode === 'grid' ? 'list' : 'grid'} view`}
          >
            {viewMode === 'grid' ? <List className="h-5 w-5" /> : <Grid3X3 className="h-5 w-5" />}
          </button>

          {selectedCount > 0 && (
            <>
              <div className="border-l border-gray-600 h-6 mx-2"></div>
              <div className="flex items-center gap-4">
                <span className="text-gray-300">{selectedCount} selected</span>
                <button onClick={onClearSelection} className="text-blue-400 hover:text-blue-300">
                  Clear Selection
                </button>
                <button onClick={onDeleteSelected} className="text-red-500 hover:text-red-400">
                  Delete Selected
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Metadata Enrichment Progress Bar */}
      {enrichmentProgress && enrichmentProgress.total > 0 && (
        <div className="px-4 py-2 bg-gray-800/60 rounded-lg border border-gray-700">
          <div className="flex justify-between items-center text-xs mb-1">
            <span className="text-blue-400">
              📊 Extracting metadata: {enrichmentProgress.processed} / {enrichmentProgress.total}
            </span>
            <span className="text-gray-400">
              {Math.round((enrichmentProgress.processed / enrichmentProgress.total) * 100)}%
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
            <div 
              className="bg-blue-500 h-full transition-all duration-300 ease-out"
              style={{ width: `${(enrichmentProgress.processed / enrichmentProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ActionToolbar;

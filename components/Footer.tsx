import React, { useState, useEffect } from 'react';
import ImageSizeSlider from './ImageSizeSlider';
import { Grid3X3, List, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface FooterProps {
  // Pagination
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  itemsPerPage: number | 'all';
  onItemsPerPageChange: (items: number | 'all') => void;
  totalItems: number;
  
  // ActionToolbar
  sortOrder: string;
  onSortOrderChange: (value: string) => void;
  selectedCount: number;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  filteredCount?: number;
  totalCount?: number;
  directoryCount?: number;
  enrichmentProgress?: { processed: number; total: number } | null;
}

const Footer: React.FC<FooterProps> = ({
  // Pagination
  currentPage,
  totalPages,
  onPageChange,
  itemsPerPage,
  onItemsPerPageChange,
  
  // ActionToolbar
  sortOrder,
  onSortOrderChange,
  selectedCount,
  onClearSelection,
  onDeleteSelected,
  viewMode,
  onViewModeChange,
  filteredCount,
  totalCount,
  directoryCount,
  enrichmentProgress
}) => {
  const [isEditingPage, setIsEditingPage] = useState(false);
  const [pageInput, setPageInput] = useState(currentPage.toString());

  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  const handlePageInputSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    let newPage = parseInt(pageInput, 10);
    if (!isNaN(newPage)) {
      newPage = Math.max(1, Math.min(newPage, totalPages));
      onPageChange(newPage);
    }
    setIsEditingPage(false);
  };

  const handleItemsPerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onItemsPerPageChange(value === 'all' ? 'all' : parseInt(value, 10));
  };

  const folderText = directoryCount === 1 ? 'folder' : 'folders';
  const showPageControls = totalPages > 1;

  return (
    <div className="flex flex-col gap-2">
      {/* Metadata Enrichment Progress Bar */}
      {enrichmentProgress && enrichmentProgress.total > 0 && (
        <div className="px-4 py-2 bg-gray-800/40 rounded-lg border border-gray-700/50">
          <div className="flex justify-between items-center text-xs mb-1">
            <span className="text-blue-400">
              📊 Extracting metadata: {enrichmentProgress.processed} / {enrichmentProgress.total}
            </span>
            <span className="text-gray-500">
              {Math.round((enrichmentProgress.processed / enrichmentProgress.total) * 100)}%
            </span>
          </div>
          <div className="w-full bg-gray-700/50 rounded-full h-1 overflow-hidden">
            <div 
              className="bg-blue-500 h-full transition-all duration-300 ease-out"
              style={{ width: `${(enrichmentProgress.processed / enrichmentProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Footer Controls */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 bg-gray-800/40 rounded-lg border border-gray-700/50 text-sm">
        
        {/* Left: Sort and Display Info */}
        <div className="flex items-center gap-3 min-w-0">
          <label htmlFor="sortOrder" className="text-gray-400 whitespace-nowrap text-xs">Sort:</label>
          <select
            id="sortOrder"
            value={sortOrder}
            onChange={(e) => onSortOrderChange(e.target.value)}
            className="bg-gray-700/50 text-gray-300 border border-gray-600/50 rounded px-2 py-1 text-xs hover:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="date-desc">Newest</option>
            <option value="date-asc">Oldest</option>
            <option value="asc">A-Z</option>
            <option value="desc">Z-A</option>
          </select>

          <div className="border-l border-gray-600/50 h-4" />

          {filteredCount !== undefined && totalCount !== undefined && directoryCount !== undefined && (
            <span className="text-gray-500 text-xs whitespace-nowrap">
              <span className="text-gray-300">{filteredCount}</span>/<span className="text-gray-300">{totalCount}</span> across <span className="text-gray-300">{directoryCount}</span> {folderText === 'folder' ? '📁' : '📁s'}
            </span>
          )}
        </div>

        {/* Middle: Pagination and Display */}
        <div className="flex items-center gap-2">
          {/* Items per page */}
          <label htmlFor="items-per-page" className="text-gray-400 text-xs whitespace-nowrap">Show:</label>
          <select
            id="items-per-page"
            value={itemsPerPage}
            onChange={handleItemsPerPageChange}
            className="bg-gray-700/50 border border-gray-600/50 rounded px-2 py-1 text-gray-300 text-xs hover:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={500}>500</option>
            <option value="all">All</option>
          </select>

          {showPageControls && (
            <>
              <div className="border-l border-gray-600/50 h-4" />

              {/* Page navigation */}
              <button
                onClick={() => onPageChange(1)}
                disabled={currentPage === 1}
                className="p-1 bg-gray-700/50 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="First Page"
              >
                <ChevronsLeft className="w-3 h-3 text-gray-400" />
              </button>

              <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-2 py-1 bg-gray-700/50 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-400 text-xs transition-colors"
              >
                Prev
              </button>

              {isEditingPage ? (
                <form onSubmit={handlePageInputSubmit}>
                  <input
                    type="number"
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    onBlur={() => setIsEditingPage(false)}
                    autoFocus
                    className="w-12 text-center bg-gray-800 border border-gray-600/50 rounded px-1 py-1 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </form>
              ) : (
                <button
                  onClick={() => setIsEditingPage(true)}
                  className="text-gray-400 hover:text-gray-300 text-xs px-2 py-1 rounded hover:bg-gray-700/30 transition-colors"
                  title="Click to edit page number"
                >
                  <span className="font-medium">{currentPage}</span> / {totalPages}
                </button>
              )}

              <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-2 py-1 bg-gray-700/50 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-400 text-xs transition-colors"
              >
                Next
              </button>

              <button
                onClick={() => onPageChange(totalPages)}
                disabled={currentPage === totalPages}
                className="p-1 bg-gray-700/50 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Last Page"
              >
                <ChevronsRight className="w-3 h-3 text-gray-400" />
              </button>
            </>
          )}
        </div>

        {/* Right: View controls and selection */}
        <div className="flex items-center gap-2 ml-auto">
          <ImageSizeSlider />

          <div className="border-l border-gray-600/50 h-4" />

          <button
            onClick={() => onViewModeChange(viewMode === 'grid' ? 'list' : 'grid')}
            className="p-1 bg-gray-700/50 hover:bg-gray-700 text-gray-400 rounded transition-colors"
            title={`Switch to ${viewMode === 'grid' ? 'list' : 'grid'} view`}
          >
            {viewMode === 'grid' ? <List className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}
          </button>

          {selectedCount > 0 && (
            <>
              <div className="border-l border-gray-600/50 h-4" />
              <span className="text-gray-400 text-xs">{selectedCount} selected</span>
              <button onClick={onClearSelection} className="text-blue-400 hover:text-blue-300 text-xs px-2 py-1 rounded hover:bg-blue-900/20 transition-colors">
                Clear
              </button>
              <button onClick={onDeleteSelected} className="text-red-500 hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-red-900/20 transition-colors">
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Footer;

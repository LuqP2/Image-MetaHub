import React, { useState, useEffect } from 'react';
import ImageSizeSlider from './ImageSizeSlider';
import { Grid3X3, List, ChevronLeft, ChevronRight } from 'lucide-react';

interface FooterProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  itemsPerPage: number | 'all';
  onItemsPerPageChange: (items: number | 'all') => void;
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

const Token: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title }) => (
  <span
    title={title}
    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-800/60 text-gray-300 border border-gray-700/50"
  >
    {children}
  </span>
);

const Footer: React.FC<FooterProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  itemsPerPage,
  onItemsPerPageChange,
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

  const formatNumber = (num: number): string => {
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}k`;
    }
    return num.toString();
  };

  const folderText = directoryCount === 1 ? 'folder' : 'folders';
  const showPageControls = totalPages > 1;
  const hasJob = enrichmentProgress && enrichmentProgress.total > 0;

  return (
    <footer className={`sticky bottom-0 px-3 flex items-center gap-3 bg-neutral-900/90 backdrop-blur-sm border-t border-neutral-800 transition-all duration-200 ${hasJob ? 'h-11 md:h-12' : 'h-10 md:h-11'}`}>
      <div className="min-w-0 flex-1 flex items-center gap-2 text-xs">
        {filteredCount !== undefined && totalCount !== undefined && (
          <Token title="Images in current view / Total images">
            <span className="font-semibold">{formatNumber(filteredCount)}</span>
            <span className="text-gray-500 mx-0.5">/</span>
            <span>{formatNumber(totalCount)}</span>
          </Token>
        )}
        {directoryCount !== undefined && directoryCount > 0 && (
          <Token title="Number of folders"><span>{directoryCount}</span> {folderText}</Token>
        )}
        {hasJob && (
          <div className="flex items-center gap-2 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              <span className="font-medium">{enrichmentProgress.processed}/{enrichmentProgress.total}</span>
            </div>
            <div className="w-16 h-1 bg-gray-700/50 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${(enrichmentProgress.processed / enrichmentProgress.total) * 100}%` }} />
            </div>
          </div>
        )}
      </div>
      <nav className="flex items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <label htmlFor="items-per-page" className="text-gray-500 hidden md:inline">Show:</label>
          <select id="items-per-page" value={itemsPerPage} onChange={handleItemsPerPageChange} className="bg-gray-800/50 border border-gray-700/50 rounded px-2 py-1 text-gray-300 hover:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors">
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={500}>500</option>
            <option value="all">All</option>
          </select>
        </div>
        {showPageControls && (
          <>
            <span className="text-gray-600">•</span>
            <div className="flex items-center gap-1">
              <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} className="p-1 hover:bg-gray-800 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Previous page">
                <ChevronLeft className="w-3.5 h-3.5 text-gray-400" />
              </button>
              {isEditingPage ? (
                <form onSubmit={handlePageInputSubmit}>
                  <input type="number" value={pageInput} onChange={(e) => setPageInput(e.target.value)} onBlur={() => setIsEditingPage(false)} autoFocus className="w-12 text-center bg-gray-800 border border-gray-700/50 rounded px-1 py-0.5 text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </form>
              ) : (
                <button onClick={() => setIsEditingPage(true)} className="px-2 py-0.5 text-gray-400 hover:text-gray-300 hover:bg-gray-800/50 rounded transition-colors" title="Click to edit page number">
                  <span className="font-medium">{currentPage}</span><span className="text-gray-600 mx-0.5">/</span><span>{totalPages}</span>
                </button>
              )}
              <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} className="p-1 hover:bg-gray-800 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Next page">
                <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          </>
        )}
      </nav>
      <div className="flex items-center gap-2">
        <ImageSizeSlider />
        <span className="text-gray-600">•</span>
        <button onClick={() => onViewModeChange(viewMode === 'grid' ? 'list' : 'grid')} className="p-1.5 hover:bg-gray-800 text-gray-400 hover:text-gray-300 rounded transition-colors" title={`Switch to ${viewMode === 'grid' ? 'list' : 'grid'} view`}>
          {viewMode === 'grid' ? <List className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}
        </button>
        {selectedCount > 0 && (
          <>
            <span className="text-gray-600">•</span>
            <div className="flex items-center gap-2 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/30">
              <span className="text-blue-400 text-xs font-medium">{selectedCount} selected</span>
              <button onClick={onClearSelection} className="text-blue-400 hover:text-blue-300 text-xs underline-offset-2 hover:underline transition-colors">Clear</button>
              <button onClick={onDeleteSelected} className="text-red-400 hover:text-red-300 text-xs underline-offset-2 hover:underline transition-colors">Delete</button>
            </div>
          </>
        )}
      </div>
    </footer>
  );
};

export default Footer;

import React, { useState, useEffect } from 'react';
import ImageSizeSlider from './ImageSizeSlider';
import { Grid3X3, List, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, GitCompare, ListChecks } from 'lucide-react';
import { A1111ProgressState } from '../hooks/useA1111Progress';
import { useImageStore } from '../store/useImageStore';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { IndexedImage } from '../types';
import ProBadge from './ProBadge';

interface FooterProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  itemsPerPage: number;
  onItemsPerPageChange: (items: number) => void;
  selectedCount: number;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  filteredCount?: number;
  totalCount?: number;
  directoryCount?: number;
  enrichmentProgress?: { processed: number; total: number } | null;
  a1111Progress?: A1111ProgressState | null;
  queueCount?: number;
  isQueueOpen?: boolean;
  onToggleQueue?: () => void;
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
  enrichmentProgress,
  a1111Progress,
  queueCount = 0,
  isQueueOpen = false,
  onToggleQueue
}) => {
  const { selectedImages, filteredImages, setComparisonImages, openComparisonModal } = useImageStore();
  const { canUseA1111, canUseComparison, showProModal } = useFeatureAccess();
  const [isEditingPage, setIsEditingPage] = useState(false);
  const [pageInput, setPageInput] = useState(currentPage.toString());

  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  const handleItemsPerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onItemsPerPageChange(parseInt(value, 10));
  };

  const folderText = directoryCount === 1 ? 'folder' : 'folders';
  const showPageControls = totalPages > 1;
  const hasEnrichmentJob = enrichmentProgress && enrichmentProgress.total > 0;
  const hasA1111Job = canUseA1111 && a1111Progress && a1111Progress.isGenerating; // Only show if feature is available
  const hasAnyJob = hasEnrichmentJob || hasA1111Job;

  return (
    <footer className={`sticky bottom-0 px-3 flex items-center gap-3 bg-neutral-900/90 backdrop-blur-sm border-t border-neutral-800 transition-all duration-200 ${hasAnyJob ? 'h-11 md:h-12' : 'h-10 md:h-11'}`}>
      <div className="min-w-0 flex-1 flex items-center gap-2 text-xs">
        {filteredCount !== undefined && totalCount !== undefined && (
          <Token title="Images in current view / Total images">
            <span className="font-semibold">{filteredCount.toLocaleString()}</span>
            <span className="text-gray-500 mx-0.5">/</span>
            <span>{totalCount.toLocaleString()}</span>
          </Token>
        )}
        {directoryCount !== undefined && directoryCount > 0 && (
          <Token title="Number of folders"><span>{directoryCount}</span> {' '}{folderText}</Token>
        )}
        {hasEnrichmentJob && (
          <div className="flex items-center gap-2 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs animate-fade-in">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              <span className="font-medium">{enrichmentProgress!.processed}/{enrichmentProgress!.total}</span>
            </div>
            <div className="w-16 h-1 bg-gray-700/50 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${(enrichmentProgress!.processed / enrichmentProgress!.total) * 100}%` }} />
            </div>
          </div>
        )}
        {hasA1111Job && (
          <div className="flex items-center gap-2 px-2 py-1 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-xs animate-fade-in">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="font-medium">
                {a1111Progress!.totalImages > 1
                  ? `${a1111Progress!.currentImage}/${a1111Progress!.totalImages}`
                  : `${Math.round(a1111Progress!.progress * 100)}%`
                }
              </span>
            </div>
            <div className="w-16 h-1 bg-gray-700/50 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 transition-all duration-300" style={{ width: `${a1111Progress!.progress * 100}%` }} />
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
          </select>
        </div>
        {showPageControls && (
          <>
            <span className="text-gray-600">•</span>
            <div className="flex items-center gap-1">
              <button onClick={() => onPageChange(1)} disabled={currentPage === 1} className="p-1 hover:bg-gray-800 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="First page">
                <ChevronsLeft className="w-3.5 h-3.5 text-gray-400" />
              </button>
              <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} className="p-1 hover:bg-gray-800 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Previous page">
                <ChevronLeft className="w-3.5 h-3.5 text-gray-400" />
              </button>
              {isEditingPage ? (
                <input
                  type="number"
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      let newPage = parseInt(pageInput, 10);
                      if (!isNaN(newPage)) {
                        newPage = Math.max(1, Math.min(newPage, totalPages));
                        onPageChange(newPage);
                      }
                      setIsEditingPage(false);
                    } else if (e.key === 'Escape') {
                      setIsEditingPage(false);
                    }
                  }}
                  onBlur={() => setIsEditingPage(false)}
                  autoFocus
                  min="1"
                  max={totalPages}
                  className="w-12 text-center bg-gray-800 border border-gray-700/50 rounded px-1 py-0.5 text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              ) : (
                <button
                  onClick={() => setIsEditingPage(true)}
                  className="px-2 py-0.5 text-gray-400 hover:text-gray-300 hover:bg-gray-800/50 rounded transition-colors"
                  title="Click to edit page number"
                >
                  <span className="font-medium">{currentPage}</span><span className="text-gray-600 mx-0.5">/</span><span>{totalPages}</span>
                </button>
              )}
              <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} className="p-1 hover:bg-gray-800 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Next page">
                <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
              </button>
              <button onClick={() => onPageChange(totalPages)} disabled={currentPage === totalPages} className="p-1 hover:bg-gray-800 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Last page">
                <ChevronsRight className="w-3.5 h-3.5 text-gray-400" />
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
        {onToggleQueue && (
          <button
            onClick={onToggleQueue}
            className={`relative p-1.5 rounded transition-colors ${
              isQueueOpen
                ? 'bg-blue-500/20 text-blue-300'
                : 'hover:bg-gray-800 text-gray-400 hover:text-gray-300'
            }`}
            title="Toggle Queue"
          >
            <ListChecks className="h-4 w-4" />
            {queueCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center">
                {queueCount}
              </span>
            )}
          </button>
        )}
        {selectedCount > 0 && (
          <>
            <span className="text-gray-600">•</span>
            <div className="flex items-center gap-2 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/30 animate-fade-in">
              <span className="text-blue-400 text-xs font-medium">{selectedCount} selected</span>
              <button onClick={onClearSelection} className="text-blue-400 hover:text-blue-300 text-xs underline-offset-2 hover:underline transition-colors">Clear</button>
              <button onClick={onDeleteSelected} className="text-red-400 hover:text-red-300 text-xs underline-offset-2 hover:underline transition-colors">Delete</button>
            </div>
          </>
        )}
        {selectedCount >= 2 && (
          <>
            <span className="text-gray-600">•</span>
            <button
              onClick={() => {
                if (!canUseComparison) {
                  showProModal('comparison');
                  return;
                }
                if (selectedCount !== 2) {
                  alert('Please select exactly 2 images to compare');
                  return;
                }
                const selected = Array.from(selectedImages)
                  .map(id => filteredImages.find(img => img.id === id))
                  .filter((img): img is IndexedImage => img !== undefined)
                  .slice(0, 2);

                setComparisonImages([selected[0], selected[1]]);
                openComparisonModal();
              }}
              disabled={canUseComparison && selectedCount !== 2}
              className="flex items-center gap-1.5 px-3 py-1 rounded
                         bg-purple-500/10 border border-purple-500/30
                         text-purple-400 text-xs font-medium
                         hover:bg-purple-500/20 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
              title={!canUseComparison ? "Comparison (Pro Feature)" : selectedCount === 2 ? "Compare 2 images" : "Select exactly 2 images"}
            >
              <GitCompare className="w-3 h-3" />
              <span className="hidden sm:inline">Compare {!canUseComparison && <ProBadge size="sm" />}</span>
            </button>
          </>
        )}
      </div>
    </footer>
  );
};

export default Footer;

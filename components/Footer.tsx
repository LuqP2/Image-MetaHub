import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import ImageSizeSlider from './ImageSizeSlider';
import { Grid3X3, List, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ListChecks, X } from 'lucide-react';
import { A1111ProgressState } from '../hooks/useA1111Progress';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { IndexedImage, IndexedImageTransferProgress } from '../types';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';
import { useThumbnail } from '../hooks/useThumbnail';

interface FooterProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  itemsPerPage: number;
  onItemsPerPageChange: (items: number) => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  customText?: string;
  filteredCount?: number;
  totalCount?: number;
  directoryCount?: number;
  enrichmentProgress?: { processed: number; total: number } | null;
  a1111Progress?: A1111ProgressState | null;
  transferProgress?: IndexedImageTransferProgress | null;
  queueCount?: number;
  isQueueOpen?: boolean;
  onToggleQueue?: () => void;
  windowItems?: Array<{
    id: string;
    title: string;
    image: IndexedImage;
    isActive: boolean;
    isMinimized: boolean;
  }>;
  onWindowSelect?: (id: string) => void;
  onWindowClose?: (id: string) => void;
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
  viewMode,
  onViewModeChange,
  customText,
  filteredCount,
  totalCount,
  directoryCount,
  enrichmentProgress,
  a1111Progress,
  transferProgress,
  queueCount = 0,
  isQueueOpen = false,
  onToggleQueue,
  windowItems = [],
  onWindowSelect,
  onWindowClose,
}) => {
  const { canUseA1111 } = useFeatureAccess();
  const [isEditingPage, setIsEditingPage] = useState(false);
  const [pageInput, setPageInput] = useState(currentPage.toString());
  const windowStripRef = useRef<HTMLDivElement | null>(null);
  const [hoveredWindowPreview, setHoveredWindowPreview] = useState<{
    id: string;
    anchorLeft: number;
  } | null>(null);

  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  const hoveredWindowItem = useMemo(() => {
    if (!hoveredWindowPreview) {
      return null;
    }

    return windowItems.find((item) => item.id === hoveredWindowPreview.id) ?? null;
  }, [hoveredWindowPreview, windowItems]);

  useThumbnail(hoveredWindowItem?.image ?? null);
  const hoveredThumbnail = useResolvedThumbnail(hoveredWindowItem?.image ?? null);

  const handleWindowHover = useCallback((event: React.MouseEvent<HTMLDivElement>, id: string) => {
    const stripRect = windowStripRef.current?.getBoundingClientRect();
    const targetRect = event.currentTarget.getBoundingClientRect();

    if (!stripRect) {
      return;
    }

    setHoveredWindowPreview({
      id,
      anchorLeft: targetRect.left - stripRect.left + (targetRect.width / 2),
    });
  }, []);

  const previewWidth = 176;
  const previewLeft = useMemo(() => {
    if (!hoveredWindowPreview || !windowStripRef.current) {
      return null;
    }

    const stripWidth = windowStripRef.current.clientWidth;
    const minLeft = (previewWidth / 2) + 8;
    const maxLeft = stripWidth - (previewWidth / 2) - 8;

    if (maxLeft <= minLeft) {
      return stripWidth / 2;
    }

    return Math.min(Math.max(hoveredWindowPreview.anchorLeft, minLeft), maxLeft);
  }, [hoveredWindowPreview]);

  const handleItemsPerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onItemsPerPageChange(parseInt(value, 10));
  };

  const folderText = directoryCount === 1 ? 'folder' : 'folders';
  const showPageControls = totalPages > 1;
  const hasEnrichmentJob = enrichmentProgress && enrichmentProgress.total > 0;
  const hasA1111Job = canUseA1111 && a1111Progress && a1111Progress.isGenerating; // Only show if feature is available
  const hasTransferJob = transferProgress && transferProgress.total > 0 && transferProgress.stage !== 'done';
  const hasAnyJob = hasEnrichmentJob || hasA1111Job || hasTransferJob;

  return (
    <footer className="sticky bottom-0 z-[55] bg-gray-900/90 backdrop-blur-md border-t border-gray-800/60 transition-all duration-300 shadow-footer-up">
      {windowItems.length > 0 && (
        <div className="relative border-b border-gray-800/60 px-4 py-2">
          {hoveredWindowItem?.isMinimized && previewLeft !== null && (
            <div
              className="pointer-events-none absolute bottom-full z-20 mb-2 -translate-x-1/2 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 duration-150"
              style={{ left: `${previewLeft}px`, width: `${previewWidth}px` }}
            >
              <div className="overflow-hidden rounded-xl border border-gray-700/80 bg-gray-950/95 shadow-2xl shadow-black/50 backdrop-blur-sm">
                <div className="aspect-square bg-gradient-to-br from-gray-900 via-gray-800 to-gray-950">
                  {hoveredThumbnail?.thumbnailUrl ? (
                    <img
                      src={hoveredThumbnail.thumbnailUrl}
                      alt={hoveredWindowItem.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-4 text-center text-xs text-gray-500">
                      {hoveredWindowItem.title}
                    </div>
                  )}
                </div>
                <div className="border-t border-gray-800 px-3 py-2">
                  <div className="truncate text-xs font-medium text-gray-200">
                    {hoveredWindowItem.title}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div
            ref={windowStripRef}
            className="flex items-center gap-2 overflow-x-auto"
            onMouseLeave={() => setHoveredWindowPreview(null)}
          >
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">
              Windows
            </span>
            {windowItems.map((windowItem) => (
              <div
                key={windowItem.id}
                data-image-modal-window-id={windowItem.id}
                onMouseEnter={(event) => handleWindowHover(event, windowItem.id)}
                onAuxClick={(event) => {
                  if (event.button !== 1) {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  onWindowClose?.(windowItem.id);
                }}
                className={`flex max-w-[260px] shrink-0 items-stretch overflow-hidden rounded-lg border transition-colors ${
                  windowItem.isActive
                    ? 'border-blue-500/50 bg-blue-500/15 text-blue-100'
                    : windowItem.isMinimized
                      ? 'border-gray-700 bg-gray-800/70 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                      : 'border-gray-700 bg-gray-800/90 text-gray-300 hover:border-gray-600 hover:text-white'
                }`}
              >
                <button
                  onClick={() => onWindowSelect?.(windowItem.id)}
                  className="min-w-0 flex-1 truncate px-3 py-1.5 text-left text-xs font-medium"
                  title={windowItem.title}
                >
                  {windowItem.isMinimized ? `[_] ${windowItem.title}` : windowItem.title}
                </button>
                <button
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onWindowClose?.(windowItem.id);
                  }}
                  className={`border-l px-2 text-gray-400 transition-colors hover:text-white ${
                    windowItem.isActive ? 'border-blue-500/30 hover:bg-blue-500/20' : 'border-gray-700/80 hover:bg-gray-700/80'
                  }`}
                  aria-label={`Close ${windowItem.title}`}
                  title="Close window"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={`px-6 flex items-center gap-4 ${hasAnyJob ? 'h-14 md:h-16' : 'h-12 md:h-14'}`}>
      <div className="min-w-0 flex-1 flex items-center gap-3 text-xs">
        {customText ? (
           <Token>
             <span className="font-semibold text-gray-200">{customText}</span>
           </Token>
        ) : (
          <>
            {filteredCount !== undefined && totalCount !== undefined && (
              <Token title="Images in current view / Total images">
                <span className="font-semibold text-gray-200">{filteredCount.toLocaleString()}</span>
                <span className="text-gray-600 mx-1">/</span>
                <span className="text-gray-400">{totalCount.toLocaleString()}</span>
              </Token>
            )}
            {directoryCount !== undefined && directoryCount > 0 && (
              <Token title="Number of folders">
                <span className="font-medium text-gray-200">{directoryCount}</span> <span className="text-gray-400 ml-1">{folderText}</span>
              </Token>
            )}
          </>
        )}
        {hasEnrichmentJob && (
          <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs shadow-sm animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              <span className="font-medium">{enrichmentProgress!.processed}/{enrichmentProgress!.total}</span>
            </div>
            <div className="w-20 h-1.5 bg-gray-700/50 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all duration-500 ease-out" style={{ width: `${(enrichmentProgress!.processed / enrichmentProgress!.total) * 100}%` }} />
            </div>
          </div>
        )}
        {hasA1111Job && (
          <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs shadow-sm animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="font-medium">
                {a1111Progress!.totalImages > 1
                  ? `${a1111Progress!.currentImage}/${a1111Progress!.totalImages}`
                  : `${Math.round(a1111Progress!.progress * 100)}%`
                }
              </span>
            </div>
            <div className="w-20 h-1.5 bg-gray-700/50 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 transition-all duration-300 ease-out" style={{ width: `${a1111Progress!.progress * 100}%` }} />
            </div>
          </div>
        )}
        {hasTransferJob && (
          <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs shadow-sm animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-300 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400"></span>
              </span>
              <span className="font-medium">
                {transferProgress!.processed}/{transferProgress!.total}
              </span>
            </div>
            <div className="w-24 h-1.5 bg-gray-700/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-all duration-300 ease-out"
                style={{ width: `${Math.max(0, Math.min(100, (transferProgress!.processed / transferProgress!.total) * 100))}%` }}
              />
            </div>
            <span className="max-w-[220px] truncate text-amber-100/90">
              {transferProgress!.statusText || (transferProgress!.mode === 'move' ? 'Moving files...' : 'Copying files...')}
            </span>
          </div>
        )}
      </div>
      <nav className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-2">
          <label htmlFor="items-per-page" className="text-gray-500 hidden md:inline font-medium">Show:</label>
          <select id="items-per-page" value={itemsPerPage} onChange={handleItemsPerPageChange} className="bg-gray-800/80 border border-gray-700/60 rounded-lg px-2.5 py-1.5 text-gray-200 hover:bg-gray-700 hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all cursor-pointer">
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={-1}>All</option>
          </select>
        </div>
        {showPageControls && (
          <>
            <div className="w-px h-4 bg-gray-700/50"></div>
            <div className="flex items-center gap-1 bg-gray-800/40 p-1 rounded-lg border border-gray-700/30">
              <button onClick={() => onPageChange(1)} disabled={currentPage === 1} className="p-1.5 hover:bg-gray-700 rounded-md disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:text-white text-gray-400" title="First page">
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} className="p-1.5 hover:bg-gray-700 rounded-md disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:text-white text-gray-400" title="Previous page">
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              <div className="px-1 min-w-[80px] text-center">
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
                    className="w-16 text-center bg-gray-900 border border-blue-500/50 rounded px-1 py-0.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-xs font-bold"
                  />
                ) : (
                  <button
                    onClick={() => setIsEditingPage(true)}
                    className="px-2 py-0.5 text-gray-300 hover:text-white hover:bg-gray-700/50 rounded transition-colors text-xs font-medium"
                    title="Click to edit page number"
                  >
                    <span className="text-white font-bold">{currentPage}</span> <span className="text-gray-600">of</span> <span className="text-gray-400">{totalPages}</span>
                  </button>
                )}
              </div>

              <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} className="p-1.5 hover:bg-gray-700 rounded-md disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:text-white text-gray-400" title="Next page">
                <ChevronRight className="w-4 h-4" />
              </button>
              <button onClick={() => onPageChange(totalPages)} disabled={currentPage === totalPages} className="p-1.5 hover:bg-gray-700 rounded-md disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:text-white text-gray-400" title="Last page">
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </nav>
      <div className="flex items-center gap-3 border-l border-gray-700/50 pl-3">
        <ImageSizeSlider />
        <button onClick={() => onViewModeChange(viewMode === 'grid' ? 'list' : 'grid')} className="p-2 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-all hover:shadow-md" title={`Switch to ${viewMode === 'grid' ? 'list' : 'grid'} view`}>
          {viewMode === 'grid' ? <List className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}
        </button>
        {onToggleQueue && (
          <button
            onClick={onToggleQueue}
            className={`relative p-2 rounded-lg transition-all border ${
              isQueueOpen
                ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                : 'hover:bg-gray-800 text-gray-400 hover:text-white border-transparent hover:border-gray-700'
            }`}
            title="Toggle Queue"
          >
            <ListChecks className="h-4 w-4" />
            {queueCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                {queueCount}
              </span>
            )}
          </button>
        )}
      </div>
      </div>
    </footer>
  );
};

export default Footer;

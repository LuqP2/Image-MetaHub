import React from 'react';
import { Pause, Play, X } from 'lucide-react';

interface StatusBarProps {
  filteredCount: number;
  totalCount: number;
  directoryCount: number;
  indexingState: 'idle' | 'indexing' | 'paused' | 'completed';
  progress: { current: number; total: number } | null;
  enrichmentProgress?: { processed: number; total: number } | null;
  onPauseIndexing: () => void;
  onResumeIndexing: () => void;
  onCancelIndexing: () => void;
}

const StatusBar: React.FC<StatusBarProps> = ({
  filteredCount,
  totalCount,
  directoryCount,
  indexingState = 'idle',
  progress,
  enrichmentProgress = null,
  onPauseIndexing,
  onResumeIndexing,
  onCancelIndexing
}) => {
  const folderText = directoryCount === 1 ? 'folder' : 'folders';
  const shouldShowEnrichment = !!enrichmentProgress && enrichmentProgress.total > 0;
  const enrichmentPercentage = shouldShowEnrichment && enrichmentProgress.total > 0
    ? Math.min(100, Math.round((enrichmentProgress.processed / enrichmentProgress.total) * 100))
    : 0;
  const enrichmentComplete = shouldShowEnrichment && enrichmentProgress.processed >= enrichmentProgress.total;

  return (
    <div className="mb-4 px-4 py-2 bg-gray-800/50 rounded-lg border border-gray-700 text-gray-300 flex justify-between items-center">
      <div className="flex flex-col gap-1">
        <span>
        {indexingState === 'indexing' ? (
          progress ? (
            <>
              🔄 <span className="font-bold text-yellow-400">Processing:</span> {progress.current} of {progress.total} files
            </>
          ) : (
            <>
              🔄 <span className="font-bold text-yellow-400">Starting indexing...</span>
            </>
          )
        ) : indexingState === 'paused' ? (
          progress ? (
            <>
              ⏸️ <span className="font-bold text-orange-400">Indexing Paused:</span> {progress.current} of {progress.total} files
            </>
          ) : null
        ) : indexingState === 'completed' ? (
          progress ? (
            <>
              ✅ <span className="font-bold text-green-400">Indexing Complete:</span> {progress.total} files
            </>
          ) : null
        ) : (
          <>
            Displaying <span className="font-semibold text-gray-100">{filteredCount}</span> of <span className="font-semibold text-gray-100">{totalCount}</span> images across <span className="font-semibold text-gray-100">{directoryCount}</span> {folderText}
          </>
        )}
        </span>

        {shouldShowEnrichment && (
          <span className="text-xs text-blue-300">
            ✨ <span className="font-semibold">Phase B enrichment:</span> {enrichmentComplete ? 'complete' : `${enrichmentPercentage}%`} (
            {enrichmentProgress.processed}
            {' / '}
            {enrichmentProgress.total})
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {indexingState === 'indexing' && (
          <>
            <button
              onClick={onPauseIndexing}
              className="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 text-white text-sm rounded flex items-center gap-1 transition-colors"
              title="Pause indexing"
            >
              <Pause className="w-4 h-4" />
              Pause
            </button>
            <button
              onClick={onCancelIndexing}
              className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-sm rounded flex items-center gap-1 transition-colors"
              title="Cancel indexing"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          </>
        )}
        {indexingState === 'paused' && (
          <>
            <button
              onClick={onResumeIndexing}
              className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-sm rounded flex items-center gap-1 transition-colors"
              title="Resume indexing"
            >
              <Play className="w-4 h-4" />
              Resume
            </button>
            <button
              onClick={onCancelIndexing}
              className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-sm rounded flex items-center gap-1 transition-colors"
              title="Cancel indexing"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          </>
        )}
  <span className="text-xs text-gray-500">v0.9.4</span>
      </div>
    </div>
  );
};

export default StatusBar;
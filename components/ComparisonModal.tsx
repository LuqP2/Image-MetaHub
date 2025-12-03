import React, { useState, useEffect, FC } from 'react';
import { X, Repeat } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { ComparisonModalProps, ZoomState } from '../types';
import ComparisonPane from './ComparisonPane';
import ComparisonMetadataPanel from './ComparisonMetadataPanel';

const ComparisonModal: FC<ComparisonModalProps> = ({ isOpen, onClose }) => {
  const { comparisonImages, directories, swapComparisonImages, clearComparison } = useImageStore();

  // State
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [sharedZoom, setSharedZoom] = useState<ZoomState>({ zoom: 1, x: 0, y: 0 });
  const [leftExpanded, setLeftExpanded] = useState(false);
  const [rightExpanded, setRightExpanded] = useState(false);

  // Handlers
  const handleZoomChange = (zoom: number, x: number, y: number) => {
    if (syncEnabled) {
      setSharedZoom({ zoom, x, y });
    }
  };

  const handleSwap = () => {
    swapComparisonImages();
  };

  const handleClose = () => {
    clearComparison();
    onClose();
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          handleClose();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          setSyncEnabled(prev => {
            const newValue = !prev;
            // Show notification
            const notification = document.createElement('div');
            notification.className = 'fixed top-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
            notification.textContent = `Sync ${newValue ? 'enabled' : 'disabled'}`;
            document.body.appendChild(notification);
            setTimeout(() => {
              if (document.body.contains(notification)) {
                document.body.removeChild(notification);
              }
            }, 2000);
            return newValue;
          });
          break;
        case ' ':
          e.preventDefault();
          handleSwap();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, syncEnabled]);

  if (!isOpen || !comparisonImages[0] || !comparisonImages[1]) return null;

  // Get directory paths for each image
  const leftDirectory = directories.find(d => d.id === comparisonImages[0]?.directoryId);
  const rightDirectory = directories.find(d => d.id === comparisonImages[1]?.directoryId);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-800/90 backdrop-blur-sm border-b border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-gray-200">Comparison View</h2>
          <button
            onClick={handleSwap}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                     bg-gray-700/50 hover:bg-gray-700
                     text-gray-300 hover:text-white
                     border border-gray-600/50
                     text-sm font-medium transition-colors"
            title="Swap images (Space)"
          >
            <Repeat className="w-4 h-4" />
            <span className="hidden sm:inline">Swap</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setSyncEnabled(!syncEnabled)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border
                       ${syncEnabled
                         ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-500'
                         : 'bg-gray-700/50 hover:bg-gray-700 text-gray-300 border-gray-600/50'
                       }`}
            title="Toggle zoom synchronization (S)"
          >
            Sync: {syncEnabled ? 'ON' : 'OFF'}
          </button>

          <button
            onClick={handleClose}
            className="p-1.5 hover:bg-gray-700/50 text-gray-400 hover:text-white rounded-lg transition-colors"
            title="Close (Escape)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Split Panes */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        <ComparisonPane
          image={comparisonImages[0]}
          directoryPath={leftDirectory?.path || ''}
          position="left"
          syncEnabled={syncEnabled}
          externalZoom={syncEnabled ? sharedZoom : undefined}
          onZoomChange={handleZoomChange}
        />

        <ComparisonPane
          image={comparisonImages[1]}
          directoryPath={rightDirectory?.path || ''}
          position="right"
          syncEnabled={syncEnabled}
          externalZoom={syncEnabled ? sharedZoom : undefined}
          onZoomChange={handleZoomChange}
        />
      </div>

      {/* Metadata Panels */}
      <div className="bg-gray-900/50 border-t border-gray-700 p-4 overflow-y-auto max-h-[40vh]">
        <div className="flex flex-col md:flex-row gap-4 max-w-7xl mx-auto">
          <ComparisonMetadataPanel
            image={comparisonImages[0]}
            isExpanded={leftExpanded}
            onToggleExpanded={() => setLeftExpanded(!leftExpanded)}
          />

          <ComparisonMetadataPanel
            image={comparisonImages[1]}
            isExpanded={rightExpanded}
            onToggleExpanded={() => setRightExpanded(!rightExpanded)}
          />
        </div>
      </div>

      {/* Keyboard Shortcuts Help (subtle hint) */}
      <div className="absolute bottom-4 left-4 text-xs text-gray-500 hidden md:block">
        <p>
          <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded">Esc</kbd> Close •{' '}
          <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded">S</kbd> Toggle Sync •{' '}
          <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded">Space</kbd> Swap
        </p>
      </div>
    </div>
  );
};

export default ComparisonModal;

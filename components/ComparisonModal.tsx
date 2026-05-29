import React, { useState, useEffect, FC, useMemo } from 'react';
import { X, Repeat, ArrowLeft } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { BaseMetadata, ComparisonAdvancedSettings, ComparisonLayoutMode, ComparisonModalProps, IndexedImage, ZoomState, ComparisonViewMode } from '../types';
import ComparisonPane from './ComparisonPane';
import ComparisonMetadataPanel from './ComparisonMetadataPanel';
import ComparisonOverlayView from './ComparisonOverlayView';
import { getFieldLabel, getMetadataDifferences } from '../utils/metadataComparison';
import { VisualComparisonMetrics } from '../utils/visualComparison';

export const getComparisonMetadataReference = (
  comparisonImages: IndexedImage[],
  index: number,
  metadataReference: BaseMetadata | null,
): BaseMetadata | null => {
  if (comparisonImages.length === 2) {
    const counterpartIndex = index === 0 ? 1 : 0;
    return comparisonImages[counterpartIndex]?.metadata?.normalizedMetadata ?? null;
  }

  return index === 0 ? null : metadataReference;
};

const ComparisonModal: FC<ComparisonModalProps> = ({ isOpen, onClose }) => {
  const comparisonImages = useImageStore((state) => state.comparisonImages);
  const directories = useImageStore((state) => state.directories);
  const swapComparisonImages = useImageStore((state) => state.swapComparisonImages);
  const clearComparison = useImageStore((state) => state.clearComparison);
  const removeImageFromComparison = useImageStore((state) => state.removeImageFromComparison);

  const [syncEnabled, setSyncEnabled] = useState(true);
  const [sharedZoom, setSharedZoom] = useState<ZoomState>({ zoom: 1, x: 0, y: 0 });
  const [expandedMetadataIndexes, setExpandedMetadataIndexes] = useState<Set<number>>(() => new Set());
  const [viewMode, setViewMode] = useState<ComparisonViewMode>('side-by-side');
  const [layoutMode, setLayoutMode] = useState<ComparisonLayoutMode>('strip');
  const [metadataViewMode, setMetadataViewMode] = useState<'standard' | 'diff'>('standard');
  const [activeMetadataIndex, setActiveMetadataIndex] = useState<number | null>(null);
  const [visualMetrics, setVisualMetrics] = useState<VisualComparisonMetrics | null>(null);
  const [highlightDeltaRegion, setHighlightDeltaRegion] = useState(false);
  const [advancedSettings, setAdvancedSettings] = useState<ComparisonAdvancedSettings>({
    threshold: 18,
    opacity: 65,
    baseMode: 'left',
    flickerSpeedMs: 700,
    loupeSize: 220,
    loupeZoom: 2,
    showLabels: true,
  });

  const imageCount = comparisonImages.length;
  const supportsOverlayModes = imageCount === 2;
  const advancedModes = useMemo(
    () => new Set<ComparisonViewMode>(['difference-map', 'flicker', 'loupe', 'edge-difference']),
    []
  );
  const isAdvancedMode = advancedModes.has(viewMode);
  const directoryPathById = useMemo(
    () => new Map(directories.map((directory) => [directory.id, directory.path])),
    [directories]
  );

  const updateSharedZoom = (zoom: number, x: number, y: number) => {
    setSharedZoom({ zoom, x, y });
  };

  const handleZoomChange = (zoom: number, x: number, y: number) => {
    if (syncEnabled) {
      updateSharedZoom(zoom, x, y);
    }
  };

  const handleSwap = () => {
    if (imageCount === 2) {
      swapComparisonImages();
    }
  };

  const handleClose = () => {
    clearComparison();
    onClose();
  };

  const handleRemoveImage = (index: number) => {
    removeImageFromComparison(index);
    if (imageCount <= 2) {
      onClose();
    }
  };

  const toggleMetadataPanel = (index: number) => {
    setExpandedMetadataIndexes((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  useEffect(() => {
    setExpandedMetadataIndexes(new Set());
    setActiveMetadataIndex(null);
    setVisualMetrics(null);
    setHighlightDeltaRegion(false);
  }, [comparisonImages]);

  useEffect(() => {
    if (!supportsOverlayModes && viewMode !== 'side-by-side') {
      setViewMode('side-by-side');
    }
  }, [supportsOverlayModes, viewMode]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
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
          if (viewMode !== 'side-by-side') return;
          e.preventDefault();
          setSyncEnabled((prev) => !prev);
          break;
        case ' ':
          if (imageCount !== 2) return;
          e.preventDefault();
          handleSwap();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageCount, isOpen, viewMode]);

  if (!isOpen || imageCount < 2) return null;

  const viewModes: { id: ComparisonViewMode; label: string; hint: string; disabled?: boolean }[] = [
    { id: 'side-by-side', label: imageCount > 2 ? 'Compare' : 'Side-by-Side', hint: imageCount > 2 ? 'Compare all selected images together' : 'Two panes with optional synced zoom' },
    { id: 'slider', label: 'Slider', hint: 'Drag the divider to reveal each image', disabled: !supportsOverlayModes },
    { id: 'hover', label: 'Hover', hint: 'Hover to toggle between the images', disabled: !supportsOverlayModes },
    { id: 'difference-map', label: 'Diff Map', hint: 'Highlight changed pixels as a heatmap', disabled: !supportsOverlayModes },
    { id: 'flicker', label: 'Flicker', hint: 'Alternate images in the same viewport', disabled: !supportsOverlayModes },
    { id: 'loupe', label: 'Loupe', hint: 'Inspect Image A, diff, and Image B under the cursor', disabled: !supportsOverlayModes },
    { id: 'edge-difference', label: 'Edges', hint: 'Compare structural outlines and silhouettes', disabled: !supportsOverlayModes },
  ];
  const isSideBySide = viewMode === 'side-by-side';
  const metadataReference = comparisonImages[0]?.metadata?.normalizedMetadata ?? null;
  const leftMetadata = comparisonImages[0]?.metadata?.normalizedMetadata ?? null;
  const rightMetadata = comparisonImages[1]?.metadata?.normalizedMetadata ?? null;
  const metadataDifferences = useMemo(() => {
    if (!leftMetadata || !rightMetadata) return [];
    const priority = ['prompt', 'negativePrompt', 'seed', 'model', 'models', 'loras', 'cfg_scale', 'steps', 'sampler', 'scheduler', 'width', 'height'];
    const differences = Array.from(getMetadataDifferences(leftMetadata, rightMetadata));
    return differences.sort((left, right) => {
      const leftIndex = priority.indexOf(left);
      const rightIndex = priority.indexOf(right);
      const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
      const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
      return normalizedLeft - normalizedRight || left.localeCompare(right);
    });
  }, [leftMetadata, rightMetadata]);
  const updateAdvancedSettings = (patch: Partial<ComparisonAdvancedSettings>) => {
    setAdvancedSettings((current) => ({ ...current, ...patch }));
  };

  return (
    <div className="fixed inset-0 z-[140] bg-black/85 backdrop-blur-sm flex flex-col">
      <div className="sticky top-0 z-10 bg-gray-800/90 backdrop-blur-sm border-b border-gray-700 px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-200">Comparison View</h2>
            <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-xs font-medium text-purple-200">
              {imageCount} image{imageCount === 1 ? '' : 's'}
            </span>
            <button
              onClick={handleSwap}
              disabled={imageCount !== 2}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700/50 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-600/50 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={imageCount === 2 ? 'Swap images (Space)' : 'Swap is only available when comparing 2 images'}
            >
              <Repeat className="w-4 h-4" />
              <span className="hidden sm:inline">Swap</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setSyncEnabled(!syncEnabled)}
              disabled={!isSideBySide}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                syncEnabled
                  ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-500'
                  : 'bg-gray-700/50 hover:bg-gray-700 text-gray-300 border-gray-600/50'
              } ${!isSideBySide ? 'opacity-60 cursor-not-allowed' : ''}`}
              title={isSideBySide ? 'Toggle zoom synchronization (S)' : 'Sync is available in compare mode'}
            >
              Sync: {syncEnabled ? 'ON' : 'OFF'}
            </button>

            <button
              onClick={handleClose}
              className="p-1.5 hover:bg-gray-700/50 text-gray-400 hover:text-white rounded-lg transition-colors"
              title="Close (Escape)"
              aria-label="Close comparison"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {comparisonImages.map((image, index) => (
            <div key={image.id} className="inline-flex max-w-full items-center gap-2 rounded-full border border-gray-700 bg-gray-900/70 px-3 py-1 text-xs text-gray-200">
              <span className="text-gray-500">#{index + 1}</span>
              <span className="truncate max-w-[220px]" title={image.name}>{image.name}</span>
              <button
                onClick={() => handleRemoveImage(index)}
                className="rounded-full p-0.5 text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
                title={`Remove ${image.name} from comparison`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.12em] text-gray-400">Mode</span>
              <div className="inline-flex bg-gray-900/60 border border-gray-700/70 rounded-lg overflow-hidden">
                {viewModes.map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => !mode.disabled && setViewMode(mode.id)}
                    disabled={mode.disabled}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors border-r border-gray-700/40 last:border-r-0 ${
                      viewMode === mode.id
                        ? 'bg-blue-600 text-white border-blue-500/60'
                        : 'text-gray-300 hover:text-white hover:bg-gray-700/60'
                    } ${mode.disabled ? 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-gray-300' : ''}`}
                    title={mode.hint}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {imageCount > 2 && isSideBySide && (
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-[0.12em] text-gray-400">Layout</span>
                <div className="inline-flex bg-gray-900/60 border border-gray-700/70 rounded-lg overflow-hidden">
                  {(['strip', 'grid'] as ComparisonLayoutMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setLayoutMode(mode)}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors border-r border-gray-700/40 last:border-r-0 ${
                        layoutMode === mode
                          ? 'bg-blue-600 text-white border-blue-500/60'
                          : 'text-gray-300 hover:text-white hover:bg-gray-700/60'
                      }`}
                    >
                      {mode === 'strip' ? 'Side Strip' : '2x2 Grid'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700/50 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-600/50 text-sm font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Grid</span>
          </button>
        </div>

        {isAdvancedMode && supportsOverlayModes && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-700/60 bg-gray-950/45 px-3 py-2">
            {(viewMode === 'difference-map' || viewMode === 'edge-difference' || viewMode === 'loupe') && (
              <>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  Sensitivity
                  <input
                    type="range"
                    min={0}
                    max={80}
                    value={advancedSettings.threshold}
                    onChange={(event) => updateAdvancedSettings({ threshold: Number(event.target.value) })}
                    className="w-28 accent-blue-500"
                  />
                  <span className="w-6 text-right text-gray-500">{advancedSettings.threshold}</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  Opacity
                  <input
                    type="range"
                    min={20}
                    max={100}
                    value={advancedSettings.opacity}
                    onChange={(event) => updateAdvancedSettings({ opacity: Number(event.target.value) })}
                    className="w-24 accent-blue-500"
                  />
                  <span className="w-8 text-right text-gray-500">{advancedSettings.opacity}%</span>
                </label>
                {viewMode !== 'loupe' && (
                  <select
                    value={advancedSettings.baseMode}
                    onChange={(event) => updateAdvancedSettings({ baseMode: event.target.value as ComparisonAdvancedSettings['baseMode'] })}
                    className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
                    title="Choose the base image below the visual difference layer"
                  >
                    <option value="left">Image A base</option>
                    <option value="right">Image B base</option>
                    <option value="diff">Diff only</option>
                  </select>
                )}
              </>
            )}

            {viewMode === 'flicker' && (
              <>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  Speed
                  <input
                    type="range"
                    min={150}
                    max={1500}
                    step={50}
                    value={advancedSettings.flickerSpeedMs}
                    onChange={(event) => updateAdvancedSettings({ flickerSpeedMs: Number(event.target.value) })}
                    className="w-32 accent-blue-500"
                  />
                  <span className="w-12 text-right text-gray-500">{advancedSettings.flickerSpeedMs}ms</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={advancedSettings.showLabels}
                    onChange={(event) => updateAdvancedSettings({ showLabels: event.target.checked })}
                    className="accent-blue-500"
                  />
                  Labels
                </label>
              </>
            )}

            {viewMode === 'loupe' && (
              <>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  Size
                  <input
                    type="range"
                    min={160}
                    max={340}
                    step={10}
                    value={advancedSettings.loupeSize}
                    onChange={(event) => updateAdvancedSettings({ loupeSize: Number(event.target.value) })}
                    className="w-24 accent-blue-500"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  Zoom
                  <input
                    type="range"
                    min={1.4}
                    max={3.5}
                    step={0.1}
                    value={advancedSettings.loupeZoom}
                    onChange={(event) => updateAdvancedSettings({ loupeZoom: Number(event.target.value) })}
                    className="w-24 accent-blue-500"
                  />
                  <span className="w-8 text-right text-gray-500">{advancedSettings.loupeZoom.toFixed(1)}x</span>
                </label>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {supportsOverlayModes && !isSideBySide ? (
          <ComparisonOverlayView
            leftImage={comparisonImages[0]}
            rightImage={comparisonImages[1]}
            leftDirectory={directoryPathById.get(comparisonImages[0].directoryId) || ''}
            rightDirectory={directoryPathById.get(comparisonImages[1].directoryId) || ''}
            mode={viewMode as Exclude<ComparisonViewMode, 'side-by-side'>}
            sharedZoom={sharedZoom}
            onZoomChange={updateSharedZoom}
            onActiveImageChange={setActiveMetadataIndex}
            advancedSettings={advancedSettings}
            onVisualAnalysisChange={setVisualMetrics}
            highlightedRegion={highlightDeltaRegion ? visualMetrics?.strongestRegion : null}
          />
        ) : (
          <div className="h-full overflow-auto bg-gray-950 p-2">
            <div
              className={`grid h-full min-h-[60vh] gap-2 ${layoutMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 auto-rows-fr' : ''}`}
              style={
                layoutMode === 'strip'
                  ? {
                      gridTemplateColumns: `repeat(${imageCount}, minmax(320px, 1fr))`,
                      gridAutoRows: 'minmax(0, 1fr)',
                    }
                  : undefined
              }
            >
              {comparisonImages.map((image, index) => {
                const isOddLastGridItem = layoutMode === 'grid' && imageCount % 2 === 1 && index === imageCount - 1;

                return (
                  <ComparisonPane
                    key={image.id}
                    image={image}
                    directoryPath={directoryPathById.get(image.directoryId) || ''}
                  syncEnabled={syncEnabled}
                  externalZoom={syncEnabled ? sharedZoom : undefined}
                  onZoomChange={handleZoomChange}
                  onHoverChange={(isHovered) =>
                    setActiveMetadataIndex((current) => (isHovered ? index : current === index ? null : current))
                  }
                  className={`h-full rounded-xl border border-gray-800 overflow-hidden ${isOddLastGridItem ? 'md:col-span-2' : ''}`}
                  imageLabel={`Image ${index + 1}`}
                />
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="bg-gray-900/50 border-t border-gray-700 p-4 overflow-y-auto max-h-[40vh]">
        {supportsOverlayModes && visualMetrics && (
          <div className="mx-auto mb-4 grid max-w-7xl grid-cols-1 gap-3 md:grid-cols-[1.1fr_1fr]">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-100">Visual Delta</h3>
                <button
                  type="button"
                  onMouseEnter={() => setHighlightDeltaRegion(true)}
                  onMouseLeave={() => setHighlightDeltaRegion(false)}
                  onFocus={() => setHighlightDeltaRegion(true)}
                  onBlur={() => setHighlightDeltaRegion(false)}
                  className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs text-amber-100 hover:bg-amber-400/20"
                  disabled={!visualMetrics.strongestRegion}
                  title="Highlight the strongest visual-change region"
                >
                  Strongest region
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded border border-gray-700 bg-gray-950/50 p-2">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Changed</div>
                  <div className="mt-1 font-semibold text-gray-100">{visualMetrics.changedPercent.toFixed(1)}%</div>
                </div>
                <div className="rounded border border-gray-700 bg-gray-950/50 p-2">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Avg Delta</div>
                  <div className="mt-1 font-semibold text-gray-100">{visualMetrics.averageDelta.toFixed(1)}</div>
                </div>
                <div className="rounded border border-gray-700 bg-gray-950/50 p-2">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Canvas</div>
                  <div className="mt-1 font-semibold text-gray-100">{visualMetrics.width}x{visualMetrics.height}</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-cyan-100">Metadata Delta</h3>
              {metadataDifferences.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {metadataDifferences.slice(0, 12).map((field) => (
                    <span key={field} className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-xs text-cyan-100">
                      {getFieldLabel(field)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No normalized metadata differences detected.</p>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-between items-center gap-3 mb-4 max-w-7xl mx-auto">
          <div>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Metadata</h3>
            {metadataViewMode === 'diff' && imageCount > 2 && (
              <p className="mt-1 text-xs text-gray-500">Diff mode highlights differences against Image 1 as the reference.</p>
            )}
          </div>

          <div className="inline-flex bg-gray-900/60 border border-gray-700/70 rounded-lg overflow-hidden">
            <button
              onClick={() => setMetadataViewMode('standard')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors border-r border-gray-700/40 ${
                metadataViewMode === 'standard'
                  ? 'bg-blue-600 text-white border-blue-500/60'
                  : 'text-gray-300 hover:text-white hover:bg-gray-700/60'
              }`}
              title="Show all metadata in standard format"
            >
              Standard View
            </button>
            <button
              onClick={() => setMetadataViewMode('diff')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                metadataViewMode === 'diff'
                  ? 'bg-blue-600 text-white border-blue-500/60'
                  : 'text-gray-300 hover:text-white hover:bg-gray-700/60'
              }`}
              title="Highlight differences between metadata"
            >
              Diff View
            </button>
          </div>
        </div>

        <div className={`grid gap-4 max-w-7xl mx-auto ${imageCount > 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2'}`}>
          {comparisonImages.map((image, index) => {
            const isOddLastGridItem = imageCount > 2 && imageCount % 2 === 1 && index === imageCount - 1;
            const otherImageMetadata = getComparisonMetadataReference(comparisonImages, index, metadataReference);

            return (
              <ComparisonMetadataPanel
                key={image.id}
                image={image}
                isExpanded={expandedMetadataIndexes.has(index)}
                onToggleExpanded={() => toggleMetadataPanel(index)}
                viewMode={metadataViewMode}
                otherImageMetadata={otherImageMetadata}
                className={isOddLastGridItem ? 'md:col-span-2' : ''}
                compareLabel={index === 0 ? 'Reference' : metadataViewMode === 'diff' ? 'vs Image 1' : undefined}
                isHighlighted={activeMetadataIndex === index}
              />
            );
          })}
        </div>
      </div>

      <div className="absolute bottom-4 left-4 text-xs text-gray-500 hidden md:block">
        <p>
          <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded">Esc</kbd> Close
          {' '}•{' '}
          <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded">S</kbd> Toggle Sync
          {imageCount === 2 ? (
            <>
              {' '}•{' '}
              <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded">Space</kbd> Swap
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
};

export default ComparisonModal;

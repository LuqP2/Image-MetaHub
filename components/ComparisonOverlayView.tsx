import React, { CSSProperties, FC, useEffect, useMemo, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { ZoomIn, ZoomOut, RotateCcw, AlertCircle, Pause, Play } from 'lucide-react';
import { ComparisonAdvancedSettings, ComparisonViewMode, IndexedImage, ZoomState } from '../types';
import useComparisonImageSource from '../hooks/useComparisonImageSource';
import {
  buildVisualComparisonFromUrls,
  imageDataToDataUrl,
  VisualComparisonMetrics,
} from '../utils/visualComparison';

interface ComparisonOverlayViewProps {
  leftImage: IndexedImage;
  rightImage: IndexedImage;
  leftDirectory: string;
  rightDirectory: string;
  mode: Exclude<ComparisonViewMode, 'side-by-side'>;
  sharedZoom: ZoomState;
  onZoomChange: (zoom: number, x: number, y: number) => void;
  onActiveImageChange?: (index: number | null) => void;
  advancedSettings: ComparisonAdvancedSettings;
  onVisualAnalysisChange?: (metrics: VisualComparisonMetrics | null) => void;
  highlightedRegion?: VisualComparisonMetrics['strongestRegion'] | null;
}

const ADVANCED_MODES = new Set<ComparisonViewMode>(['difference-map', 'loupe', 'edge-difference']);

const getContainedRect = (
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number,
) => {
  const scale = Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
};

const ComparisonOverlayView: FC<ComparisonOverlayViewProps> = ({
  leftImage,
  rightImage,
  leftDirectory,
  rightDirectory,
  mode,
  sharedZoom,
  onZoomChange,
  onActiveImageChange,
  advancedSettings,
  onVisualAnalysisChange,
  highlightedRegion,
}) => {
  const { imageUrl: leftUrl, loadError: leftError, isLoading: isLeftLoading } = useComparisonImageSource(leftImage, leftDirectory);
  const { imageUrl: rightUrl, loadError: rightError, isLoading: isRightLoading } = useComparisonImageSource(rightImage, rightDirectory);
  const [sliderValue, setSliderValue] = useState(50);
  const [isHovering, setIsHovering] = useState(false);
  const [isFlickerShowingRight, setIsFlickerShowingRight] = useState(false);
  const [isFlickerPaused, setIsFlickerPaused] = useState(false);
  const [visualError, setVisualError] = useState<string | null>(null);
  const [leftAnalysisUrl, setLeftAnalysisUrl] = useState<string | null>(null);
  const [rightAnalysisUrl, setRightAnalysisUrl] = useState<string | null>(null);
  const [heatmapUrl, setHeatmapUrl] = useState<string | null>(null);
  const [edgeMapUrl, setEdgeMapUrl] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<VisualComparisonMetrics | null>(null);
  const [loupePoint, setLoupePoint] = useState<{ x: number; y: number; localX: number; localY: number } | null>(null);
  const [localTransform, setLocalTransform] = useState(sharedZoom);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDraggingHandle, setIsDraggingHandle] = useState(false);
  const isAdvancedMode = ADVANCED_MODES.has(mode);

  useEffect(() => {
    if (!transformRef.current || !transformRef.current.state) return;
    const { state } = transformRef.current;
    if (state.scale !== sharedZoom.zoom || state.positionX !== sharedZoom.x || state.positionY !== sharedZoom.y) {
      transformRef.current.setTransform(sharedZoom.x, sharedZoom.y, sharedZoom.zoom, 0);
    }
    setLocalTransform(sharedZoom);
  }, [sharedZoom]);

  useEffect(() => {
    if (!isAdvancedMode || !leftUrl || !rightUrl) {
      setLeftAnalysisUrl(null);
      setRightAnalysisUrl(null);
      setHeatmapUrl(null);
      setEdgeMapUrl(null);
      setMetrics(null);
      setVisualError(null);
      onVisualAnalysisChange?.(null);
      return;
    }

    let isMounted = true;
    setVisualError(null);
    buildVisualComparisonFromUrls(leftUrl, rightUrl, advancedSettings.threshold)
      .then((result) => {
        if (!isMounted) return;
        const nextLeftAnalysisUrl = imageDataToDataUrl(result.left);
        const nextRightAnalysisUrl = imageDataToDataUrl(result.right);
        const nextHeatmapUrl = imageDataToDataUrl(result.heatmap);
        const nextEdgeMapUrl = imageDataToDataUrl(result.edgeMap);
        setLeftAnalysisUrl(nextLeftAnalysisUrl);
        setRightAnalysisUrl(nextRightAnalysisUrl);
        setHeatmapUrl(nextHeatmapUrl);
        setEdgeMapUrl(nextEdgeMapUrl);
        setMetrics(result.metrics);
        onVisualAnalysisChange?.(result.metrics);
      })
      .catch((error) => {
        if (!isMounted) return;
        const message = error instanceof Error ? error.message : String(error);
        setVisualError(message);
        setLeftAnalysisUrl(null);
        setRightAnalysisUrl(null);
        setHeatmapUrl(null);
        setEdgeMapUrl(null);
        setMetrics(null);
        onVisualAnalysisChange?.(null);
      });

    return () => {
      isMounted = false;
    };
  }, [advancedSettings.threshold, isAdvancedMode, leftUrl, onVisualAnalysisChange, rightUrl]);

  useEffect(() => {
    if (mode !== 'flicker' || isFlickerPaused) return;
    const interval = window.setInterval(() => {
      setIsFlickerShowingRight((current) => !current);
    }, advancedSettings.flickerSpeedMs);
    return () => window.clearInterval(interval);
  }, [advancedSettings.flickerSpeedMs, isFlickerPaused, mode]);

  const handleTransform = (ref: ReactZoomPanPinchRef) => {
    if (!ref || !ref.state) return;
    const { positionX, positionY, scale } = ref.state;
    setLocalTransform({ zoom: scale, x: positionX, y: positionY });
    onZoomChange(scale, positionX, positionY);
  };

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  const updateSliderFromClientX = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const percent = ((clientX - rect.left) / rect.width) * 100;
    setSliderValue(clamp(percent, 0, 100));
  };

  const updateActiveImageFromClientX = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const percent = ((clientX - rect.left) / rect.width) * 100;
    onActiveImageChange?.(percent <= sliderValue ? 0 : 1);
  };

  useEffect(() => {
    if (!isDraggingHandle) return;

    const handleMove = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      updateSliderFromClientX(e.clientX);
      updateActiveImageFromClientX(e.clientX);
    };

    const handleUp = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingHandle(false);
      onActiveImageChange?.(null);
    };

    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleUp, { passive: false });

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [isDraggingHandle]);

  const ready = Boolean(leftUrl && rightUrl);
  const isLoading = isLeftLoading || isRightLoading;
  const requiresVisualAnalysis = mode === 'difference-map' || mode === 'loupe' || mode === 'edge-difference';
  const advancedReady = !requiresVisualAnalysis || Boolean(metrics);
  const overlayStyle =
    mode === 'slider'
      ? { clipPath: `inset(0 ${100 - sliderValue}% 0 0)`, transition: isDraggingHandle ? 'none' : 'clip-path 180ms ease' }
      : { opacity: isHovering ? 0 : 1, transition: 'opacity 200ms ease' };
  const baseStyle =
    mode === 'hover'
      ? { opacity: isHovering ? 1 : 0, transition: 'opacity 200ms ease' }
      : { opacity: 1 };

  const errorMessage = leftError || rightError;
  const normalizedLeftUrl = leftAnalysisUrl || leftUrl;
  const normalizedRightUrl = rightAnalysisUrl || rightUrl;
  const advancedBaseUrl = advancedSettings.baseMode === 'right' ? normalizedRightUrl : normalizedLeftUrl;
  const diffOnly = advancedSettings.baseMode === 'diff';

  const updateLoupeFromMouse = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const contentX = (localX - localTransform.x) / localTransform.zoom;
    const contentY = (localY - localTransform.y) / localTransform.zoom;
    const imageRect = metrics
      ? getContainedRect(rect.width, rect.height, metrics.width, metrics.height)
      : { x: 0, y: 0, width: rect.width, height: rect.height };
    const isInsideImage =
      contentX >= imageRect.x &&
      contentX <= imageRect.x + imageRect.width &&
      contentY >= imageRect.y &&
      contentY <= imageRect.y + imageRect.height;

    if (!isInsideImage) {
      setLoupePoint(null);
      return;
    }

    setLoupePoint({
      x: clamp(((contentX - imageRect.x) / imageRect.width) * 100, 0, 100),
      y: clamp(((contentY - imageRect.y) / imageRect.height) * 100, 0, 100),
      localX,
      localY,
    });
  };

  const regionStyle = useMemo<CSSProperties | null>(() => {
    if (!highlightedRegion || !metrics) return null;
    const container = containerRef.current?.getBoundingClientRect();
    if (!container) return null;
    const imageRect = getContainedRect(container.width, container.height, metrics.width, metrics.height);
    return {
      left: imageRect.x + (highlightedRegion.x / metrics.width) * imageRect.width,
      top: imageRect.y + (highlightedRegion.y / metrics.height) * imageRect.height,
      width: (highlightedRegion.width / metrics.width) * imageRect.width,
      height: (highlightedRegion.height / metrics.height) * imageRect.height,
    };
  }, [highlightedRegion, metrics]);

  const renderAdvancedLayer = () => {
    if (!ready) return null;
    if (visualError) {
      return (
        <div className="absolute left-1/2 top-4 max-w-md -translate-x-1/2 rounded-lg border border-amber-500/30 bg-amber-950/80 px-3 py-2 text-sm text-amber-100 shadow-lg">
          Visual analysis unavailable: {visualError}
        </div>
      );
    }

    if (!advancedReady) {
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-white/10 bg-black/70 px-4 py-2 text-sm text-gray-200 shadow">
            Building visual comparison...
          </div>
        </div>
      );
    }

    if (mode === 'flicker') {
      const currentUrl = isFlickerShowingRight ? rightUrl : leftUrl;
      return (
        <>
          {currentUrl && <img src={currentUrl} alt={isFlickerShowingRight ? rightImage.name : leftImage.name} className="absolute inset-0 h-full w-full select-none object-contain" />}
          <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-xs text-gray-100 shadow">
            <button
              type="button"
              onClick={() => setIsFlickerPaused((current) => !current)}
              className="rounded p-1 text-gray-200 hover:bg-white/10 hover:text-white"
              title={isFlickerPaused ? 'Resume flicker' : 'Pause flicker'}
              aria-label={isFlickerPaused ? 'Resume flicker' : 'Pause flicker'}
            >
              {isFlickerPaused ? <Play aria-hidden="true" className="h-3.5 w-3.5" /> : <Pause aria-hidden="true" className="h-3.5 w-3.5" />}
            </button>
            {advancedSettings.showLabels ? <span>{isFlickerShowingRight ? `Image B: ${rightImage.name}` : `Image A: ${leftImage.name}`}</span> : <span>{isFlickerShowingRight ? 'Image B' : 'Image A'}</span>}
          </div>
        </>
      );
    }

    if (mode === 'difference-map') {
      return (
        <>
          {!diffOnly && advancedBaseUrl && <img src={advancedBaseUrl} alt="Difference base" className="absolute inset-0 h-full w-full select-none object-contain" />}
          {diffOnly && <div className="absolute inset-0 bg-black" />}
          {heatmapUrl && <img src={heatmapUrl} alt="Difference heatmap" className="absolute inset-0 h-full w-full select-none object-contain" style={{ opacity: advancedSettings.opacity / 100 }} />}
          {regionStyle && <div className="absolute border-2 border-white/80 bg-white/10 shadow-[0_0_18px_rgba(255,255,255,0.35)]" style={regionStyle} />}
        </>
      );
    }

    if (mode === 'edge-difference') {
      return (
        <>
          {!diffOnly && advancedBaseUrl && <img src={advancedBaseUrl} alt="Edge base" className="absolute inset-0 h-full w-full select-none object-contain opacity-45" />}
          {diffOnly && <div className="absolute inset-0 bg-black" />}
          {edgeMapUrl && <img src={edgeMapUrl} alt="Edge difference map" className="absolute inset-0 h-full w-full select-none object-contain" style={{ opacity: advancedSettings.opacity / 100 }} />}
          <div className="absolute left-4 top-4 rounded-lg border border-white/10 bg-black/65 px-3 py-1.5 text-xs text-gray-100">
            <span className="text-cyan-200">Cyan: Image A</span>
            <span className="mx-2 text-gray-500">/</span>
            <span className="text-fuchsia-200">Magenta: Image B</span>
          </div>
        </>
      );
    }

    if (mode === 'loupe') {
      return (
        <>
          {normalizedLeftUrl && <img src={normalizedLeftUrl} alt={leftImage.name} className="absolute inset-0 h-full w-full select-none object-contain" />}
          <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-white/10 bg-black/65 px-3 py-1 text-xs text-gray-100 shadow">
            Move over the image to inspect A / Diff / B
          </div>
        </>
      );
    }

    return null;
  };

  const renderLoupeOverlay = () => {
    if (mode !== 'loupe' || !loupePoint || !advancedReady) return null;

    const loupeLayers = [
      { url: normalizedLeftUrl, label: 'A' },
      { url: heatmapUrl, label: 'Diff', opacity: advancedSettings.opacity / 100 },
      { url: normalizedRightUrl, label: 'B' },
    ];
    const container = containerRef.current?.getBoundingClientRect();
    if (!container) return null;
    const loupeSize = advancedSettings.loupeSize;
    const paneWidth = loupeSize / 3;
    const renderViewportClone = (url: string, opacity = 1) => (
      <div
        className="absolute top-0 overflow-hidden"
        style={{
          left: 0,
          width: paneWidth,
          height: loupeSize,
        }}
      >
        <div
          className="absolute overflow-hidden"
          style={{
            left: paneWidth / 2 - loupePoint.localX,
            top: loupeSize / 2 - loupePoint.localY,
            width: container.width,
            height: container.height,
            transform: `scale(${advancedSettings.loupeZoom})`,
            transformOrigin: `${loupePoint.localX}px ${loupePoint.localY}px`,
            opacity,
          }}
        >
          <div
            className="relative h-full w-full"
            style={{
              transform: `translate(${localTransform.x}px, ${localTransform.y}px) scale(${localTransform.zoom})`,
              transformOrigin: '0 0',
            }}
          >
            <img src={url} alt="" className="absolute inset-0 h-full w-full object-contain" />
          </div>
        </div>
      </div>
    );

    return (
      <div
        className="pointer-events-none absolute z-20 overflow-hidden rounded-full border-2 border-white/80 bg-black shadow-2xl"
        style={{
          left: loupePoint.localX,
          top: loupePoint.localY,
          width: advancedSettings.loupeSize,
          height: advancedSettings.loupeSize,
          transform: 'translate(-50%, -50%)',
        }}
      >
        {loupeLayers.map((layer, index) => (
          layer.url ? (
            <div
              key={layer.label}
              className="absolute top-0 overflow-hidden"
              style={{
                left: index * paneWidth,
                width: paneWidth,
                height: loupeSize,
              }}
            >
              {renderViewportClone(layer.url, layer.opacity ?? 1)}
            </div>
          ) : null
        ))}
        <div className="absolute inset-y-0 left-1/3 w-px bg-white/70" />
        <div className="absolute inset-y-0 left-2/3 w-px bg-white/70" />
        <div className="absolute inset-x-0 top-2 grid grid-cols-3 px-4 text-center text-[10px] font-semibold uppercase tracking-wide text-white/85">
          <span>A</span>
          <span>Diff</span>
          <span>B</span>
        </div>
      </div>
    );
  };

  if (errorMessage) {
    return (
      <div className="relative h-[60vh] md:h-full flex items-center justify-center bg-gray-900/50 border-y border-gray-700">
        <div className="text-center p-8">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-red-300 font-semibold">Failed to load image</p>
          <p className="text-gray-500 text-sm mt-2 max-w-md mx-auto">{errorMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-[60vh] md:h-full bg-black border-y border-gray-700/60 overflow-hidden group">
      <TransformWrapper
        ref={transformRef}
        initialScale={Math.max(sharedZoom.zoom, 0.5)}
        minScale={0.4}
        maxScale={5}
        centerOnInit
        wheel={{ step: 0.1 }}
        onTransformed={handleTransform}
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <TransformComponent
              wrapperClass="w-full h-full"
              contentClass="w-full h-full"
              wrapperStyle={{ width: '100%', height: '100%' }}
              contentStyle={{ width: '100%', height: '100%' }}
            >
              <div
                className="relative w-full h-full overflow-hidden bg-black"
                onMouseEnter={
                  mode === 'hover'
                    ? () => {
                        setIsHovering(true);
                        onActiveImageChange?.(1);
                      }
                    : undefined
                }
                onMouseLeave={
                  mode === 'hover'
                    ? () => {
                        setIsHovering(false);
                        onActiveImageChange?.(null);
                      }
                    : mode === 'slider'
                      ? () => onActiveImageChange?.(null)
                      : undefined
                }
                onMouseMove={mode === 'slider' ? (event) => updateActiveImageFromClientX(event.clientX) : undefined}
                onPointerMove={
                  mode === 'loupe'
                    ? (event) => updateLoupeFromMouse(event.clientX, event.clientY)
                    : undefined
                }
                onPointerLeave={
                  mode === 'loupe'
                    ? () => setLoupePoint(null)
                    : undefined
                }
              >
                {isLoading && !ready && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full border-4 border-gray-700 border-t-blue-500 animate-spin" />
                  </div>
                )}

                {!isAdvancedMode && rightUrl && (
                  <img
                    src={rightUrl}
                    alt={rightImage.name}
                    className="absolute inset-0 w-full h-full object-contain select-none"
                    style={baseStyle}
                  />
                )}

                {!isAdvancedMode && leftUrl && (
                  <img
                    src={leftUrl}
                    alt={leftImage.name}
                    className="absolute inset-0 w-full h-full object-contain select-none"
                    style={overlayStyle}
                  />
                )}

                {isAdvancedMode && renderAdvancedLayer()}

                {ready && mode === 'slider' && (
                  <>
                    <div
                      className="absolute inset-y-0 cursor-ew-resize select-none touch-none flex items-center justify-center"
                      style={{ left: `${sliderValue}%`, width: '40px', marginLeft: '-20px' }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDraggingHandle(true);
                        updateSliderFromClientX(e.clientX);
                      }}
                    >
                      <div className="w-px h-full bg-white/70 shadow-[0_0_12px_rgba(0,0,0,0.45)] pointer-events-none" />
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-12 w-6 rounded-full bg-white/95 text-gray-800 shadow-xl flex items-center justify-center border border-gray-200 pointer-events-none">
                        <div className="w-1 h-8 bg-gray-500 rounded-full" />
                      </div>
                      <div className="absolute left-1/2 -translate-x-1/2 top-3 text-[11px] text-gray-200 px-2 py-0.5 rounded-full bg-black/70 border border-white/10 pointer-events-none">
                        {Math.round(sliderValue)}%
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={sliderValue}
                      onChange={(e) => setSliderValue(Number(e.target.value))}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      className="absolute inset-x-12 bottom-6 md:bottom-5 h-1 accent-blue-500 cursor-ew-resize touch-none bg-white/20 rounded-full"
                    />
                  </>
                )}

                {ready && mode === 'hover' && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 border border-white/10 text-xs text-gray-100 shadow backdrop-blur-sm">
                    {isHovering ? `Showing: ${rightImage.name}` : `Hover to reveal: ${rightImage.name}`}
                  </div>
                )}
              </div>
            </TransformComponent>

            {renderLoupeOverlay()}

            <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity z-10">
              <button
                onClick={() => zoomIn()}
                className="p-2 bg-black/60 hover:bg-black/80 rounded-lg backdrop-blur-sm transition-colors"
                title="Zoom In"
                aria-label="Zoom In"
              >
                <ZoomIn aria-hidden="true" className="w-5 h-5 text-white" />
              </button>
              <button
                onClick={() => zoomOut()}
                className="p-2 bg-black/60 hover:bg-black/80 rounded-lg backdrop-blur-sm transition-colors"
                title="Zoom Out"
                aria-label="Zoom Out"
              >
                <ZoomOut aria-hidden="true" className="w-5 h-5 text-white" />
              </button>
              <button
                onClick={() => resetTransform()}
                className="p-2 bg-black/60 hover:bg-black/80 rounded-lg backdrop-blur-sm transition-colors"
                title="Reset Zoom"
                aria-label="Reset Zoom"
              >
                <RotateCcw aria-hidden="true" className="w-5 h-5 text-white" />
              </button>
            </div>

            <div className="absolute bottom-4 left-4 bg-black/65 text-white text-sm font-medium rounded-lg px-3 py-1.5 backdrop-blur-sm border border-white/10 max-w-[45%] truncate">
              <span className="text-xs uppercase tracking-wide text-gray-300 mr-2">Left</span>
              <span title={leftImage.name} className="align-middle">{leftImage.name}</span>
            </div>

            <div className="absolute bottom-4 right-4 bg-black/65 text-white text-sm font-medium rounded-lg px-3 py-1.5 backdrop-blur-sm border border-white/10 max-w-[45%] truncate text-right">
              <span title={rightImage.name} className="align-middle">{rightImage.name}</span>
              <span className="text-xs uppercase tracking-wide text-gray-300 ml-2">Right</span>
            </div>
          </>
        )}
      </TransformWrapper>
    </div>
  );
};

export default ComparisonOverlayView;

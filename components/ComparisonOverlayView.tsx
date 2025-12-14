import React, { FC, useEffect, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { ZoomIn, ZoomOut, RotateCcw, AlertCircle } from 'lucide-react';
import { ComparisonViewMode, IndexedImage, ZoomState } from '../types';
import useComparisonImageSource from '../hooks/useComparisonImageSource';

interface ComparisonOverlayViewProps {
  leftImage: IndexedImage;
  rightImage: IndexedImage;
  leftDirectory: string;
  rightDirectory: string;
  mode: Exclude<ComparisonViewMode, 'side-by-side'>;
  sharedZoom: ZoomState;
  onZoomChange: (zoom: number, x: number, y: number) => void;
}

const ComparisonOverlayView: FC<ComparisonOverlayViewProps> = ({
  leftImage,
  rightImage,
  leftDirectory,
  rightDirectory,
  mode,
  sharedZoom,
  onZoomChange,
}) => {
  const { imageUrl: leftUrl, loadError: leftError, isLoading: isLeftLoading } = useComparisonImageSource(leftImage, leftDirectory);
  const { imageUrl: rightUrl, loadError: rightError, isLoading: isRightLoading } = useComparisonImageSource(rightImage, rightDirectory);
  const [sliderValue, setSliderValue] = useState(50);
  const [isHovering, setIsHovering] = useState(false);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDraggingHandle, setIsDraggingHandle] = useState(false);

  useEffect(() => {
    if (!transformRef.current || !transformRef.current.state) return;
    const { state } = transformRef.current;
    if (state.scale !== sharedZoom.zoom || state.positionX !== sharedZoom.x || state.positionY !== sharedZoom.y) {
      transformRef.current.setTransform(sharedZoom.x, sharedZoom.y, sharedZoom.zoom, 0);
    }
  }, [sharedZoom]);

  const handleTransform = (ref: ReactZoomPanPinchRef) => {
    if (!ref || !ref.state) return;
    const { positionX, positionY, scale } = ref.state;
    onZoomChange(scale, positionX, positionY);
  };

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  const updateSliderFromClientX = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const percent = ((clientX - rect.left) / rect.width) * 100;
    setSliderValue(clamp(percent, 0, 100));
  };

  useEffect(() => {
    if (!isDraggingHandle) return;

    const handleMove = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      updateSliderFromClientX(e.clientX);
    };

    const handleUp = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingHandle(false);
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
  const overlayStyle =
    mode === 'slider'
      ? { clipPath: `inset(0 ${100 - sliderValue}% 0 0)`, transition: 'clip-path 180ms ease' }
      : { opacity: isHovering ? 0 : 1, transition: 'opacity 200ms ease' };
  const baseStyle =
    mode === 'hover'
      ? { opacity: isHovering ? 1 : 0, transition: 'opacity 200ms ease' }
      : { opacity: 1 };

  const errorMessage = leftError || rightError;

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
            <TransformComponent wrapperClass="w-full h-full" contentClass="w-full h-full">
              <div
                className="relative w-full h-full overflow-hidden bg-black"
                onMouseEnter={mode === 'hover' ? () => setIsHovering(true) : undefined}
                onMouseLeave={mode === 'hover' ? () => setIsHovering(false) : undefined}
              >
                {isLoading && !ready && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full border-4 border-gray-700 border-t-blue-500 animate-spin" />
                  </div>
                )}

                {rightUrl && (
                  <img
                    src={rightUrl}
                    alt={rightImage.name}
                    className="absolute inset-0 w-full h-full object-contain select-none"
                    style={baseStyle}
                  />
                )}

                {leftUrl && (
                  <img
                    src={leftUrl}
                    alt={leftImage.name}
                    className="absolute inset-0 w-full h-full object-contain select-none"
                    style={overlayStyle}
                  />
                )}

                {ready && mode === 'slider' && (
                  <>
                    <div
                      className="absolute inset-y-0 cursor-ew-resize select-none touch-none"
                      style={{ left: `${sliderValue}%` }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDraggingHandle(true);
                        updateSliderFromClientX(e.clientX);
                      }}
                    >
                      <div className="w-px h-full bg-white/70 shadow-[0_0_12px_rgba(0,0,0,0.45)] pointer-events-none" />
                      <div className="absolute -left-3 top-1/2 -translate-y-1/2 h-12 w-6 rounded-full bg-white/95 text-gray-800 shadow-xl flex items-center justify-center border border-gray-200 pointer-events-none">
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

            <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity z-10">
              <button
                onClick={() => zoomIn()}
                className="p-2 bg-black/60 hover:bg-black/80 rounded-lg backdrop-blur-sm transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-5 h-5 text-white" />
              </button>
              <button
                onClick={() => zoomOut()}
                className="p-2 bg-black/60 hover:bg-black/80 rounded-lg backdrop-blur-sm transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-5 h-5 text-white" />
              </button>
              <button
                onClick={() => resetTransform()}
                className="p-2 bg-black/60 hover:bg-black/80 rounded-lg backdrop-blur-sm transition-colors"
                title="Reset Zoom"
              >
                <RotateCcw className="w-5 h-5 text-white" />
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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';

export interface FloatingModalWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
}

type FloatingModalInteractionState =
  | { mode: 'idle' }
  | {
      mode: 'drag';
      startX: number;
      startY: number;
      initialX: number;
      initialY: number;
    }
  | {
      mode: 'resize';
      startX: number;
      startY: number;
      initialWidth: number;
      initialHeight: number;
      initialX: number;
      initialY: number;
      direction:
        | 'top'
        | 'right'
        | 'bottom'
        | 'left'
        | 'top-left'
        | 'top-right'
        | 'bottom-left'
        | 'bottom-right';
    };

interface FloatingModalRenderContext {
  windowState: FloatingModalWindowState;
  isMaximized: boolean;
}

interface FloatingModalFrameProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode | ((context: FloatingModalRenderContext) => React.ReactNode);
  footer?: React.ReactNode | ((context: FloatingModalRenderContext) => React.ReactNode);
  headerActions?: React.ReactNode | ((context: FloatingModalRenderContext) => React.ReactNode);
  minWidth?: number;
  minHeight?: number;
  initialWidth?: number;
  initialHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  zIndex?: number;
  allowMaximize?: boolean;
  closeOnBackdrop?: boolean;
  bodyClassName?: string;
  frameClassName?: string;
}

const MODAL_MARGIN = 20;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const joinClasses = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

const shouldStartWindowDrag = (target: EventTarget | null) => {
  if (!(target instanceof Element)) {
    return false;
  }

  return !target.closest([
    '[data-no-window-drag="true"]',
    '[data-resize-handle="true"]',
    'button',
    'input',
    'textarea',
    'select',
    'option',
    'a',
    'label',
    'summary',
    '[role="button"]',
    '[role="link"]',
  ].join(', '));
};

const getViewportMetrics = (minWidth: number, minHeight: number) => {
  if (typeof window === 'undefined') {
    return {
      viewportWidth: 1600,
      viewportHeight: 1080,
      margin: MODAL_MARGIN,
      minWidth,
      minHeight,
    };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = viewportWidth < 900 ? 12 : MODAL_MARGIN;

  return {
    viewportWidth,
    viewportHeight,
    margin,
    minWidth: Math.min(minWidth, Math.max(360, viewportWidth - margin * 2)),
    minHeight: Math.min(minHeight, Math.max(240, viewportHeight - margin * 2)),
  };
};

const createDefaultWindowState = ({
  minWidth,
  minHeight,
  initialWidth,
  initialHeight,
  maxWidth,
  maxHeight,
}: {
  minWidth: number;
  minHeight: number;
  initialWidth: number;
  initialHeight: number;
  maxWidth: number;
  maxHeight: number;
}): FloatingModalWindowState => {
  const metrics = getViewportMetrics(minWidth, minHeight);
  const width = clamp(
    Math.min(initialWidth, maxWidth, metrics.viewportWidth - metrics.margin * 2),
    metrics.minWidth,
    metrics.viewportWidth - metrics.margin * 2
  );
  const height = clamp(
    Math.min(initialHeight, maxHeight, metrics.viewportHeight - metrics.margin * 2),
    metrics.minHeight,
    metrics.viewportHeight - metrics.margin * 2
  );

  return {
    width,
    height,
    x: Math.round((metrics.viewportWidth - width) / 2),
    y: Math.round((metrics.viewportHeight - height) / 2),
  };
};

const createMaximizedWindowState = (minWidth: number, minHeight: number): FloatingModalWindowState => {
  const metrics = getViewportMetrics(minWidth, minHeight);
  const margin = Math.max(8, metrics.margin - 8);

  return {
    x: margin,
    y: margin,
    width: Math.max(metrics.minWidth, metrics.viewportWidth - margin * 2),
    height: Math.max(metrics.minHeight, metrics.viewportHeight - margin * 2),
  };
};

const clampWindowToViewport = (
  windowState: FloatingModalWindowState,
  minWidth: number,
  minHeight: number
): FloatingModalWindowState => {
  const metrics = getViewportMetrics(minWidth, minHeight);
  const maxWidth = Math.max(metrics.minWidth, metrics.viewportWidth - metrics.margin * 2);
  const maxHeight = Math.max(metrics.minHeight, metrics.viewportHeight - metrics.margin * 2);
  const width = clamp(windowState.width, metrics.minWidth, maxWidth);
  const height = clamp(windowState.height, metrics.minHeight, maxHeight);

  return {
    width,
    height,
    x: clamp(windowState.x, metrics.margin, metrics.viewportWidth - metrics.margin - width),
    y: clamp(windowState.y, metrics.margin, metrics.viewportHeight - metrics.margin - height),
  };
};

const renderSlot = (
  slot: FloatingModalFrameProps['children'] | FloatingModalFrameProps['footer'] | FloatingModalFrameProps['headerActions'],
  context: FloatingModalRenderContext
) => (typeof slot === 'function' ? slot(context) : slot ?? null);

const FloatingModalFrame: React.FC<FloatingModalFrameProps> = ({
  title,
  subtitle,
  onClose,
  children,
  footer,
  headerActions,
  minWidth = 720,
  minHeight = 520,
  initialWidth = 960,
  initialHeight = 760,
  maxWidth = 1680,
  maxHeight = 1200,
  zIndex = 70,
  allowMaximize = true,
  closeOnBackdrop = true,
  bodyClassName,
  frameClassName,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [windowState, setWindowState] = useState<FloatingModalWindowState>(() =>
    createDefaultWindowState({ minWidth, minHeight, initialWidth, initialHeight, maxWidth, maxHeight })
  );
  const [interactionState, setInteractionState] = useState<FloatingModalInteractionState>({ mode: 'idle' });
  const shellRef = useRef<HTMLDivElement>(null);
  const windowStateRef = useRef(windowState);
  const liveWindowStateRef = useRef(windowState);
  const paintFrameRef = useRef<number | null>(null);
  const restoredWindowRef = useRef<FloatingModalWindowState | null>(null);

  const applyWindowStyles = useCallback((nextWindowState: FloatingModalWindowState) => {
    if (!shellRef.current) {
      return;
    }

    shellRef.current.style.left = `${nextWindowState.x}px`;
    shellRef.current.style.top = `${nextWindowState.y}px`;
    shellRef.current.style.width = `${nextWindowState.width}px`;
    shellRef.current.style.height = `${nextWindowState.height}px`;
  }, []);

  const scheduleWindowPaint = useCallback((nextWindowState: FloatingModalWindowState) => {
    liveWindowStateRef.current = nextWindowState;

    if (typeof window === 'undefined' || paintFrameRef.current !== null) {
      return;
    }

    paintFrameRef.current = window.requestAnimationFrame(() => {
      paintFrameRef.current = null;
      applyWindowStyles(liveWindowStateRef.current);
    });
  }, [applyWindowStyles]);

  useEffect(() => {
    windowStateRef.current = windowState;
    liveWindowStateRef.current = windowState;
    applyWindowStyles(windowState);
  }, [applyWindowStyles, windowState]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && paintFrameRef.current !== null) {
        window.cancelAnimationFrame(paintFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (isMaximized) {
        setWindowState(createMaximizedWindowState(minWidth, minHeight));
        return;
      }

      setWindowState((current) => clampWindowToViewport(current, minWidth, minHeight));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMaximized, minHeight, minWidth]);

  useEffect(() => {
    if (interactionState.mode === 'idle') {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const metrics = getViewportMetrics(minWidth, minHeight);
      const currentWindow = liveWindowStateRef.current;

      if (interactionState.mode === 'drag') {
        scheduleWindowPaint({
          ...currentWindow,
          x: clamp(
            interactionState.initialX + (event.clientX - interactionState.startX),
            metrics.margin,
            metrics.viewportWidth - metrics.margin - currentWindow.width
          ),
          y: clamp(
            interactionState.initialY + (event.clientY - interactionState.startY),
            metrics.margin,
            metrics.viewportHeight - metrics.margin - currentWindow.height
          ),
        });
        return;
      }

      const deltaX = event.clientX - interactionState.startX;
      const deltaY = event.clientY - interactionState.startY;
      const resizeFromLeft =
        interactionState.direction === 'left' ||
        interactionState.direction === 'top-left' ||
        interactionState.direction === 'bottom-left';
      const resizeFromRight =
        interactionState.direction === 'right' ||
        interactionState.direction === 'top-right' ||
        interactionState.direction === 'bottom-right';
      const resizeFromTop =
        interactionState.direction === 'top' ||
        interactionState.direction === 'top-left' ||
        interactionState.direction === 'top-right';
      const resizeFromBottom =
        interactionState.direction === 'bottom' ||
        interactionState.direction === 'bottom-left' ||
        interactionState.direction === 'bottom-right';

      let nextX = interactionState.initialX;
      let nextY = interactionState.initialY;
      let nextWidth = interactionState.initialWidth;
      let nextHeight = interactionState.initialHeight;

      if (resizeFromLeft) {
        nextX = clamp(
          interactionState.initialX + deltaX,
          metrics.margin,
          interactionState.initialX + interactionState.initialWidth - metrics.minWidth
        );
        nextWidth = interactionState.initialWidth - (nextX - interactionState.initialX);
      }

      if (resizeFromRight) {
        nextWidth = clamp(
          interactionState.initialWidth + deltaX,
          metrics.minWidth,
          metrics.viewportWidth - metrics.margin - interactionState.initialX
        );
      }

      if (resizeFromTop) {
        nextY = clamp(
          interactionState.initialY + deltaY,
          metrics.margin,
          interactionState.initialY + interactionState.initialHeight - metrics.minHeight
        );
        nextHeight = interactionState.initialHeight - (nextY - interactionState.initialY);
      }

      if (resizeFromBottom) {
        nextHeight = clamp(
          interactionState.initialHeight + deltaY,
          metrics.minHeight,
          metrics.viewportHeight - metrics.margin - interactionState.initialY
        );
      }

      scheduleWindowPaint({
        x: nextX,
        y: nextY,
        width: nextWidth,
        height: nextHeight,
      });
    };

    const handlePointerUp = () => {
      if (typeof window !== 'undefined' && paintFrameRef.current !== null) {
        window.cancelAnimationFrame(paintFrameRef.current);
        paintFrameRef.current = null;
        applyWindowStyles(liveWindowStateRef.current);
      }

      setWindowState(clampWindowToViewport(liveWindowStateRef.current, minWidth, minHeight));
      setInteractionState({ mode: 'idle' });
    };

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [applyWindowStyles, interactionState, minHeight, minWidth, scheduleWindowPaint]);

  const beginWindowDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const currentWindow = windowStateRef.current;
    event.preventDefault();
    setInteractionState({
      mode: 'drag',
      startX: event.clientX,
      startY: event.clientY,
      initialX: currentWindow.x,
      initialY: currentWindow.y,
    });
  }, []);

  const beginWindowResize = useCallback((direction: FloatingModalInteractionState extends { mode: 'resize'; direction: infer T } ? T : never) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isMaximized) {
      return;
    }

    const currentWindow = windowStateRef.current;
    event.preventDefault();
    event.stopPropagation();
    setInteractionState({
      mode: 'resize',
      direction,
      startX: event.clientX,
      startY: event.clientY,
      initialWidth: currentWindow.width,
      initialHeight: currentWindow.height,
      initialX: currentWindow.x,
      initialY: currentWindow.y,
    });
  }, [isMaximized]);

  const handleWindowSurfacePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!shouldStartWindowDrag(event.target) || isMaximized) {
      return;
    }

    beginWindowDrag(event);
  }, [beginWindowDrag, isMaximized]);

  const toggleMaximize = useCallback(() => {
    if (!allowMaximize) {
      return;
    }

    if (isMaximized) {
      setIsMaximized(false);
      setWindowState(restoredWindowRef.current ?? createDefaultWindowState({ minWidth, minHeight, initialWidth, initialHeight, maxWidth, maxHeight }));
      return;
    }

    restoredWindowRef.current = windowStateRef.current;
    setIsMaximized(true);
    setWindowState(createMaximizedWindowState(minWidth, minHeight));
  }, [allowMaximize, initialHeight, initialWidth, isMaximized, maxHeight, maxWidth, minHeight, minWidth]);

  const context: FloatingModalRenderContext = {
    windowState,
    isMaximized,
  };

  return (
    <div
      className="fixed inset-0 bg-black/65 backdrop-blur-sm"
      style={{ zIndex }}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={shellRef}
        className={joinClasses(
          'fixed flex flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-800 text-gray-100 shadow-2xl ring-1 ring-white/10',
          interactionState.mode !== 'idle' && 'select-none',
          frameClassName
        )}
        onClick={(event) => event.stopPropagation()}
        style={{
          left: `${windowState.x}px`,
          top: `${windowState.y}px`,
          width: `${windowState.width}px`,
          height: `${windowState.height}px`,
          transition: interactionState.mode === 'idle' ? 'box-shadow 160ms ease, border-color 160ms ease' : 'none',
        }}
      >
        <div
          className="flex items-center justify-between gap-3 border-b border-gray-700 bg-gray-900/95 px-4 py-1.5 backdrop-blur-sm cursor-move"
          onPointerDown={handleWindowSurfacePointerDown}
          onDoubleClick={allowMaximize ? toggleMaximize : undefined}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold leading-tight text-gray-100">{title}</div>
            {subtitle ? <div className="truncate text-[11px] leading-tight text-gray-400">{subtitle}</div> : null}
          </div>

          <div className="flex items-center gap-1.5" data-no-window-drag="true">
            {renderSlot(headerActions, context)}
            {allowMaximize ? (
              <button
                type="button"
                onClick={toggleMaximize}
                className="rounded-lg border border-gray-700 bg-gray-800 p-1.5 text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-700 hover:text-white"
                title={isMaximized ? 'Restore window' : 'Maximize window'}
              >
                {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-700 bg-gray-800 p-1.5 text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-700 hover:text-white"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className={joinClasses('flex-1 min-h-0 overflow-y-auto p-5', bodyClassName)}>
          {renderSlot(children, context)}
        </div>

        {footer ? (
          <div className="border-t border-gray-700 bg-gray-900/70 px-5 py-4">
            {renderSlot(footer, context)}
          </div>
        ) : null}

        {!isMaximized ? (
          <>
            <div
              className="absolute inset-x-5 top-0 h-1.5 cursor-ns-resize bg-transparent"
              onPointerDown={beginWindowResize('top')}
              data-resize-handle="true"
            />
            <div
              className="absolute inset-y-5 right-0 w-1.5 cursor-ew-resize bg-transparent"
              onPointerDown={beginWindowResize('right')}
              data-resize-handle="true"
            />
            <div
              className="absolute inset-x-5 bottom-0 h-1.5 cursor-ns-resize bg-transparent"
              onPointerDown={beginWindowResize('bottom')}
              data-resize-handle="true"
            />
            <div
              className="absolute inset-y-5 left-0 w-1.5 cursor-ew-resize bg-transparent"
              onPointerDown={beginWindowResize('left')}
              data-resize-handle="true"
            />
            <div
              className="absolute left-0 top-0 h-5 w-5 cursor-nwse-resize"
              onPointerDown={beginWindowResize('top-left')}
              data-resize-handle="true"
            />
            <div
              className="absolute right-0 top-0 h-5 w-5 cursor-nesw-resize"
              onPointerDown={beginWindowResize('top-right')}
              data-resize-handle="true"
            />
            <div
              className="absolute bottom-0 left-0 h-5 w-5 cursor-nesw-resize"
              onPointerDown={beginWindowResize('bottom-left')}
              data-resize-handle="true"
            />
            <div
              className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
              onPointerDown={beginWindowResize('bottom-right')}
              data-resize-handle="true"
            />
          </>
        ) : null}
      </div>
    </div>
  );
};

export default FloatingModalFrame;

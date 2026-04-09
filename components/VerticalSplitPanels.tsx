import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface VerticalSplitPane {
  id: string;
  content: React.ReactNode;
  ariaLabel: string;
}

interface VerticalSplitPanelsProps {
  panes: VerticalSplitPane[];
  storageKey: string;
  defaultSizes: number[];
  minPaneHeight?: number;
  className?: string;
}

const normalizeSizes = (sizes: number[]): number[] => {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return sizes;
  }

  return sizes.map((size) => (size / total) * 100);
};

export const sanitizeStoredPaneSizes = (
  rawSizes: unknown,
  expectedLength: number,
  fallbackSizes: number[],
): number[] => {
  if (!Array.isArray(rawSizes) || rawSizes.length !== expectedLength) {
    return normalizeSizes(fallbackSizes);
  }

  const parsed = rawSizes.map((value) => Number(value));
  if (parsed.some((value) => !Number.isFinite(value) || value <= 0)) {
    return normalizeSizes(fallbackSizes);
  }

  return normalizeSizes(parsed);
};

const VerticalSplitPanels: React.FC<VerticalSplitPanelsProps> = ({
  panes,
  storageKey,
  defaultSizes,
  minPaneHeight = 120,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<number[]>(() => {
    if (typeof window === 'undefined') {
      return normalizeSizes(defaultSizes);
    }

    try {
      const storedSizes = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null');
      return sanitizeStoredPaneSizes(storedSizes, panes.length, defaultSizes);
    } catch {
      return normalizeSizes(defaultSizes);
    }
  });
  const [dragState, setDragState] = useState<{
    handleIndex: number;
    startY: number;
    startSizes: number[];
  } | null>(null);

  useEffect(() => {
    setSizes((currentSizes) => sanitizeStoredPaneSizes(currentSizes, panes.length, defaultSizes));
  }, [defaultSizes, panes.length]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(sizes));
  }, [sizes, storageKey]);

  useEffect(() => {
    if (!dragState || typeof window === 'undefined') {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const containerHeight = containerRef.current?.getBoundingClientRect().height ?? 0;
      if (containerHeight <= 0) {
        return;
      }

      const pairStart = dragState.startSizes[dragState.handleIndex] + dragState.startSizes[dragState.handleIndex + 1];
      const minPercent = Math.min((minPaneHeight / containerHeight) * 100, pairStart / 2);
      const deltaPercent = ((event.clientY - dragState.startY) / containerHeight) * 100;
      const proposedFirst = dragState.startSizes[dragState.handleIndex] + deltaPercent;
      const clampedFirst = Math.min(Math.max(proposedFirst, minPercent), pairStart - minPercent);
      const nextSizes = [...dragState.startSizes];

      nextSizes[dragState.handleIndex] = clampedFirst;
      nextSizes[dragState.handleIndex + 1] = pairStart - clampedFirst;
      setSizes(nextSizes);
    };

    const handlePointerUp = () => {
      setDragState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    window.addEventListener('blur', handlePointerUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      window.removeEventListener('blur', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragState, minPaneHeight]);

  const paneStyles = useMemo(() => sizes.map((size) => ({
    flexBasis: `${size}%`,
    flexGrow: 0,
    flexShrink: 0,
    minHeight: `${minPaneHeight}px`,
  })), [minPaneHeight, sizes]);

  return (
    <div
      ref={containerRef}
      data-testid="vertical-split-panels"
      className={`flex min-h-0 flex-1 flex-col ${className}`.trim()}
    >
      {panes.map((pane, index) => (
        <React.Fragment key={pane.id}>
          <section
            role="region"
            aria-label={pane.ariaLabel}
            className="min-h-0 overflow-y-auto scrollbar-sidebar"
            style={paneStyles[index]}
          >
            {pane.content}
          </section>

          {index < panes.length - 1 && (
            <div
              role="separator"
              aria-label={`Resize ${pane.ariaLabel}`}
              aria-orientation="horizontal"
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture?.(event.pointerId);
                setDragState({
                  handleIndex: index,
                  startY: event.clientY,
                  startSizes: sizes,
                });
              }}
              className="group flex h-4 shrink-0 cursor-row-resize items-center justify-center touch-none"
              title="Drag to resize pane"
            >
              <div className={`h-1 w-16 rounded-full transition-colors ${dragState?.handleIndex === index ? 'bg-blue-400/90 shadow-[0_0_16px_rgba(96,165,250,0.55)]' : 'bg-gray-700/80 group-hover:bg-blue-400/80'}`} />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default VerticalSplitPanels;

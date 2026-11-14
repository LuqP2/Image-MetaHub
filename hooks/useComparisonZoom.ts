import { useEffect, useRef } from 'react';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import type { ZoomState } from '../types';

const boundPosition = (position: number, viewportSize: number, scale: number) => {
  const remainingSpace = viewportSize * (1 - scale);
  return scale <= 1 ? remainingSpace / 2 : Math.min(0, Math.max(remainingSpace, position));
};

export function useComparisonZoom(externalZoom: ZoomState | undefined, minScale: number, enabled: boolean) {
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const isApplyingExternalZoom = useRef(false);

  const applyZoom = (ref: ReactZoomPanPinchRef, zoom: ZoomState) => {
    const viewport = ref.instance.wrapperComponent;
    if (!viewport?.offsetWidth || !viewport.offsetHeight) return;
    const scale = Math.max(minScale, Math.min(5, zoom.zoom));
    const x = boundPosition(zoom.x, viewport.offsetWidth, scale);
    const y = boundPosition(zoom.y, viewport.offsetHeight, scale);
    const state = ref.instance.transformState;
    if (Math.abs(scale - state.scale) < 0.001 &&
        Math.abs(x - state.positionX) < 0.5 &&
        Math.abs(y - state.positionY) < 0.5) return;

    // A smaller follower may clamp a shared position. Keep that local to its viewport.
    isApplyingExternalZoom.current = true;
    try {
      ref.setTransform(x, y, scale, 0);
    } finally {
      isApplyingExternalZoom.current = false;
    }
  };

  const applyExternalZoom = (ref: ReactZoomPanPinchRef) => {
    if (externalZoom) applyZoom(ref, externalZoom);
  };

  useEffect(() => {
    const ref = transformRef.current;
    if (ref) applyExternalZoom(ref);
  }, [externalZoom?.zoom, externalZoom?.x, externalZoom?.y, minScale]);

  useEffect(() => {
    if (!enabled) return;
    const ref = transformRef.current;
    const viewport = ref?.instance.wrapperComponent;
    if (!ref || !viewport) return;

    const observer = new ResizeObserver(() => {
      const { scale, positionX, positionY } = ref.instance.transformState;
      applyZoom(ref, { zoom: scale, x: positionX, y: positionY });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [enabled, minScale]);

  return { transformRef, applyExternalZoom, isApplyingExternalZoom };
}

import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ImageViewerNavigationSource } from '../services/imageViewerContracts';
import type { FocusableViewerSession } from './useImageViewerFocus';

interface ReusableViewerSession extends FocusableViewerSession {
  navigationImageIds: string[];
  navigationSource: ImageViewerNavigationSource;
  startSlideshow?: boolean;
  closeOnSlideshowExit?: boolean;
}

interface OpenRequest {
  imageId: string;
  navigationImageIds: string[];
  navigationSource: ImageViewerNavigationSource;
  isMinimized?: boolean;
  startSlideshow?: boolean;
}

/** Replace the image while retaining the native window, session and geometry. */
export function useReusableImageViewer<T extends ReusableViewerSession>(
  enabled: boolean,
  sessions: T[],
  activeId: string | null,
  setSessions: Dispatch<SetStateAction<T[]>>,
  setActiveId: Dispatch<SetStateAction<string | null>>,
  synchronizeImage: (imageId: string) => void,
  requestActivation: (modalId: string) => void,
) {
  const current = useRef({ sessions, activeId });
  current.current = { sessions, activeId };
  const activation = useRef<string | null>(null);

  // Activate after React has committed the replacement image, so a focus event
  // cannot synchronize the library back to the previous image.
  useEffect(() => {
    const modalId = activation.current;
    activation.current = null;
    if (modalId) requestActivation(modalId);
  }, [sessions, requestActivation]);

  return useCallback((request: OpenRequest): string | null => {
    if (!enabled) return null;
    const state = current.current;
    const existing = state.sessions.find((entry) => entry.imageId === request.imageId);
    // Respect an inline fallback that already displays this image.
    if (existing?.host === 'inline' || existing?.navigationSource === 'slideshow') return null;
    // A slideshow owns its playlist and playback state; keep it independent.
    const detached = state.sessions.filter((entry) => entry.host === 'detached' && entry.navigationSource !== 'slideshow');
    const target = existing
      ?? detached.find((entry) => entry.modalId === state.activeId)
      ?? detached.reduce<T | undefined>((latest, entry) =>
        !latest || entry.zIndex > latest.zIndex ? entry : latest, undefined);
    if (!target) return null;

    const replace = (entries: T[]): T[] => entries.map((entry) => entry.modalId === target.modalId ? {
      ...entry,
      ...request,
      isMinimized: Boolean(request.isMinimized),
      startSlideshow: Boolean(request.startSlideshow),
      closeOnSlideshowExit: false,
      nativeStatus: entry.nativeStatus === 'pending' ? 'pending'
        : request.isMinimized ? 'minimized' as const : 'open' as const,
      zIndex: Math.max(...entries.map((candidate) => candidate.zIndex)) + 1,
    } : entry);
    current.current.sessions = replace(state.sessions);
    setSessions(replace);
    activation.current = request.isMinimized ? null : target.modalId;
    if (!request.isMinimized) {
      current.current.activeId = target.modalId;
      setActiveId(target.modalId);
      synchronizeImage(request.imageId);
    }
    return target.modalId;
  }, [enabled, setSessions, setActiveId, synchronizeImage]);
}

import { useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export interface FocusableViewerSession {
  modalId: string;
  sessionId: string;
  imageId: string;
  host: 'inline' | 'detached';
  nativeStatus?: 'pending' | 'open' | 'minimized';
  isMinimized: boolean;
  zIndex: number;
}

/** Native notifications observe focus; only user requests may ask the OS for it. */
export function useImageViewerFocus<T extends FocusableViewerSession>(
  sessions: T[],
  activeId: string | null,
  setSessions: Dispatch<SetStateAction<T[]>>,
  setActiveId: Dispatch<SetStateAction<string | null>>,
  synchronizeImage: (imageId: string) => void,
) {
  const current = useRef({ sessions, activeId, synchronizeImage });
  const openingImageId = useRef<string | null>(null);
  current.current = { sessions, activeId, synchronizeImage };
  const beginOpening = useCallback((imageId: string) => { openingImageId.current = imageId; }, []);
  const finishOpening = useCallback((imageId: string) => {
    if (openingImageId.current === imageId) openingImageId.current = null;
  }, []);

  const activate = useCallback((modalId: string, requestNativeFocus: boolean) => {
    const state = current.current;
    const target = state.sessions.find((entry) => entry.modalId === modalId);
    if (!target) return;
    if (!requestNativeFocus && openingImageId.current && openingImageId.current !== target.imageId) return;
    if (requestNativeFocus) openingImageId.current = target.nativeStatus === 'pending' ? target.imageId : null;
    const pending = state.sessions.find((entry) => entry.modalId === state.activeId);
    // A previous window can emit focus while the latest open is still loading.
    if (!requestNativeFocus && pending?.nativeStatus === 'pending' && pending.modalId !== modalId) return;
    if (requestNativeFocus && target.host === 'detached') {
      void window.electronAPI?.imageViewerWindowAction({ sessionId: target.sessionId, action: 'restore' }).catch(() => undefined);
    }
    current.current.activeId = modalId;
    setActiveId(modalId);
    setSessions((entries) => {
      const entry = entries.find((candidate) => candidate.modalId === modalId);
      if (!entry) return entries;
      const highest = Math.max(...entries.map((candidate) => candidate.zIndex));
      if (!entry.isMinimized && entry.zIndex === highest) return entries;
      return entries.map((candidate) => candidate.modalId === modalId
        ? { ...candidate, zIndex: highest + 1, isMinimized: false,
          nativeStatus: candidate.host === 'detached' && candidate.nativeStatus !== 'pending' ? 'open' : candidate.nativeStatus }
        : candidate);
    });
    state.synchronizeImage(target.imageId);
  }, [setActiveId, setSessions]);

  const requestActivation = useCallback((modalId: string) => activate(modalId, true), [activate]);
  const observeActivation = useCallback((modalId: string) => activate(modalId, false), [activate]);
  return { requestActivation, observeActivation, beginOpening, finishOpening };
}

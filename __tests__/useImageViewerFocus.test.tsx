import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageViewerFocus, type FocusableViewerSession } from '../hooks/useImageViewerFocus';
import { viewerLibrarySelection } from '../utils/viewerLibrarySelection';
import type { IndexedImage } from '../types';

const images = ['a', 'b', 'c'].map((id) => ({ id, name: `${id}.png` } as IndexedImage));
const session = (id: string, zIndex: number, nativeStatus: 'pending' | 'open' = 'open'): FocusableViewerSession => ({
  modalId: id, sessionId: id, imageId: id, host: 'detached', zIndex, nativeStatus, isMinimized: false,
});

function useHarness(initialSessions = [session('a', 60), session('b', 61)], initialActive = 'b') {
  const [sessions, setSessions] = useState(initialSessions);
  const [active, setActive] = useState<string | null>(initialActive);
  const [library, setLibrary] = useState({ ...viewerLibrarySelection(images[1], images), selectedImages: new Set(['a', 'c']) });
  const focus = useImageViewerFocus(sessions, active, setSessions, setActive, (id) => {
    const image = images.find((candidate) => candidate.id === id);
    if (image) setLibrary((state) => ({ ...state, ...viewerLibrarySelection(image, images) }));
  });
  return { ...focus, sessions, setSessions, active, setActive, library };
}

describe('viewer focus and authoritative library selection', () => {
  let nativeAction: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    nativeAction = vi.fn(async () => ({ success: true }));
    window.electronAPI = { imageViewerWindowAction: nativeAction } as unknown as Window['electronAPI'];
  });
  afterEach(() => { delete window.electronAPI; });

  it('observes native focus without emitting restore/focus IPC and is idempotent', () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.observeActivation('a'));
    const sessions = result.current.sessions;
    expect(result.current.active).toBe('a');
    expect(result.current.library.previewImage.id).toBe('a');
    expect(result.current.library.selectedImage.id).toBe('a');
    expect(result.current.library.focusedImageIndex).toBe(0);
    act(() => result.current.observeActivation('a'));
    expect(result.current.sessions).toBe(sessions);
    expect(nativeAction).not.toHaveBeenCalled();
    expect(result.current.library.selectedImages).toEqual(new Set(['a', 'c']));
  });

  it('requests an existing viewer once; the native notification never requests it back', () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.requestActivation('a'));
    act(() => result.current.observeActivation('a'));
    expect(nativeAction).toHaveBeenCalledExactlyOnceWith({ sessionId: 'a', action: 'restore' });
    expect(result.current.sessions).toHaveLength(2);
  });

  it('ignores old-window focus while the latest opening is pending', () => {
    const { result } = renderHook(() => useHarness([session('a', 60), session('b', 61, 'pending')]));
    act(() => result.current.observeActivation('a'));
    expect(result.current.active).toBe('b');
    expect(result.current.library.previewImage.id).toBe('b');
    act(() => result.current.observeActivation('b'));
    expect(result.current.sessions[1].nativeStatus).toBe('pending');
    expect(nativeAction).not.toHaveBeenCalled();
    act(() => result.current.setSessions((entries) => entries.map((entry) => ({ ...entry, nativeStatus: 'open' }))));
    act(() => result.current.observeActivation('a'));
    expect(result.current.active).toBe('a');
  });

  it('protects a new click before React has registered its session, and releases a failed opening', () => {
    const { result } = renderHook(() => useHarness([session('a', 60)], 'a'));
    act(() => {
      result.current.beginOpening('b');
      result.current.observeActivation('a');
    });
    expect(result.current.library.previewImage.id).toBe('b');
    act(() => result.current.finishOpening('a'));
    act(() => result.current.observeActivation('a'));
    expect(result.current.library.previewImage.id).toBe('b');
    act(() => result.current.finishOpening('b'));
    act(() => result.current.observeActivation('a'));
    expect(result.current.library.previewImage.id).toBe('a');
    expect(nativeAction).not.toHaveBeenCalled();
  });

  it('records an explicit activation of a pending viewer without marking it ready', () => {
    const { result } = renderHook(() => useHarness([session('a', 60, 'pending'), session('b', 61)]));
    act(() => result.current.requestActivation('a'));
    expect(nativeAction).toHaveBeenCalledExactlyOnceWith({ sessionId: 'a', action: 'restore' });
    expect(result.current.sessions.find((entry) => entry.modalId === 'a')?.nativeStatus).toBe('pending');
    expect(result.current.active).toBe('a');
    act(() => result.current.observeActivation('b'));
    expect(result.current.active).toBe('a');
  });

  it('navigation in B follows its new image without altering A; closing keeps the preview', () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.setSessions((entries) => entries.map((entry) => entry.modalId === 'b' ? { ...entry, imageId: 'c' } : entry)));
    act(() => result.current.observeActivation('b'));
    expect(result.current.library.previewImage.id).toBe('c');
    expect(result.current.library.focusedImageIndex).toBe(2);
    expect(result.current.sessions[0].imageId).toBe('a');
    act(() => {
      result.current.setSessions((entries) => entries.filter((entry) => entry.modalId !== 'b'));
      result.current.setActive(null);
    });
    expect(result.current.library.previewImage.id).toBe('c');
    act(() => result.current.observeActivation('b'));
    expect(result.current.library.previewImage.id).toBe('c');
    act(() => result.current.observeActivation('a'));
    expect(result.current.library.previewImage.id).toBe('a');
  });

  it('does not invent an index for a viewer image outside the displayed scope', () => {
    expect(viewerLibrarySelection(images[2], images.slice(0, 2))).toEqual({
      selectedImage: images[2], previewImage: images[2], focusedImageIndex: -1,
    });
  });
});

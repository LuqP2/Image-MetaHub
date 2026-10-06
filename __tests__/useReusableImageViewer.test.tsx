import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReusableImageViewer } from '../hooks/useReusableImageViewer';
import { useImageViewerFocus } from '../hooks/useImageViewerFocus';
import type { ImageViewerNavigationSource } from '../services/imageViewerContracts';

const session = (id: string, zIndex = 60) => ({
  modalId: id, sessionId: id, imageId: id, host: 'detached' as 'detached' | 'inline',
  nativeStatus: 'open' as 'open' | 'pending' | 'minimized', isMinimized: false, zIndex,
  navigationImageIds: ['a', 'b'], navigationSource: 'filtered' as ImageViewerNavigationSource,
  windowState: { x: 20, y: 30, width: 800, height: 600 },
});
const request = (imageId: string) => ({ imageId, navigationImageIds: ['b', 'c'], navigationSource: 'scope' as const });

function useHarness(enabled = true, initial = [session('a')], initialActive: string | null = 'a') {
  const [sessions, setSessions] = useState(initial);
  const [active, setActive] = useState(initialActive);
  const [selected, setSelected] = useState('a');
  const focus = useImageViewerFocus(sessions, active, setSessions, setActive, setSelected);
  const reuse = useReusableImageViewer(enabled, sessions, active, setSessions, setActive, setSelected, focus.requestActivation);
  return { sessions, active, selected, reuse, ...focus };
}

describe('reuse a detached image viewer', () => {
  let nativeAction: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    nativeAction = vi.fn(async () => ({ success: true }));
    window.electronAPI = { imageViewerWindowAction: nativeAction } as unknown as Window['electronAPI'];
  });
  afterEach(() => { delete window.electronAPI; });

  it('changes the image and navigation while preserving the native session and geometry', () => {
    const { result } = renderHook(() => useHarness());
    act(() => { expect(result.current.reuse(request('b'))).toBe('a'); });
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0]).toMatchObject({
      modalId: 'a', sessionId: 'a', imageId: 'b', navigationImageIds: ['b', 'c'],
      navigationSource: 'scope', windowState: session('a').windowState,
    });
    expect(result.current.selected).toBe('b');
    expect(nativeAction).toHaveBeenCalledExactlyOnceWith({ sessionId: 'a', action: 'restore' });
    act(() => result.current.observeActivation('a'));
    expect(result.current.selected).toBe('b');
    expect(nativeAction).toHaveBeenCalledTimes(1);
  });

  it('leaves independent openings available when disabled or after closing the only viewer', () => {
    const disabled = renderHook(() => useHarness(false));
    act(() => { expect(disabled.result.current.reuse(request('b'))).toBeNull(); });
    expect(disabled.result.current.sessions[0].imageId).toBe('a');
    const empty = renderHook(() => useHarness(true, [], null));
    act(() => { expect(empty.result.current.reuse(request('b'))).toBeNull(); });
    expect(nativeAction).not.toHaveBeenCalled();
  });

  it('uses the active viewer, or the most recently raised viewer when main has focus', () => {
    const active = renderHook(() => useHarness(true, [session('a'), session('b', 61)], 'a'));
    act(() => { expect(active.result.current.reuse(request('c'))).toBe('a'); });
    expect(active.result.current.sessions[1].imageId).toBe('b');
    const latest = renderHook(() => useHarness(true, [session('a'), session('b', 61)], null));
    act(() => { expect(latest.result.current.reuse(request('c'))).toBe('b'); });
  });

  it('activates the window already displaying the requested image without creating duplicates', () => {
    const { result } = renderHook(() => useHarness(true, [session('a'), session('b', 61)]));
    act(() => { expect(result.current.reuse(request('b'))).toBe('b'); });
    expect(result.current.sessions.map((entry) => entry.imageId)).toEqual(['a', 'b']);
  });

  it('keeps rapid replacements on the same pending native window and selects the latest image', () => {
    const { result } = renderHook(() => useHarness(true, [{ ...session('a'), nativeStatus: 'pending' }]));
    act(() => {
      result.current.reuse(request('b'));
      result.current.reuse(request('c'));
    });
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0]).toMatchObject({ sessionId: 'a', imageId: 'c', nativeStatus: 'pending' });
    expect(result.current.selected).toBe('c');
    expect(nativeAction).toHaveBeenCalledTimes(1);
  });

  it('restores a minimized viewer, and keeps background openings minimized without stealing focus', () => {
    const { result } = renderHook(() => useHarness(true, [{ ...session('a'), isMinimized: true, nativeStatus: 'minimized' }]));
    act(() => result.current.reuse(request('b')));
    expect(result.current.sessions[0]).toMatchObject({ imageId: 'b', isMinimized: false, nativeStatus: 'open' });
    nativeAction.mockClear();
    act(() => result.current.reuse({ ...request('c'), isMinimized: true }));
    expect(result.current.sessions[0]).toMatchObject({ imageId: 'c', isMinimized: true, nativeStatus: 'minimized' });
    expect(result.current.selected).toBe('b');
    expect(nativeAction).not.toHaveBeenCalled();
  });

  it('preserves inline fallbacks and independent slideshow playback', () => {
    const fallback = renderHook(() => useHarness(true, [{ ...session('a'), host: 'inline' }]));
    act(() => { expect(fallback.result.current.reuse(request('a'))).toBeNull(); });
    const slideshow = renderHook(() => useHarness(true, [{ ...session('a'), navigationSource: 'slideshow' }]));
    act(() => { expect(slideshow.result.current.reuse(request('b'))).toBeNull(); });
    expect(nativeAction).not.toHaveBeenCalled();
  });
});

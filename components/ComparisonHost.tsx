import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ComparisonSurface } from './ComparisonSurface';
import { useImageStore } from '../store/useImageStore';
import { useComparisonUIStore, defaultComparisonUI } from '../store/useComparisonUIStore';
import { useGenerateWithA1111 } from '../hooks/useGenerateWithA1111';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import type { ComparisonModalProps } from '../types';
import type { ComparisonSnapshot } from '../services/comparisonContracts';
type NativeComparisonSession = { id: string; phase: 'opening' | 'detached' };
export default function ComparisonHost({ isOpen, onClose }: ComparisonModalProps) {
  const images = useImageStore(state => state.comparisonImages);
  const directories = useImageStore(state => state.directories);
  const detached = useImageStore(state => state.isComparisonDetached);
  const setDetached = useImageStore(state => state.setComparisonDetached);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const session = useRef<NativeComparisonSession | null>(null);
  const mounted = useRef(true);
  const { generateWithA1111 } = useGenerateWithA1111();
  const { canUseComparison, showProModal } = useFeatureAccess();
  const snapshot = (sessionId: string): ComparisonSnapshot => ({ sessionId, images: images.map(({ handle: _handle, thumbnailHandle: _thumbnailHandle, thumbnailUrl: _thumbnailUrl, ...image }) => image), directories: directories.filter(directory => images.some(image => image.directoryId === directory.id)).map(({ handle: _handle, ...directory }) => directory), ui: useComparisonUIStore.getState().ui });
  const cancelSession = useCallback(() => {
    const previous = session.current;
    // Invalidate before IPC so late events/completions cannot act on a new comparison.
    session.current = null;
    setOpening(false); setDetached(false);
    if (previous) void window.electronAPI?.comparison?.close(previous.id);
  }, [setDetached]);
  const close = useCallback(() => {
    cancelSession(); setError(''); useImageStore.getState().clearComparison(); onClose();
  }, [cancelSession, onClose]);
  useEffect(() => {
    useComparisonUIStore.setState({ ui: defaultComparisonUI() });
    mounted.current = true;
    return () => {
      mounted.current = false;
      const previous = session.current; session.current = null;
      setDetached(false);
      if (previous) void window.electronAPI?.comparison?.close(previous.id);
    };
  }, [setDetached]);
  useEffect(() => window.electronAPI?.comparison?.onEvent(event => {
    if (!session.current || event.sessionId !== session.current.id) return;
    if (event.type === 'command') {
      const command = event.command;
      if (command.type === 'ui') useComparisonUIStore.setState({ ui: command.ui });
      else if (command.type === 'swap') useImageStore.getState().swapComparisonImages();
      else if (command.type === 'generate') { const image = useImageStore.getState().comparisonImages.find(image => image.id === command.request.imageId); if (image) void generateWithA1111(image, command.request.metadata, command.request.numberOfImages); }
      else if (command.type === 'remove') useImageStore.getState().removeImageFromComparison(command.index);
    } else {
      session.current = null; setOpening(false); setDetached(false);
      if (event.type === 'closed') close();
      if (event.type === 'failed') setError(event.error || 'Comparison window failed.');
    }
  }), [close, generateWithA1111, setDetached]);
  useEffect(() => {
    if (!session.current) return;
    if (isOpen && images.length < 2) close();
    else if (!isOpen) cancelSession();
  }, [isOpen, images, cancelSession, close]);
  useEffect(() => {
    const current = session.current;
    if (!detached || current?.phase !== 'detached' || !isOpen || images.length < 2) return;
    void window.electronAPI?.comparison?.update(snapshot(current.id));
  }, [detached, isOpen, images, directories]);
  useEffect(() => { if (!isOpen && !detached) useComparisonUIStore.setState({ ui: defaultComparisonUI() }); }, [isOpen, detached]);
  const detach = async () => {
    const api = window.electronAPI?.comparison;
    if (!api || session.current || !isOpen || images.length < 2) return;
    if (!canUseComparison) { showProModal('comparison'); return; }
    const request: NativeComparisonSession = { id: crypto.randomUUID(), phase: 'opening' };
    session.current = request; setOpening(true); setError('');
    try {
      const result = await api.open(snapshot(request.id));
      if (!mounted.current || session.current !== request) return;
      if (result.success) { request.phase = 'detached'; setDetached(true); }
      else { session.current = null; setError(result.error || 'Could not open comparison window.'); }
      setOpening(false);
    } catch (cause) {
      if (!mounted.current || session.current !== request) return;
      session.current = null; setOpening(false);
      setError(cause instanceof Error ? cause.message : 'Could not open comparison window.');
    }
  };
  if (detached) return null;
  return <><ComparisonSurface isOpen={isOpen} onClose={close} onDetach={window.electronAPI?.comparison && !opening ? () => void detach() : undefined} />{isOpen && (error || opening) && <div role={error ? 'alert' : 'status'} className="fixed bottom-4 left-4 z-[150] rounded border border-gray-600 bg-gray-900 px-4 py-2 text-sm text-white">{error || 'Opening comparison window…'}</div>}</>;
}

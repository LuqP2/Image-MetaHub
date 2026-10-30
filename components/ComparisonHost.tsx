import React, { useEffect, useRef, useState } from 'react';
import { ComparisonSurface } from './ComparisonSurface';
import { useImageStore } from '../store/useImageStore';
import { useComparisonUIStore, defaultComparisonUI } from '../store/useComparisonUIStore';
import { useGenerateWithA1111 } from '../hooks/useGenerateWithA1111';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import type { ComparisonModalProps } from '../types';
import type { ComparisonSnapshot } from '../services/comparisonContracts';
export default function ComparisonHost({ isOpen, onClose }: ComparisonModalProps) {
  const images = useImageStore(state => state.comparisonImages);
  const directories = useImageStore(state => state.directories);
  const [detached, setDetached] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const sessionId = useRef('');
  const mounted = useRef(true);
  const { generateWithA1111 } = useGenerateWithA1111();
  const { canUseComparison, showProModal } = useFeatureAccess();
  const snapshot = (): ComparisonSnapshot => ({ sessionId: sessionId.current, images: images.map(({ handle: _handle, thumbnailHandle: _thumbnailHandle, thumbnailUrl: _thumbnailUrl, ...image }) => image), directories: directories.filter(directory => images.some(image => image.directoryId === directory.id)).map(({ handle: _handle, ...directory }) => directory), ui: useComparisonUIStore.getState().ui });
  const close = () => { useImageStore.getState().clearComparison(); onClose(); };
  useEffect(() => {
    useComparisonUIStore.setState({ ui: defaultComparisonUI() });
    mounted.current = true;
    return () => { mounted.current = false; if (sessionId.current) void window.electronAPI?.comparison?.close(sessionId.current); };
  }, []);
  useEffect(() => window.electronAPI?.comparison?.onEvent(event => {
    if (event.type === 'command') {
      const command = event.command;
      if (command.type === 'ui') useComparisonUIStore.setState({ ui: command.ui });
      else if (command.type === 'swap') useImageStore.getState().swapComparisonImages();
      else if (command.type === 'generate') { const image = useImageStore.getState().comparisonImages.find(image => image.id === command.request.imageId); if (image) void generateWithA1111(image, command.request.metadata, command.request.numberOfImages); }
      else if (command.type === 'remove') useImageStore.getState().removeImageFromComparison(command.index);
    } else {
      sessionId.current = ''; setDetached(false);
      if (event.type === 'closed') close();
      if (event.type === 'failed') setError(event.error || 'Comparison window failed.');
    }
  }), [onClose, generateWithA1111]);
  useEffect(() => {
    if (!detached) return;
    if (!isOpen || images.length < 2) { void window.electronAPI?.comparison?.close(sessionId.current); return; }
    void window.electronAPI?.comparison?.update(snapshot());
  }, [detached, isOpen, images, directories]);
  useEffect(() => { if (!isOpen && !detached) useComparisonUIStore.setState({ ui: defaultComparisonUI() }); }, [isOpen, detached]);
  const detach = async () => {
    const api = window.electronAPI?.comparison;
    if (!api || opening) return;
    if (!canUseComparison) { showProModal('comparison'); return; }
    setOpening(true); setError(''); sessionId.current = crypto.randomUUID();
    try {
      const result = await api.open(snapshot());
      if (!mounted.current) { void api.close(sessionId.current); return; }
      if (result.success) setDetached(true);
      else { sessionId.current = ''; setError(result.error || 'Could not open comparison window.'); }
    } catch (cause) { sessionId.current = ''; setError(cause instanceof Error ? cause.message : 'Could not open comparison window.'); }
    finally { if (mounted.current) setOpening(false); }
  };
  if (detached) return null;
  return <><ComparisonSurface isOpen={isOpen} onClose={close} onDetach={window.electronAPI?.comparison && !opening ? () => void detach() : undefined} />{isOpen && (error || opening) && <div role={error ? 'alert' : 'status'} className="fixed bottom-4 left-4 z-[150] rounded border border-gray-600 bg-gray-900 px-4 py-2 text-sm text-white">{error || 'Opening comparison window…'}</div>}</>;
}

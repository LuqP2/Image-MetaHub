import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../../../components/boards/board.css';
import BoardCanvas from '../../../components/boards/BoardCanvas';
import { BoardEditorContext } from '../../../components/boards/BoardEditorContext';
import { useBoardStore } from '../../../store/useBoardStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { createBoardDocument } from '../../../services/boards/document.mjs';
import type { BoardAssetObject, BoardObject } from '../../../services/boards/types';
const card = (id: string, x: number, y: number): BoardAssetObject => ({ id, type: 'asset', mediaType: 'image', x, y, width: 100, height: 100, frameId: null, zIndex: 1, name: id, visibleFields: [], reference: { kind: 'path', locator: { imageId: id, directoryPath: null, relativePath: `${id}.png` } } });
const board = { ...createBoardDocument(), objects: [card('moving', 100, 100), card('target', 400, 300)] };
useBoardStore.getState().adoptBoard(board);
useBoardStore.getState().setSelection(board.id, ['moving']);
useSettingsStore.setState({ canvasSmartGuides: true, canvasSnapToGrid: false });
document.documentElement.style.cssText = '--gray-900:17 24 39;--gray-800:31 41 55;--gray-700:55 65 81;--gray-400:156 163 175;--gray-200:229 231 235;--gray-100:243 244 246;--accent:96 165 250;color:#e5e7eb;background:#111827;font-family:sans-serif';
const diagnostics = { uninitialized: 0 };
function Diagnostics() {
  const store = useStoreApi();
  useEffect(() => { Object.assign(window, { beginFlowDiagnostics: () => { store.setState({ onError: (code) => { if (code === '015') diagnostics.uninitialized++; } }); } }); }, [store]);
  return null;
}
createRoot(document.getElementById('root')!).render(<ReactFlowProvider><Diagnostics/><BoardEditorContext.Provider value={{ editable: true, connecting: false, begin: () => useBoardStore.getState().beginInteraction(board.id), change() {}, commit() {}, cancel() {} }}><div style={{ width: '100vw', height: '100vh' }}><BoardCanvas boardId={board.id}/></div></BoardEditorContext.Provider></ReactFlowProvider>);
Object.assign(window, { snappingSmoke: {
  reset: (mode: string) => {
    const frame: BoardObject = { id: 'frame', type: 'frame', x: 50, y: 50, width: 200, height: 500, frameId: null, zIndex: 0, title: 'Frame', color: '#6366f1' };
    const moving = card('moving', 100, 100);
    const second: BoardObject = mode === 'mixed' ? { ...card('second', 100, 450), type: 'text', text: 'Text', fontSize: 24, color: '#ffffff' } : card('second', 100, 450);
    const framed = mode === 'framed';
    useBoardStore.getState().adoptBoard({ ...board, objects: [...(framed ? [frame] : []), { ...moving, frameId: framed ? 'frame' : null }, { ...second, frameId: framed ? 'frame' : null }, card('target', 400, 300)] });
    useBoardStore.getState().setSelection(board.id, ['moving', 'second']);
  },
  positions: () => useBoardStore.getState().sessions[board.id].document.objects,
  diagnostics: () => diagnostics,
  position: () => useBoardStore.getState().sessions[board.id].document.objects.find(object => object.id === 'moving'),
  history: () => useBoardStore.getState().sessions[board.id].past.length,
  guides: () => [...document.querySelectorAll('[aria-label="Smart Guides"] line')].map(line => line.getAttribute('data-axis')),
  undo: () => useBoardStore.getState().undo(board.id),
  redo: () => useBoardStore.getState().redo(board.id),
} });

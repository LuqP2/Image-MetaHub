import { useEffect, useRef } from 'react';
import { copyBoardSelection, pasteBoardSelection, deleteBoardSelection, duplicateBoardSelection } from '../../services/boards/commands';
import { arrangeObjectsInGrid, createFrame } from '../../services/boards/operations';
import { useBoardStore } from '../../store/useBoardStore';
import type { BoardPoint } from '../../services/boards/layout';
import type { BoardTool } from '../../services/boards/types';
import BoardSelectionStyles from './BoardSelectionStyles';
import { useBoardEditor } from './BoardEditorContext';
import { useBoardUIStore } from '../../store/useBoardUIStore';

export const creationTools = ['sticky', 'text', 'rectangle', 'ellipse', 'diamond', 'frame'] as const;
export interface BoardMenuPosition { x: number; y: number; point: BoardPoint; kind: 'pane' | 'selection' | 'edge' | 'create' }
export default function BoardContextMenu({ boardId, menu, close, create, fit }: { boardId: string; menu: BoardMenuPosition; close(): void; create(tool: BoardTool, point: BoardPoint): void; fit(): void }) {
  const editor = useBoardEditor();
  const root = useRef<HTMLDivElement>(null);
  const session = useBoardStore(state => state.sessions[boardId]);
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [close]);
  const run = (action: () => unknown) => { try { Promise.resolve(action()).catch(error => editor.reportError?.(String(error.message ?? error))); } catch (error) { editor.reportError?.(error instanceof Error ? error.message : String(error)); } close(); };
  const button = (label: string, action: () => unknown, disabled = false) => <button role="menuitem" className="board-button" disabled={disabled} onClick={() => run(action)}>{label}</button>;
  return <div ref={root} className="board-context-menu" role="menu" aria-label="Canvas actions" style={{ left: Math.max(4, Math.min(menu.x, window.innerWidth - 260)), top: Math.max(4, Math.min(menu.y, window.innerHeight - 480)) }} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }}>
    {menu.kind === 'selection' && <>{button('Copy', () => copyBoardSelection(boardId))}{button('Cut', () => copyBoardSelection(boardId, true), !editor.editable)}{button('Duplicate', () => duplicateBoardSelection(boardId), !editor.editable)}{button('Arrange in grid', () => useBoardStore.getState().executeOperation(boardId, doc => arrangeObjectsInGrid(doc, session.selectedObjectIds)), !editor.editable)}{button('Create frame', () => useBoardStore.getState().executeOperation(boardId, doc => createFrame(doc, session.selectedObjectIds)), !editor.editable)}{button('Export selection as PNG', () => editor.exportPng?.(true))}</>}
    {menu.kind === 'edge' && button('Edit connection', () => { useBoardUIStore.getState().setInspectorOpen(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.board-inspector input')?.focus()); }, !editor.editable)}
    {(menu.kind === 'selection' || menu.kind === 'edge') && button('Delete', () => deleteBoardSelection(boardId), !editor.editable)}
    {menu.kind !== 'create' && button('Paste', () => pasteBoardSelection(boardId, menu.point), !editor.editable)}
    {(menu.kind === 'pane' || menu.kind === 'create') && <>{creationTools.map(tool => <button role="menuitem" className="board-button" disabled={!editor.editable} key={tool} onClick={() => run(() => create(tool, menu.point))}>Create {tool}</button>)}{menu.kind === 'pane' && <>{button('Select all', () => useBoardStore.getState().setSelection(boardId, session.document.objects.map(object => object.id)))}{button('Fit board', fit)}{button('Export board as PNG', () => editor.exportPng?.(false))}</>}</>}
    {menu.kind === 'selection' && <BoardSelectionStyles boardId={boardId} editable={editor.editable} />}
  </div>;
}

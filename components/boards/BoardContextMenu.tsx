import { Copy, Scissors, CopyPlus, Clipboard, Grid2X2, Frame, Download, Layers, Ungroup, Pencil, Trash2, Scan, MousePointer2, StickyNote, Type, Square, Circle, Diamond, Sparkles, type LucideIcon } from 'lucide-react';
import { visualGroupingCandidates } from '../../services/boards/visualGroupOperations';
import { createStack, unstack } from '../../services/boards/stackOperations';
import { stackableImages } from '../../services/boards/stackMembership';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
export default function BoardContextMenu({ boardId, menu, close, create, fit, autoGroup }: { boardId: string; menu: BoardMenuPosition; close(): void; create(tool: BoardTool, point: BoardPoint): void; fit(): void; autoGroup?(ids?: string[]): void }) {
  const editor = useBoardEditor();
  const root = useRef<HTMLDivElement>(null);
  const session = useBoardStore(state => state.sessions[boardId]);
  const [position, setPosition] = useState({ left: menu.x, top: menu.y });
  useLayoutEffect(() => {
    const measure = () => {
      const bounds = root.current?.getBoundingClientRect();
      if (!bounds) return;
      setPosition({ left: Math.max(4, Math.min(menu.x, window.innerWidth - bounds.width - 4)), top: Math.max(4, Math.min(menu.y, window.innerHeight - bounds.height - 4)) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [menu.x, menu.y, menu.kind, session.selectedObjectIds.length]);
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [close]);
  const run = (action: () => unknown) => { try { Promise.resolve(action()).catch(error => editor.reportError?.(String(error.message ?? error))); } catch (error) { editor.reportError?.(error instanceof Error ? error.message : String(error)); } close(); };
  const shortcuts: Record<string, string> = { Copy: 'C', Cut: 'X', Duplicate: 'D', Paste: 'V', 'Select all': 'A' };
  const commandKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  const icons: Record<string, LucideIcon> = { Copy, Cut: Scissors, Duplicate: CopyPlus, Paste: Clipboard, 'Arrange in grid': Grid2X2, 'Create frame': Frame, 'Export selection as PNG': Download, 'Export board as PNG': Download, Stack: Layers, Unstack: Ungroup, 'Edit connection': Pencil, Delete: Trash2, 'Select all': MousePointer2, 'Fit board': Scan, 'Auto-group by visual similarity': Sparkles };
  const creationIcons = { sticky: StickyNote, text: Type, rectangle: Square, ellipse: Circle, diamond: Diamond, frame: Frame };
  const button = (label: string, action: () => unknown, disabled = false) => {
    const Icon = icons[label] ?? Pencil;
    return <button role="menuitem" aria-label={label} className={`board-menu-item${label === 'Delete' ? ' board-menu-item--danger' : ''}`} disabled={disabled} onClick={() => run(action)}><Icon size={15} aria-hidden="true"/><span>{label}</span>{shortcuts[label] && <kbd>{commandKey}{shortcuts[label]}</kbd>}{label === 'Delete' && <kbd>Delete</kbd>}</button>;
  };
  return createPortal(<div ref={root} className="board-context-menu" role="menu" aria-label="Canvas actions" style={position} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (!(event.target as HTMLElement).closest('input, select, textarea') && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }}>
    {menu.kind === 'selection' && <>{button('Copy', () => copyBoardSelection(boardId))}{button('Cut', () => copyBoardSelection(boardId, true), !editor.editable)}{button('Duplicate', () => duplicateBoardSelection(boardId), !editor.editable)}<hr role="separator"/>{button('Arrange in grid', () => useBoardStore.getState().executeOperation(boardId, doc => arrangeObjectsInGrid(doc, session.selectedObjectIds)), !editor.editable)}{button('Create frame', () => useBoardStore.getState().executeOperation(boardId, doc => createFrame(doc, session.selectedObjectIds)), !editor.editable)}{button('Export selection as PNG', () => editor.exportPng?.(true))}</>}
    {menu.kind === 'selection' && stackableImages(session.document, session.selectedObjectIds) && button('Stack', () => {
      const previous = new Set(session.document.objects.map(object => object.id));
      useBoardStore.getState().executeOperation(boardId, document => createStack(document, session.selectedObjectIds));
      const stack = useBoardStore.getState().sessions[boardId].document.objects.find(object => !previous.has(object.id) && object.type === 'stack');
      if (stack) useBoardStore.getState().setSelection(boardId, [stack.id]);
    }, !editor.editable)}
    {menu.kind === 'selection' && session.selectedObjectIds.length === 1 && session.document.objects.some(object => object.id === session.selectedObjectIds[0] && object.type === 'stack') && button('Unstack', () => useBoardStore.getState().executeOperation(boardId, document => unstack(document, session.selectedObjectIds[0])), !editor.editable)}
    {menu.kind === 'edge'  && button('Edit connection', () => { useBoardUIStore.getState().setInspectorOpen(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.board-inspector input')?.focus()); }, !editor.editable)}
    {menu.kind !== 'create' && <hr role="separator"/>}
    {menu.kind !== 'create' && button('Paste', () => pasteBoardSelection(boardId, menu.point), !editor.editable)}
    {(menu.kind === 'pane' || menu.kind === 'create') && <>{creationTools.map(tool => { const Icon = creationIcons[tool]; return <button role="menuitem" className="board-menu-item" disabled={!editor.editable} key={tool} onClick={() => run(() => create(tool, menu.point))}><Icon size={15} aria-hidden="true"/><span>{tool[0].toUpperCase() + tool.slice(1)}</span></button>; })}<hr role="separator"/>{menu.kind === 'pane' && <>{button('Select all', () => useBoardStore.getState().setSelection(boardId, session.document.objects.map(object => object.id)))}{button('Fit board', fit)}{button('Export board as PNG', () => editor.exportPng?.(false))}</>}</>}
    {(menu.kind === 'pane' || menu.kind === 'selection') && autoGroup && button('Auto-group by visual similarity', () => autoGroup(menu.kind === 'selection' ? [...session.selectedObjectIds] : undefined), !editor.editable || visualGroupingCandidates(session.document, menu.kind === 'selection' ? session.selectedObjectIds : undefined).length < 2)}
    {(menu.kind === 'selection' || menu.kind === 'edge') && <><hr role="separator"/>{button('Delete', () => deleteBoardSelection(boardId), !editor.editable)}</>}
    {menu.kind === 'selection' && <BoardSelectionStyles boardId={boardId} editable={editor.editable} />}
  </div>, document.body);
}

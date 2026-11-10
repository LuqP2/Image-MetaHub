import type { ReactNode } from 'react';
import type { BoardTool } from '../../services/boards/types';
import { useBoardQueryActions } from './BoardQueryContext';
import { MousePointer2, Type, Frame, Undo2, Redo2, PanelLeft, PanelRight, Download, StickyNote, Square, Circle, Diamond, GitBranch, Play } from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';
import { useSettingsStore } from '../../store/useSettingsStore';
export function BoardDocumentBar({ boardId, tabs, onExport, libraryOpen, inspectorOpen, onToggleLibrary, onToggleInspector, libraryLocked }: {
  boardId: string; tabs: ReactNode; onExport(): void; libraryOpen: boolean; inspectorOpen: boolean;
  onToggleLibrary(): void; onToggleInspector(): void; libraryLocked?: boolean;
}) {
  const session = useBoardStore(state => state.sessions[boardId]);
  return <div className="board-header"><div className="board-document-bar">
    <button className="board-icon-button" aria-label="Toggle library" aria-pressed={libraryOpen} disabled={libraryLocked} title={libraryLocked ? 'Choose or cancel the replacement first' : 'Toggle library'} onClick={onToggleLibrary}><PanelLeft size={16}/></button>
    {tabs}
    <div className="board-document-actions"><span className="board-save-status" role="status">{session.saveStatus === 'saved' ? 'Saved' : session.saveStatus === 'error' ? 'Save failed' : 'Saving…'}</span><button className="board-button board-button--ghost" onClick={onExport}><Download size={15}/>Export</button>
    <button className="board-icon-button" aria-label="Toggle inspector" aria-pressed={inspectorOpen} title="Toggle inspector" onClick={onToggleInspector}><PanelRight size={16}/></button></div>
  </div></div>;
}

export default function BoardToolbar({ boardId, editable, tool, setTool }: {
  boardId: string; editable: boolean; tool: BoardTool; setTool(value: BoardTool): void;
}) {
  const queryActions = useBoardQueryActions();
  const autoplayVideos = useSettingsStore(state => state.canvasAutoplayVideos);
  const session = useBoardStore(state => state.sessions[boardId]);
  return <div className="board-toolbar nodrag nopan nowheel" role="toolbar" aria-label="Board tools">
    <div className="board-toolbar-group scrollbar-thin">{([{ value: 'select', label: 'Select', Icon: MousePointer2 }, { value: 'text', label: 'Text', Icon: Type }, { value: 'sticky', label: 'Sticky', Icon: StickyNote }, { value: 'rectangle', label: 'Rectangle', Icon: Square }, { value: 'ellipse', label: 'Ellipse', Icon: Circle }, { value: 'diamond', label: 'Diamond', Icon: Diamond }, { value: 'connect', label: 'Connect', Icon: GitBranch }, { value: 'frame', label: 'Frame', Icon: Frame }] as const).map(({value,label,Icon}) => <button key={value} className="board-button board-button--ghost board-tool" data-tool={value} aria-label={label} title={value === 'connect' ? 'Connect · Hold Ctrl/Cmd for multiple connections' : label} aria-pressed={tool === value} disabled={value !== 'select' && !editable} onClick={() => setTool(tool === value ? 'select' : value)}><Icon size={16}/><span className="board-tool-label">{label}</span></button>)}
    {queryActions && <button className="board-button board-button--ghost board-smart-frame-tool" aria-label="Smart Frame" title="Smart Frame" disabled={!editable} onClick={queryActions.create}><Frame size={16}/><span className="board-smart-frame-label">Smart Frame</span></button>}
    <button className="board-button board-button--ghost board-autoplay-toggle" aria-label="Autoplay videos" title="Autoplay videos" aria-pressed={autoplayVideos} onClick={() => useSettingsStore.getState().setCanvasAutoplayVideos(!autoplayVideos)}><Play size={16}/><span>Autoplay videos</span></button>
    <button className="board-icon-button" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!editable || !session.past.length} onClick={() => useBoardStore.getState().undo(boardId)}><Undo2 size={16}/></button><button className="board-icon-button" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!editable || !session.future.length} onClick={() => useBoardStore.getState().redo(boardId)}><Redo2 size={16}/></button></div>
  </div>;
}

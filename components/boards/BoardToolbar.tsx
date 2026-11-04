import type { ReactNode } from 'react';
import type { BoardTool } from '../../services/boards/types';
import { useBoardQueryActions } from './BoardQueryContext';
import { MousePointer2, Type, Frame, Undo2, Redo2, PanelLeft, PanelRight, Download, StickyNote, Square, Circle, Diamond, GitBranch } from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';
export default function BoardToolbar({ boardId, editable, tool, setTool, tabs, onExport, libraryOpen, inspectorOpen, onToggleLibrary, onToggleInspector, libraryLocked }: {
  boardId: string; editable: boolean; tool: BoardTool; setTool(value: BoardTool): void;
  tabs: ReactNode; onExport(): void; libraryOpen: boolean; inspectorOpen: boolean; onToggleLibrary(): void; onToggleInspector(): void; libraryLocked?: boolean;
}) {
  const queryActions = useBoardQueryActions();
  const session = useBoardStore(state => state.sessions[boardId]);
  return <div className="board-toolbar" aria-label="Board tools">
    {tabs}
    <div className="board-toolbar-group scrollbar-thin">{([{ value: 'select', label: 'Select', Icon: MousePointer2 }, { value: 'text', label: 'Text', Icon: Type }, { value: 'sticky', label: 'Sticky', Icon: StickyNote }, { value: 'rectangle', label: 'Rectangle', Icon: Square }, { value: 'ellipse', label: 'Ellipse', Icon: Circle }, { value: 'diamond', label: 'Diamond', Icon: Diamond }, { value: 'connect', label: 'Connect', Icon: GitBranch }, { value: 'frame', label: 'Frame', Icon: Frame }] as const).map(({value,label,Icon}) => <button key={value} className="board-button board-button--ghost" aria-label={label} title={label} aria-pressed={tool === value} disabled={value !== 'select' && !editable} onClick={() => setTool(tool === value ? 'select' : value)}><Icon size={16}/><span className="board-tool-label">{label}</span></button>)}
    {queryActions && <button className="board-button" disabled={!editable} onClick={queryActions.create}>Smart Frame</button>}
    <button className="board-icon-button" aria-label="Undo" title="Undo" disabled={!editable || !session.past.length} onClick={() => useBoardStore.getState().undo(boardId)}><Undo2 size={16}/></button><button className="board-icon-button" aria-label="Redo" title="Redo" disabled={!editable || !session.future.length} onClick={() => useBoardStore.getState().redo(boardId)}><Redo2 size={16}/></button></div>
    <div className="board-toolbar-end"><span className="board-save-status" role="status">{session.saveStatus === 'saved' ? 'Saved' : session.saveStatus === 'error' ? 'Save failed' : 'Saving…'}</span><button className="board-icon-button" aria-label="Toggle library" aria-pressed={libraryOpen} disabled={libraryLocked} title={libraryLocked ? 'Choose or cancel the replacement first' : 'Toggle library'} onClick={onToggleLibrary}><PanelLeft size={16}/></button><button className="board-icon-button" aria-label="Toggle inspector" aria-pressed={inspectorOpen} title="Toggle inspector" onClick={onToggleInspector}><PanelRight size={16}/></button><button className="board-button" onClick={onExport}><Download size={15}/>Export</button></div>
  </div>;
}

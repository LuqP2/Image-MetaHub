import { useTranslation } from '../../i18n/useTranslation';
import BoardTooltips from './BoardTooltips';
import type { ReactNode } from 'react';
import type { BoardTool } from '../../services/boards/types';
import { useBoardQueryActions } from './BoardQueryContext';
import { useBoardEditor } from './BoardEditorContext';
import { MousePointer2, Type, Frame, Undo2, Redo2, PanelLeft, PanelRight, Download, StickyNote, Square, Circle, Diamond, GitBranch, Play } from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';
import { useSettingsStore } from '../../store/useSettingsStore';
export function BoardDocumentBar({ boardId, tabs, onExport, libraryOpen, inspectorOpen, onToggleLibrary, onToggleInspector, libraryLocked }: {
  boardId: string; tabs: ReactNode; onExport(): void; libraryOpen: boolean; inspectorOpen: boolean;
  onToggleLibrary(): void; onToggleInspector(): void; libraryLocked?: boolean;
}) {
  const { t } = useTranslation();
  const session = useBoardStore(state => state.sessions[boardId]);
  return <div className="board-header"><div className="board-document-bar">
    <button className="board-icon-button" aria-label={t('canvas.toggleLibrary')} aria-pressed={libraryOpen} disabled={libraryLocked} title={libraryLocked ? t('canvas.replacementFirst') : t('canvas.toggleLibrary')} onClick={onToggleLibrary}><PanelLeft size={16}/></button>
    {tabs}
    <div className="board-document-actions"><span className="board-save-status" role="status">{session.saveStatus === 'saved' ? t('canvas.saved') : session.saveStatus === 'error' ? t('canvas.saveFailed') : t('canvas.saving')}</span><button className="board-button board-button--ghost" onClick={onExport}><Download size={15}/>{t('batchExport.export')}</button>
    <button className="board-icon-button" data-board-toggle-inspector aria-label={t('canvas.toggleInspector')} aria-pressed={inspectorOpen} title={t('canvas.toggleInspector')} onClick={onToggleInspector}><PanelRight size={16}/></button></div>
  </div></div>;
}

export default function BoardToolbar({ boardId, editable, tool, setTool }: {
  boardId: string; editable: boolean; tool: BoardTool; setTool(value: BoardTool): void;
}) {
  const { t } = useTranslation();
  const queryActions = useBoardQueryActions();
  const editor = useBoardEditor();
  const autoplayVideos = useSettingsStore(state => state.canvasAutoplayVideos);
  const session = useBoardStore(state => state.sessions[boardId]);
  return <div className="board-toolbar nodrag nopan nowheel" role="toolbar" aria-label={t('canvas.tools')}>
    <BoardTooltips /><div className="board-toolbar-group scrollbar-thin">{([{ value: 'select', label: t('imageViewer.editor.select'), Icon: MousePointer2 }, { value: 'text', label: t('imageViewer.editor.text'), Icon: Type }, { value: 'sticky', label: t('canvas.sticky'), Icon: StickyNote }, { value: 'rectangle', label: t('imageViewer.editor.rectangle'), Icon: Square }, { value: 'ellipse', label: t('imageViewer.editor.ellipse'), Icon: Circle }, { value: 'diamond', label: t('canvas.diamond'), Icon: Diamond }, { value: 'connect', label: t('canvas.connect'), Icon: GitBranch }, { value: 'frame', label: t('canvas.frame'), Icon: Frame }] as const).map(({value,label,Icon}) => <button key={value} className="board-button board-button--ghost board-tool" data-tool={value} aria-label={label} title={value === 'connect' ? t('canvas.connectHelp') : label} aria-pressed={tool === value} disabled={value !== 'select' && !editable} onClick={() => setTool(tool === value ? 'select' : value)}><Icon size={16}/><span className="board-tool-label">{label}</span></button>)}
    {queryActions && <><span className="board-toolbar-divider" aria-hidden="true" /><button className="board-button board-button--ghost board-smart-frame-tool" aria-label={t('canvas.smartFrame')} title={t('canvas.addSmartFrame')} disabled={!editable} onClick={() => { const center = editor.getVisibleCenter?.(); if (center) { queryActions.create(center); setTool('select'); } }}><Frame size={16}/><span className="board-smart-frame-label">{t('canvas.smartFrame')}</span></button></>}
    <span className="board-toolbar-divider" aria-hidden="true" />
    <button className="board-icon-button board-autoplay-toggle" aria-label={t('canvas.autoplay')} title={t('canvasFeedback.autoplayHint', { state: t(autoplayVideos ? 'canvasFeedback.autoplayOn' : 'canvasFeedback.autoplayOff') })} aria-pressed={autoplayVideos} onClick={() => useSettingsStore.getState().setCanvasAutoplayVideos(!autoplayVideos)}><Play size={16}/><span>{t(autoplayVideos ? 'canvasFeedback.autoplayOn' : 'canvasFeedback.autoplayOff')}</span></button>
    <span className="board-toolbar-divider" aria-hidden="true" />
    <button className="board-icon-button" aria-label={t('settings.native.undo')} title={t('canvas.undoHelp')} disabled={!editable || !session.past.length} onClick={() => useBoardStore.getState().undo(boardId)}><Undo2 size={16}/></button><button className="board-icon-button" aria-label={t('settings.native.redo')} title={t('canvas.redoHelp')} disabled={!editable || !session.future.length} onClick={() => useBoardStore.getState().redo(boardId)}><Redo2 size={16}/></button></div>
  </div>;
}

import { useTranslation } from '../../i18n/useTranslation';
import BoardPromptInspector from './BoardPromptInspector';
import { useBoardConnectionStyleStore, type BoardConnectionStyle } from '../../store/useBoardConnectionStyleStore';
import { BoardColorField, BoardPropertyRow } from './BoardPropertyControls';
import BoardTextStyles from './BoardTextStyles';
import BoardSelectionStyles from './BoardSelectionStyles';
import { deleteBoardSelection } from '../../services/boards/commands';
import { duplicateBoardSelection } from '../../services/boards/commands';
import BoardSmartFrameSelectionActions from './BoardSmartFrameSelectionActions';
import type { BoardSmartFrameObject } from '../../services/boards/queryTypes';
import BoardSmartFrameInspector from './BoardSmartFrameInspector';
import { PanelRightClose } from 'lucide-react';
import { useBoardUIStore } from '../../store/useBoardUIStore';
import Section from './BoardInspectorSection';
import { getBoardDisplayName } from './boardPresentation';
import { type ReactNode } from 'react';
import { useBoardStore } from '../../store/useBoardStore';
import { arrangeObjectsInGrid, updateConnection, updateObjects } from '../../services/boards/operations';
import type { BoardMetadataField } from '../../services/boards/types';

const fields: BoardMetadataField[] = ['model', 'loras', 'seed', 'dimensions', 'generator', 'rating', 'prompt'];
export default function BoardInspector({ boardId, editable, assetActions, assetMetadata, assetStatus, selectionActions, onHide }: { boardId: string; editable: boolean; assetActions?: ReactNode; assetMetadata?: ReactNode; assetStatus?: ReactNode; selectionActions?: ReactNode; onHide?: () => void }) {
  const { t } = useTranslation();
  const session = useBoardStore(state => state.sessions[boardId]);
  const selected = session.document.objects.filter(object => session.selectedObjectIds.includes(object.id));
  const object = selected.length === 1 ? selected[0] : null;
  const connections = session.document.connections.filter(edge => session.selectedConnectionIds.includes(edge.id));
  const connection = connections[0] ?? null;
  const sameWidth = connections.every(edge => (edge.width ?? 1.5) === (connection?.width ?? 1.5));
  const samePattern = connections.every(edge => (edge.lineStyle ?? 'solid') === (connection?.lineStyle ?? 'solid'));
  const sameColor = connections.every(edge => edge.color === connection?.color);
  const applyConnectionStyle = (patch: Partial<BoardConnectionStyle>, continuous = false) => {
    if (!editable) return;
    useBoardConnectionStyleStore.getState().setStyle(patch);
    useBoardStore.getState()[continuous ? 'updateInteraction' : 'executeOperation'](boardId, document => connections.reduce((next, edge) => updateConnection(next, edge.id, patch), document));
  };
  const edit = (property: string, value: string | number) => {
    if (!editable || !object) return;
    useBoardStore.getState().updateInteraction(boardId, document => updateObjects(document, [{ id: object.id, [property]: value }]));
  };
  const commit = () => useBoardStore.getState().commitInteraction(boardId);
  return <aside className="board-inspector" aria-label={t('canvas.inspector')}>
    <header className="board-inspector-header"><div>{(object?.type === 'asset' || object?.type === 'smart-frame' || object?.type === 'link' || (!object && !connection)) && <small>{object?.type === 'smart-frame' ? t('canvas.smartFrame') : object?.type === 'asset' ? t('canvas.asset') : object?.type === 'link' ? t('canvas.link') : t('canvas.properties')}</small>}<h2 title={object?.type === 'asset' ? getBoardDisplayName(object.name) : undefined}>{object?.type === 'asset' ? getBoardDisplayName(object.name) : object?.type === 'smart-frame' ? object.title : object?.type === 'frame' ? t('canvas.frame') : object?.type === 'text' ? t('imageViewer.editor.text') : object?.type === 'shape' ? t(({ rectangle: 'imageViewer.editor.rectangle', ellipse: 'imageViewer.editor.ellipse', diamond: 'canvas.diamond' } as const)[object.shape]) : object?.type === 'sticky' ? t('canvas.sticky') : object?.type === 'link' ? object.title : object?.type === 'prompt' ? t('librarySearch.prompt') : object?.type === 'stack' ? t('canvas.stack') : connection ? connections.length === 1 ? t('canvas.connection') : t('canvas.connections', { count: connections.length }) : selected.length ? t('canvas.selectedObjects', { count: selected.length }) : t('canvas.boardTitle')}</h2></div><button className="board-icon-button" aria-label={t('canvas.hideInspector')} onClick={onHide ?? (() => useBoardUIStore.getState().setInspectorOpen(false))}><PanelRightClose size={16}/></button></header><div className="board-inspector-content scrollbar-sidebar">{assetStatus}{assetActions}{selectionActions}{assetMetadata && <Section title={t('canvas.metadata')} defaultOpen>{assetMetadata}</Section>}
    {selected.length > 1 && selected.every(item => item.type === 'smart-frame') && <BoardSmartFrameSelectionActions key={selected.map(item => item.id).join('|')} boardId={boardId} frames={selected as BoardSmartFrameObject[]} editable={editable} />}
    {object?.type === 'smart-frame' && <BoardSmartFrameInspector boardId={boardId} frame={object} editable={editable} />}
    {object?.type === 'prompt' && <BoardPromptInspector key={object.id} boardId={boardId} card={object} editable={editable} />}
    <BoardSelectionStyles boardId={boardId} editable={editable} includeText={false} includeTypography={false} />
    {selected.some(item => item.type === 'text' || item.type === 'shape') && <BoardTextStyles boardId={boardId} editable={editable} />}
    {object?.type === 'link' && <><label>{t('imageViewer.collection.title')}<input className="board-input" disabled={!editable} value={object.title} onChange={event => edit('title', event.target.value)} onBlur={commit} /></label><label>URL<input className="board-input" disabled={!editable} defaultValue={object.url} key={object.url} onBlur={event => { try { const url = new URL(event.target.value); if (['http:', 'https:'].includes(url.protocol)) { edit('url', url.href); commit(); } else event.target.value = object.url; } catch { event.target.value = object.url; } }} /></label></>}
    {(object?.type === 'text' || object?.type === 'shape') && <>
      <label className="board-content-field">{t('imageViewer.editor.content')}<textarea aria-label={t('imageViewer.editor.text')} className="board-textarea" disabled={!editable} value={object.text} onChange={event => edit('text', event.target.value)} onBlur={commit} /></label>
    </>}
    {object?.type === 'frame' && <label>{t('imageViewer.collection.title')}<input className="board-input" disabled={!editable} value={object.title} onChange={event => edit('title', event.target.value)} onBlur={commit} /></label>}
    {connection && <>
      <div className="board-inspector-properties"><BoardPropertyRow label={t('metadataEditor.weight')}><div role="group" aria-label={t('canvas.lineThickness')} className="board-line-options">{([1.5, 3, 5] as const).map((width, index) => {
        const current = connection.width ?? 1.5;
        const active = sameWidth && index === (current < 2.25 ? 0 : current < 4 ? 1 : 2);
        return <button key={width} className="board-button" aria-label={[t('canvas.thin'), t('canvas.medium'), t('canvas.thick')][index]} title={t('canvas.lineWidth', { label: [t('canvas.thin'), t('canvas.medium'), t('canvas.thick')][index], width })} disabled={!editable} aria-pressed={active} onClick={() => applyConnectionStyle({ width })}>
          <svg viewBox="0 0 36 10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" stroke="currentColor" strokeWidth={width}/></svg><span>{width} px</span></button>;
      })}</div></BoardPropertyRow>
      <BoardPropertyRow label={t('canvas.pattern')}><div role="group" aria-label={t('canvas.lineStyle')} className="board-line-options">{(['solid', 'dashed'] as const).map(lineStyle => <button key={lineStyle} className="board-button" disabled={!editable} aria-pressed={samePattern && (connection.lineStyle ?? 'solid') === lineStyle} onClick={() => applyConnectionStyle({ lineStyle })}>
        <svg viewBox="0 0 36 10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={lineStyle === 'dashed' ? '6 4' : undefined}/></svg>{lineStyle === 'solid' ? t('canvas.solid') : t('canvas.dashed')}</button>)}</div></BoardPropertyRow>
      {connections.length === 1 && <label className="board-connection-label">{t('canvas.label')}<input className="board-input" disabled={!editable} value={connection.label} onChange={event => useBoardStore.getState().updateInteraction(boardId, document => updateConnection(document, connection.id, { label: event.target.value }))} onBlur={commit} /></label>}
      <BoardPropertyRow label={t('imageViewer.exr.color')}><BoardColorField label={t('canvas.connectionColor')} disabled={!editable} value={connection.color} mixed={!sameColor} onChange={color => applyConnectionStyle({ color }, true)} onBlur={commit}/></BoardPropertyRow></div>
    </>}
    {selected.some(item => item.type === 'asset') && <Section title={t('canvas.showOnCanvas')}><fieldset className="board-field-grid" disabled={!editable}>{fields.map(field => {
      const assets = selected.filter(item => item.type === 'asset');
      const checked = assets.length > 0 && assets.every(asset => asset.visibleFields.includes(field));
      return <label className="board-checkbox" key={field}><input type="checkbox" checked={checked} ref={element => { if(element) element.indeterminate = !checked && assets.some(asset => asset.visibleFields.includes(field)); }} onChange={() => useBoardStore.getState().executeOperation(boardId, document => updateObjects(document, assets.map(asset => ({ id: asset.id, visibleFields: checked ? asset.visibleFields.filter(item => item !== field) : [...new Set([...asset.visibleFields, field])] }))))} />{{model:t('librarySearch.model'),loras:t('comparison.loras'),seed:t('libraryGallery.seed'),dimensions:t('librarySearch.dimensions'),generator:t('librarySearch.generator'),rating:t('librarySearch.rating'),prompt:t('librarySearch.prompt')}[field]}</label>;
    })}</fieldset></Section>}
    {selected.length > 0 && <Section title={t('canvas.arrange')}><div className="board-arrange-grid">
      <button className="board-button" disabled={!editable} onClick={() => duplicateBoardSelection(boardId)}>{t('imageViewer.editor.duplicate')}</button>
      <button className="board-button" disabled={!editable || selected.length < 2} onClick={() => useBoardStore.getState().executeOperation(boardId, doc => arrangeObjectsInGrid(doc, session.selectedObjectIds))}>{t('canvas.arrangeGrid')}</button>
      <button className="board-button" disabled={!editable} onClick={() => useBoardStore.getState().executeOperation(boardId, doc => updateObjects(doc, selected.map(item => ({id:item.id,zIndex:Math.max(0,...doc.objects.map(o=>o.zIndex))+1}))))}>{t('canvas.bringFront')}</button>
      <button className="board-button" disabled={!editable} onClick={() => useBoardStore.getState().executeOperation(boardId, doc => updateObjects(doc, selected.map(item => ({id:item.id,zIndex:Math.min(0,...doc.objects.map(o=>o.zIndex))-1}))))}>{t('canvas.sendBack')}</button>
    </div></Section>}
    {object?.type === 'asset' && <Section title={t('settings.native.file')}><p>{object.reference.locator.relativePath}</p></Section>}
    {(selected.length > 0 || session.selectedConnectionIds.length > 0) && <button className="board-button board-button--danger" disabled={!editable} onClick={() => deleteBoardSelection(boardId)} title={t('canvas.removeHelp')}>{t('canvas.remove')}</button>}
    {!object && !connection && !selected.length && <p>{t('canvas.inspectHelp')}</p>}
  </div></aside>;
}

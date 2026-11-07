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
  return <aside className="board-inspector" aria-label="Board inspector">
    <header className="board-inspector-header"><div>{(object?.type === 'asset' || object?.type === 'smart-frame' || object?.type === 'link' || (!object && !connection)) && <small>{object?.type === 'smart-frame' ? 'Smart Frame' : object?.type ?? 'Properties'}</small>}<h2 title={object?.type === 'asset' ? getBoardDisplayName(object.name) : undefined}>{object?.type === 'asset' ? getBoardDisplayName(object.name) : object?.type === 'smart-frame' ? object.title : object?.type === 'frame' ? 'Frame' : object?.type === 'text' ? 'Text' : object?.type === 'shape' ? object.shape[0].toUpperCase() + object.shape.slice(1) : object?.type === 'sticky' ? 'Sticky' : object?.type === 'link' ? object.title : object?.type === 'stack' ? 'Stack' : connection ? connections.length === 1 ? 'Connection' : `${connections.length} connections` : selected.length ? `${selected.length} ${selected.length === 1 ? 'object' : 'objects'}` : 'Board'}</h2></div><button className="board-icon-button" aria-label="Hide inspector" onClick={onHide ?? (() => useBoardUIStore.getState().setInspectorOpen(false))}><PanelRightClose size={16}/></button></header><div className="board-inspector-content scrollbar-sidebar">{assetStatus}{assetActions}{selectionActions}{assetMetadata && <Section title="Metadata" defaultOpen>{assetMetadata}</Section>}
    {selected.length > 1 && selected.every(item => item.type === 'smart-frame') && <BoardSmartFrameSelectionActions key={selected.map(item => item.id).join('|')} boardId={boardId} frames={selected as BoardSmartFrameObject[]} editable={editable} />}
    {object?.type === 'smart-frame' && <BoardSmartFrameInspector boardId={boardId} frame={object} editable={editable} />}
    <BoardSelectionStyles boardId={boardId} editable={editable} includeText={false} includeTypography={false} />
    {selected.some(item => item.type === 'text' || item.type === 'shape') && <BoardTextStyles boardId={boardId} editable={editable} />}
    {object?.type === 'link' && <><label>Title<input className="board-input" disabled={!editable} value={object.title} onChange={event => edit('title', event.target.value)} onBlur={commit} /></label><label>URL<input className="board-input" disabled={!editable} defaultValue={object.url} key={object.url} onBlur={event => { try { const url = new URL(event.target.value); if (['http:', 'https:'].includes(url.protocol)) { edit('url', url.href); commit(); } else event.target.value = object.url; } catch { event.target.value = object.url; } }} /></label></>}
    {(object?.type === 'text' || object?.type === 'shape') && <>
      <label className="board-content-field">Content<textarea aria-label="Text" className="board-textarea" disabled={!editable} value={object.text} onChange={event => edit('text', event.target.value)} onBlur={commit} /></label>
    </>}
    {object?.type === 'frame' && <label>Title<input className="board-input" disabled={!editable} value={object.title} onChange={event => edit('title', event.target.value)} onBlur={commit} /></label>}
    {connection && <>
      <div className="board-inspector-properties"><BoardPropertyRow label="Weight"><div role="group" aria-label="Line thickness" className="board-line-options">{([1.5, 3, 5] as const).map((width, index) => {
        const current = connection.width ?? 1.5;
        const active = sameWidth && index === (current < 2.25 ? 0 : current < 4 ? 1 : 2);
        return <button key={width} className="board-button" aria-label={['Thin', 'Medium', 'Thick'][index]} title={`${['Thin', 'Medium', 'Thick'][index]} · ${width} px`} disabled={!editable} aria-pressed={active} onClick={() => applyConnectionStyle({ width })}>
          <svg viewBox="0 0 36 10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" stroke="currentColor" strokeWidth={width}/></svg><span>{width} px</span></button>;
      })}</div></BoardPropertyRow>
      <BoardPropertyRow label="Pattern"><div role="group" aria-label="Line style" className="board-line-options">{(['solid', 'dashed'] as const).map(lineStyle => <button key={lineStyle} className="board-button" disabled={!editable} aria-pressed={samePattern && (connection.lineStyle ?? 'solid') === lineStyle} onClick={() => applyConnectionStyle({ lineStyle })}>
        <svg viewBox="0 0 36 10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={lineStyle === 'dashed' ? '6 4' : undefined}/></svg>{lineStyle === 'solid' ? 'Solid' : 'Dashed'}</button>)}</div></BoardPropertyRow>
      {connections.length === 1 && <label className="board-connection-label">Label<input className="board-input" disabled={!editable} value={connection.label} onChange={event => useBoardStore.getState().updateInteraction(boardId, document => updateConnection(document, connection.id, { label: event.target.value }))} onBlur={commit} /></label>}
      <BoardPropertyRow label="Color"><BoardColorField label="Connection color" disabled={!editable} value={connection.color} mixed={!sameColor} onChange={color => applyConnectionStyle({ color }, true)} onBlur={commit}/></BoardPropertyRow></div>
    </>}
    {selected.some(item => item.type === 'asset') && <Section title="Show on canvas"><fieldset className="board-field-grid" disabled={!editable}>{fields.map(field => {
      const assets = selected.filter(item => item.type === 'asset');
      const checked = assets.length > 0 && assets.every(asset => asset.visibleFields.includes(field));
      return <label className="board-checkbox" key={field}><input type="checkbox" checked={checked} ref={element => { if(element) element.indeterminate = !checked && assets.some(asset => asset.visibleFields.includes(field)); }} onChange={() => useBoardStore.getState().executeOperation(boardId, document => updateObjects(document, assets.map(asset => ({ id: asset.id, visibleFields: checked ? asset.visibleFields.filter(item => item !== field) : [...new Set([...asset.visibleFields, field])] }))))} />{{model:'Model',loras:'LoRAs',seed:'Seed',dimensions:'Dimensions',generator:'Generator',rating:'Rating',prompt:'Prompt'}[field]}</label>;
    })}</fieldset></Section>}
    {selected.length > 0 && <Section title="Arrange"><div className="board-arrange-grid">
      <button className="board-button" disabled={!editable} onClick={() => duplicateBoardSelection(boardId)}>Duplicate</button>
      <button className="board-button" disabled={!editable || selected.length < 2} onClick={() => useBoardStore.getState().executeOperation(boardId, doc => arrangeObjectsInGrid(doc, session.selectedObjectIds))}>Arrange in grid</button>
      <button className="board-button" disabled={!editable} onClick={() => useBoardStore.getState().executeOperation(boardId, doc => updateObjects(doc, selected.map(item => ({id:item.id,zIndex:Math.max(0,...doc.objects.map(o=>o.zIndex))+1}))))}>Bring to front</button>
      <button className="board-button" disabled={!editable} onClick={() => useBoardStore.getState().executeOperation(boardId, doc => updateObjects(doc, selected.map(item => ({id:item.id,zIndex:Math.min(0,...doc.objects.map(o=>o.zIndex))-1}))))}>Send to back</button>
    </div></Section>}
    {object?.type === 'asset' && <Section title="File"><p>{object.reference.locator.relativePath}</p></Section>}
    {(selected.length > 0 || session.selectedConnectionIds.length > 0) && <button className="board-button board-button--danger" disabled={!editable} onClick={() => deleteBoardSelection(boardId)} title="Remove the selected objects from this canvas">Remove from canvas</button>}
    {!object && !connection && !selected.length && <p>Select an object to inspect it. Double-click text to edit.</p>}
  </div></aside>;
}

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
import { arrangeObjectsInGrid, removeConnections, removeObjects, updateConnection, updateObjects } from '../../services/boards/operations';
import type { BoardMetadataField } from '../../services/boards/types';

const fields: BoardMetadataField[] = ['model', 'loras', 'seed', 'dimensions', 'generator', 'rating', 'prompt'];
export default function BoardInspector({ boardId, editable, assetActions, assetMetadata, assetStatus, selectionActions }: { boardId: string; editable: boolean; assetActions?: ReactNode; assetMetadata?: ReactNode; assetStatus?: ReactNode; selectionActions?: ReactNode }) {
  const session = useBoardStore(state => state.sessions[boardId]);
  const selected = session.document.objects.filter(object => session.selectedObjectIds.includes(object.id));
  const object = selected.length === 1 ? selected[0] : null;
  const connection = session.selectedConnectionIds.length === 1 ? session.document.connections.find(edge => edge.id === session.selectedConnectionIds[0]) : null;
  const edit = (property: string, value: string | number) => {
    if (!editable || !object) return;
    useBoardStore.getState().updateInteraction(boardId, document => updateObjects(document, [{ id: object.id, [property]: value }]));
  };
  const commit = () => useBoardStore.getState().commitInteraction(boardId);
  return <aside className="board-inspector" aria-label="Board inspector">
    <header className="board-inspector-header"><div><small>{object?.type === 'smart-frame' ? 'Smart Frame' : object?.type ?? 'Properties'}</small><h2 title={object?.type === 'asset' ? getBoardDisplayName(object.name) : undefined}>{object?.type === 'asset' ? getBoardDisplayName(object.name) : object?.type === 'smart-frame' ? object.title : object?.type === 'frame' ? 'Frame' : object?.type === 'text' ? 'Text' : connection ? 'Connection' : selected.length ? `${selected.length} ${selected.length === 1 ? 'object' : 'objects'}` : 'Board'}</h2></div><button className="board-icon-button" aria-label="Hide inspector" onClick={() => useBoardUIStore.getState().setInspectorOpen(false)}><PanelRightClose size={16}/></button></header><div className="board-inspector-content scrollbar-sidebar">{assetStatus}{assetActions}{selectionActions}{assetMetadata && <Section title="Metadata" defaultOpen>{assetMetadata}</Section>}
    {selected.length > 1 && selected.every(item => item.type === 'smart-frame') && <BoardSmartFrameSelectionActions key={selected.map(item => item.id).join('|')} boardId={boardId} frames={selected as BoardSmartFrameObject[]} editable={editable} />}
    {object?.type === 'smart-frame' && <BoardSmartFrameInspector boardId={boardId} frame={object} editable={editable} />}
    {object?.type === 'text' && <>
      <label>Text<textarea className="board-textarea" disabled={!editable} value={object.text} onChange={event => edit('text', event.target.value)} onBlur={commit} /></label>
      <label>Font size<input className="board-input" type="number" min="1" max="300" disabled={!editable} value={object.fontSize} onChange={event => { const size = Number(event.target.value); if (size >= 1) edit('fontSize', size); }} onBlur={commit} /></label>
    </>}
    {object?.type === 'frame' && <label>Title<input className="board-input" disabled={!editable} value={object.title} onChange={event => edit('title', event.target.value)} onBlur={commit} /></label>}
    {object && object.type !== 'asset' && <label>Color<input type="color" disabled={!editable} value={object.color} onChange={event => edit('color', event.target.value)} onBlur={commit} /></label>}
    {connection && <>
      <label>Label<input className="board-input" disabled={!editable} value={connection.label} onChange={event => useBoardStore.getState().updateInteraction(boardId, document => updateConnection(document, connection.id, { label: event.target.value }))} onBlur={commit} /></label>
      <label>Color<input type="color" disabled={!editable} value={connection.color} onChange={event => useBoardStore.getState().updateInteraction(boardId, document => updateConnection(document, connection.id, { color: event.target.value }))} onBlur={commit} /></label>
    </>}
    {selected.some(item => item.type === 'asset') && <Section title="Show on canvas"><fieldset disabled={!editable}>{fields.map(field => {
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
    {(selected.length > 0 || session.selectedConnectionIds.length > 0) && <button className="board-button board-button--danger" disabled={!editable} onClick={() => useBoardStore.getState().executeOperation(boardId, doc => removeConnections(removeObjects(doc,session.selectedObjectIds),session.selectedConnectionIds))}>Remove</button>}
    {!object && !connection && !selected.length && <p>Select an object to inspect it. Double-click text to edit.</p>}
  </div></aside>;
}

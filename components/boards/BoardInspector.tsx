import type { ReactNode } from 'react';
import { useBoardStore } from '../../store/useBoardStore';
import { updateConnection, updateObjects } from '../../services/boards/operations';
import type { BoardMetadataField } from '../../services/boards/types';

const fields: BoardMetadataField[] = ['model', 'loras', 'seed', 'dimensions', 'generator', 'rating', 'prompt'];
export default function BoardInspector({ boardId, editable, assetContent }: { boardId: string; editable: boolean; assetContent?: ReactNode }) {
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
    <h2>{object?.type === 'asset' ? object.name : object?.type === 'frame' ? 'Frame' : object?.type === 'text' ? 'Text' : connection ? 'Connection' : selected.length ? `${selected.length} objects` : 'Board'}</h2>
    {object?.type === 'text' && <>
      <label>Text<textarea disabled={!editable} value={object.text} onChange={event => edit('text', event.target.value)} onBlur={commit} /></label>
      <label>Font size<input type="number" min="1" max="300" disabled={!editable} value={object.fontSize} onChange={event => { const size = Number(event.target.value); if (size >= 1) edit('fontSize', size); }} onBlur={commit} /></label>
    </>}
    {object?.type === 'frame' && <label>Title<input disabled={!editable} value={object.title} onChange={event => edit('title', event.target.value)} onBlur={commit} /></label>}
    {object && object.type !== 'asset' && <label>Color<input type="color" disabled={!editable} value={object.color} onChange={event => edit('color', event.target.value)} onBlur={commit} /></label>}
    {connection && <>
      <label>Label<input disabled={!editable} value={connection.label} onChange={event => useBoardStore.getState().updateInteraction(boardId, document => updateConnection(document, connection.id, { label: event.target.value }))} onBlur={commit} /></label>
      <label>Color<input type="color" disabled={!editable} value={connection.color} onChange={event => useBoardStore.getState().updateInteraction(boardId, document => updateConnection(document, connection.id, { color: event.target.value }))} onBlur={commit} /></label>
    </>}
    {selected.some(item => item.type === 'asset') && <fieldset disabled={!editable}><legend>Visible fields</legend>{fields.map(field => {
      const assets = selected.filter(item => item.type === 'asset');
      const checked = assets.length > 0 && assets.every(asset => asset.visibleFields.includes(field));
      return <label className="board-checkbox" key={field}><input type="checkbox" checked={checked} onChange={() => useBoardStore.getState().executeOperation(boardId, document => updateObjects(document, assets.map(asset => ({ id: asset.id, visibleFields: checked ? asset.visibleFields.filter(item => item !== field) : [...new Set([...asset.visibleFields, field])] }))))} />{field}</label>;
    })}</fieldset>}
    {object?.type === 'asset' && <><p>{object.reference.locator.relativePath}</p>{assetContent}</>}
    {!object && !connection && !selected.length && <p>Select an object to inspect it. Double-click text to edit.</p>}
  </aside>;
}

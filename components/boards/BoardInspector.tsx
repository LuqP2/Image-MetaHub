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
import { ArrowLeftRight, PanelRightClose, RotateCcw } from 'lucide-react';
import { useBoardUIStore } from '../../store/useBoardUIStore';
import Section from './BoardInspectorSection';
import { getBoardDisplayName } from './boardPresentation';
import { useState, useRef, type ReactNode } from 'react';
import { useBoardStore } from '../../store/useBoardStore';
import { arrangeObjectsInGrid, reverseConnections, updateConnection, updateObjects } from '../../services/boards/operations';
import type { BoardMetadataField } from '../../services/boards/types';

const fields: BoardMetadataField[] = ['model', 'loras', 'seed', 'dimensions', 'generator', 'rating', 'prompt'];
export default function BoardInspector({ boardId, editable, assetActions, assetMetadata, assetStatus, selectionActions, onHide }: { boardId: string; editable: boolean; assetActions?: ReactNode; assetMetadata?: ReactNode; assetStatus?: ReactNode; selectionActions?: ReactNode; onHide?: () => void }) {
  const { t } = useTranslation();
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const session = useBoardStore(state => state.sessions[boardId]);
  const selected = session.document.objects.filter(object => session.selectedObjectIds.includes(object.id));
  const object = selected.length === 1 ? selected[0] : null;
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
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
    {object?.type === 'link' && <><label>{t('imageViewer.collection.title')}<input className="board-input" disabled={!editable} value={object.title} onChange={event => edit('title', event.target.value)} onBlur={commit} /></label><label>URL<input className="board-input" disabled={!editable} defaultValue={object.url} key={object.url} onBlur={event => { try { const url = new URL(event.target.value); if (['http:', 'https:'].includes(url.protocol)) { useBoardStore.getState().executeOperation(boardId, document => ({ ...document, objects: document.objects.map(item => item.id === object.id && item.type === 'link' ? { ...item, url: url.href, preview: undefined } : item) })); } else event.target.value = object.url; } catch { event.target.value = object.url; } }} /></label></>}
    {object?.type === 'text' && /^(https?:\/\/|www\.)[^\s]+$/i.test(object.text.trim()) && <button className="board-button" disabled={!editable} onClick={() => {
      const url = new URL(object.text.trim().startsWith('www.') ? `https://${object.text.trim()}` : object.text.trim());
      useBoardStore.getState().executeOperation(boardId, document => ({ ...document, objects: document.objects.map(item => item.id === object.id ? { id: item.id, type: 'link' as const, x: item.x, y: item.y, width: Math.max(item.width, 280), height: Math.max(item.height, 200), frameId: item.frameId, zIndex: item.zIndex, url: url.href, title: url.hostname, color: '#93c5fd' } : item) }));
    }}>{t('canvasFeedback.createLink')}</button>}
    {object?.type === 'link' && <><button className="board-button" disabled={!editable || previewBusy} onClick={async () => {
      const id = object.id, url = object.url;
      setPreviewBusy(true); setPreviewError(null);
      try {
        const result = await window.electronAPI?.boardsLinkPreview?.(url);
        if (!result) throw new Error('Link preview requires the updated desktop app.');
        if (result.success === false) throw new Error(result.error);
        const current = useBoardStore.getState();
        if (!editableRef.current || current.activeBoardId !== boardId || current.closing || current.sessions[boardId]?.recovering) return;
        current.executeOperation(boardId, document => ({ ...document, objects: document.objects.map(item => item.id === id && item.type === 'link' && item.url === url ? { ...item, preview: result.data, title: item.title === new URL(url).hostname ? result.data.title : item.title } : item) }));
      } catch (error) { setPreviewError(error instanceof Error ? error.message : String(error)); }
      finally { setPreviewBusy(false); }
    }}>{t(previewBusy ? 'canvasFeedback.fetching' : 'canvasFeedback.fetchPreview')}</button>{previewError && <p role="alert">{previewError}</p>}<small>{t('canvasFeedback.previewHelp')}</small></>}
    {(object?.type === 'text' || object?.type === 'shape') && <>
      <label className="board-content-field">{t('imageViewer.editor.content')}<textarea aria-label={t('imageViewer.editor.text')} className="board-textarea" disabled={!editable} value={object.text} onChange={event => edit('text', event.target.value)} onBlur={commit} /></label>
    </>}
    {object?.type === 'frame' && <label>{t('imageViewer.collection.title')}<input className="board-input" disabled={!editable} value={object.title} onChange={event => edit('title', event.target.value)} onBlur={commit} /></label>}
    {object?.type === 'asset' && <label>{t('canvasFeedback.label')}<input className="board-input" disabled={!editable} value={object.label ?? ''} placeholder={getBoardDisplayName(object.name)} onChange={event => edit('label', event.target.value)} onBlur={commit} /></label>}
    {connection && <>
      <div className="board-inspector-group">
        <BoardPropertyRow label={t('canvasFeedback.routing')}>
          <div role="group" aria-label={t('canvasFeedback.routing')} className="board-line-options">
            {(['curved', 'orthogonal'] as const).map(routing => (
              <button key={routing} className="board-button" disabled={!editable} aria-pressed={(connection.routing ?? 'curved') === routing} onClick={() => applyConnectionStyle({ routing })}>
                {routing === 'curved' ? t('canvasFeedback.curved') : t('canvasFeedback.orthogonal')}
              </button>
            ))}
          </div>
        </BoardPropertyRow>
        <BoardPropertyRow label={t('canvasFeedback.anchoring')}>
          <div role="group" aria-label={t('canvasFeedback.anchoring')} className="board-line-options">
            {(['manual', 'automatic'] as const).map(anchoring => (
              <button key={anchoring} className="board-button" disabled={!editable} aria-pressed={(connection.anchoring ?? 'manual') === anchoring} onClick={() => useBoardStore.getState().executeOperation(boardId, document => connections.reduce((next, edge) => updateConnection(next, edge.id, { anchoring }), document))}>
                {anchoring === 'manual' ? t('canvasFeedback.manual') : t('canvasFeedback.automatic')}
              </button>
            ))}
          </div>
        </BoardPropertyRow>
        {connections.length === 1 ? (
          <div className="board-endpoints-row">
            {(['sourceSide', 'targetSide'] as const).map(key => (
              <label key={key}>
                {t(key === 'sourceSide' ? 'canvasFeedback.start' : 'canvasFeedback.end')}
                <select className="board-select" disabled={!editable} value={connection[key]} onChange={event => useBoardStore.getState().executeOperation(boardId, document => updateConnection(document, connection.id, { [key]: event.target.value, anchoring: 'manual' }))}>
                  {['top', 'right', 'bottom', 'left'].map(side => <option key={side} value={side}>{side}</option>)}
                </select>
              </label>
            ))}
            <button className="board-icon-button" aria-label={t('canvasFeedback.reverse')} title={t('canvasFeedback.reverse')} disabled={!editable} onClick={() => useBoardStore.getState().executeOperation(boardId, document => reverseConnections(document, connections.map(edge => edge.id)))}>
              <ArrowLeftRight size={14} />
            </button>
          </div>
        ) : (
          <button className="board-button" disabled={!editable} onClick={() => useBoardStore.getState().executeOperation(boardId, document => reverseConnections(document, connections.map(edge => edge.id)))}>
            <ArrowLeftRight size={13} />{t('canvasFeedback.reverse')}
          </button>
        )}
      </div>
      <div className="board-inspector-group">
        <BoardPropertyRow label={t('metadataEditor.weight')}><div role="group" aria-label={t('canvas.lineThickness')} className="board-line-options">{([1.5, 3, 5] as const).map((width, index) => {
          const current = connection.width ?? 1.5;
          const active = sameWidth && index === (current < 2.25 ? 0 : current < 4 ? 1 : 2);
          return <button key={width} className="board-button" aria-label={[t('canvas.thin'), t('canvas.medium'), t('canvas.thick')][index]} title={t('canvas.lineWidth', { label: [t('canvas.thin'), t('canvas.medium'), t('canvas.thick')][index], width })} disabled={!editable} aria-pressed={active} onClick={() => applyConnectionStyle({ width })}>
            <svg viewBox="0 0 36 10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" stroke="currentColor" strokeWidth={width}/></svg><span>{width} px</span></button>;
        })}</div></BoardPropertyRow>
        <BoardPropertyRow label={t('canvas.pattern')}><div role="group" aria-label={t('canvas.lineStyle')} className="board-line-options">{(['solid', 'dashed'] as const).map(lineStyle => <button key={lineStyle} className="board-button" disabled={!editable} aria-pressed={samePattern && (connection.lineStyle ?? 'solid') === lineStyle} onClick={() => applyConnectionStyle({ lineStyle })}>
          <svg viewBox="0 0 36 10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={lineStyle === 'dashed' ? '6 4' : undefined}/></svg>{lineStyle === 'solid' ? t('canvas.solid') : t('canvas.dashed')}</button>)}</div></BoardPropertyRow>
        <BoardPropertyRow label={t('imageViewer.exr.color')}><BoardColorField label={t('canvas.connectionColor')} disabled={!editable} value={connection.color} mixed={!sameColor} onChange={color => applyConnectionStyle({ color }, true)} onBlur={commit}/></BoardPropertyRow>
      </div>
      <div className="board-inspector-group">
        {connections.length === 1 && <BoardPropertyRow label={t('canvas.label')}><input aria-label={t('canvas.label')} className="board-input" disabled={!editable} value={connection.label} onChange={event => useBoardStore.getState().updateInteraction(boardId, document => updateConnection(document, connection.id, { label: event.target.value }))} onBlur={commit} /></BoardPropertyRow>}
        <BoardPropertyRow label={t('canvasFeedback.labelSize')}>
          <div className="board-label-controls">
            <input aria-label={t('canvasFeedback.labelSize')} className="board-input" type="number" min="8" max="72" value={connection.labelFontSize ?? 11} disabled={!editable} onChange={event => { const size = Number(event.target.value); if (size >= 8 && size <= 72) useBoardStore.getState().updateInteraction(boardId, document => connections.reduce((next, edge) => updateConnection(next, edge.id, { labelFontSize: size }), document)); }} onBlur={commit} />
            <button className="board-button board-button--ghost" title={t('canvasFeedback.resetLabel')} aria-label={t('canvasFeedback.resetLabel')} disabled={!editable} onClick={() => useBoardStore.getState().executeOperation(boardId, document => connections.reduce((next, edge) => updateConnection(next, edge.id, { labelOffset: { x: 0, y: 0 } }), document))}>
              <RotateCcw size={13} />{t('canvasFeedback.resetLabel')}
            </button>
          </div>
        </BoardPropertyRow>
      </div>
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

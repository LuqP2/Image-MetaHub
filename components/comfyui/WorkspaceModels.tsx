import React, { useEffect, useMemo, useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList } from 'react-window';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { useModelManager } from '../../services/modelLibrary/manager';
import { getManagedModelPrimaryLocations } from '../../services/modelLibrary/catalog';
import { getEffectiveModelPresentation, getModelLocalMetadata } from '../../services/modelLibrary/presentation';
import { modelKindLabel } from '../../services/modelLibrary/modelKinds';
import { executeModelCommand } from '../ModelManagerPanels';
import { copyTextToClipboard } from '../../utils/imageUtils';
import ComfyUITextActions from './ComfyUITextActions';
import { buttonClass, fieldClass } from '../promptLibrary/PromptVariables';

const session = { query: '', kind: '', base: '', favorites: false, selected: '', offset: 0 };
export default function WorkspaceModels({ active, onAddText }: { active: boolean; onAddText: (text: string, channel: 'positive' | 'negative') => void }) {
  const access = useFeatureAccess();
  return access.canUseModelManager ? <ModelCatalog active={active} onAddText={onAddText} /> :
    <div className="space-y-3 p-4 text-sm text-gray-400"><p>Model Manager is available with Pro or an active trial.</p><button className={buttonClass} onClick={() => access.showProModal('model_manager')}>Explore Model Manager</button></div>;
}
function ModelCatalog({ active, onAddText }: { active: boolean; onAddText: (text: string, channel: 'positive' | 'negative') => void }) {
  const manager = useModelManager();
  const [ui, setUi] = useState({ ...session });
  const [status, setStatus] = useState('');
  const update = (patch: Partial<typeof session>) => setUi(current => { const next = { ...current, offset: session.offset, ...patch }; Object.assign(session, next); return next; });
  const items = useMemo(() => getManagedModelPrimaryLocations(manager.catalog).map(location => {
    const localMetadata = getModelLocalMetadata(manager.localMetadata, location);
    return { location, localMetadata, presentation: getEffectiveModelPresentation(location, localMetadata) };
  }).filter(item => !item.localMetadata?.hidden), [manager.catalog, manager.localMetadata]);
  const selected = items.find(item => item.location.id === ui.selected);
  useEffect(() => {
    if (ui.selected && !selected) {
      session.selected = ''; session.offset = 0;
      setUi(current => ({ ...current, selected: '', offset: 0 }));
    }
  }, [ui.selected, selected]);
  const visible = items.filter(item => (!ui.kind || item.location.sourceKind === ui.kind)
    && (!ui.base || item.presentation.baseModel === ui.base) && (!ui.favorites || item.localMetadata?.favorite)
    && [item.presentation.name, item.location.fileName, item.presentation.description, ...item.presentation.triggerWords].join(' ').toLocaleLowerCase().includes(ui.query.toLocaleLowerCase()));
  const report = async (action: () => Promise<unknown>) => {
    try { setStatus(''); await action(); } catch (cause) { setStatus(cause instanceof Error ? cause.message : 'Operation failed'); }
  };
  const copy = (text: string) => void report(async () => { const result = await copyTextToClipboard(text); if (!result.success) throw new Error('Could not copy text.'); setStatus('Copied.'); });
  const favorite = (id: string, value: boolean) => void report(() => executeModelCommand({ type: 'saveLocal', locationId: id, patch: { favorite: value } }));
  return <section aria-label="Workspace Model Manager" className="flex h-full min-h-0 flex-col gap-3 p-3 text-gray-100">
    {status && <p role="status" className="text-xs text-gray-400">{status}</p>}
    {selected ? <div className="min-h-0 flex-1 space-y-3 overflow-auto">
      <button className={buttonClass} onClick={() => update({ selected: '' })}>Back to models</button>
      <h3 className="break-words text-sm font-semibold">{selected.presentation.name}</h3>
      <p className="text-xs text-gray-400">{modelKindLabel(selected.location.sourceKind)}{selected.presentation.baseModel && ' · ' + selected.presentation.baseModel}</p>
      {selected.presentation.preview && <img alt="" src={selected.presentation.preview} className="max-h-44 w-full rounded object-contain" />}
      <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => favorite(selected.location.id, !selected.localMetadata?.favorite)}>{selected.localMetadata?.favorite ? 'Unfavorite' : 'Favorite'}</button><button className={buttonClass} onClick={() => copy(selected.location.fileName)}>Copy filename</button>
        <button className={buttonClass} onClick={() => void report(async () => {
          const response = await window.electronAPI?.modelInspectorOpen({ items: items.map(({ location, localMetadata }) => ({ location, localMetadata })), selectedId: selected.location.id });
          if (!response?.success) throw new Error(response?.error || 'Model Inspector is unavailable.');
        })}>Open Inspector</button></div>
      {selected.presentation.description && <p className="whitespace-pre-wrap break-words text-xs text-gray-400">{selected.presentation.description}</p>}
      <h4 className="text-xs font-semibold">Trigger words</h4>
      {selected.presentation.triggerWords.length ? <>
        <div className="flex flex-wrap gap-2">{selected.presentation.triggerWords.map(word => <button key={word} className={buttonClass} onClick={() => copy(word)} title="Copy trigger word">{word}</button>)}</div>
        <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => copy(selected.presentation.triggerWords.join(', '))}>Copy all</button><button className={buttonClass} onClick={() => onAddText(selected.presentation.triggerWords.join(', '), 'positive')}>Add to positive</button><button className={buttonClass} onClick={() => onAddText(selected.presentation.triggerWords.join(', '), 'negative')}>Add to negative</button></div>
        <ComfyUITextActions positive={selected.presentation.triggerWords.join(', ')} active={active} />
      </> : <p className="text-xs text-gray-500">No trigger words are available.</p>}
    </div> : <>
      <input type="search" aria-label="Search workspace models" className={fieldClass} placeholder="Search models and trigger words…" value={ui.query} onChange={e => update({ query: e.target.value })} />
      <div className="flex gap-2"><select aria-label="Model type" className={fieldClass} value={ui.kind} onChange={e => update({ kind: e.target.value })}><option value="">All types</option>{[...new Set(items.map(item => item.location.sourceKind))].sort().map(kind => <option key={kind} value={kind}>{modelKindLabel(kind)}</option>)}</select>
        <select aria-label="Base model" className={fieldClass} value={ui.base} onChange={e => update({ base: e.target.value })}><option value="">All base models</option>{[...new Set(items.map(item => item.presentation.baseModel).filter(Boolean))].sort().map(base => <option key={base} value={base}>{base}</option>)}</select></div>
      <button className={buttonClass} aria-pressed={ui.favorites} onClick={() => update({ favorites: !ui.favorites })}>Favorites</button>
      <div className="min-h-0 flex-1">{manager.loading && !items.length ? <p className="text-xs">Loading models…</p> : !visible.length ? <p className="text-xs text-gray-400">{items.length ? 'No matching models.' : 'Add model folders in Model Manager to get started.'}</p> : <AutoSizer>{({ width, height }) => <FixedSizeList height={height || 400} width={width || 320} itemSize={88} itemCount={visible.length} initialScrollOffset={ui.offset} onScroll={({ scrollOffset }) => { session.offset = scrollOffset; }} itemKey={index => visible[index].location.id}>
        {({ index, style }) => { const item = visible[index]; return <div style={style} className="pb-2"><button className="flex h-full w-full items-center gap-3 rounded-lg border border-gray-700 p-2 text-left hover:border-accent/50" onClick={() => update({ selected: item.location.id })}>{item.presentation.preview && <img alt="" src={item.presentation.preview} className="h-14 w-14 rounded object-cover" />}<div className="min-w-0"><p className="truncate text-sm font-semibold">{item.presentation.name}</p><p className="truncate text-xs text-gray-400">{modelKindLabel(item.location.sourceKind)}{item.presentation.baseModel && ' · ' + item.presentation.baseModel}</p></div></button></div>; }}
      </FixedSizeList>}</AutoSizer>}</div>
    </>}
    {ui.selected && !selected && <p className="text-xs text-gray-400">This model is no longer available.</p>}
  </section>;
}

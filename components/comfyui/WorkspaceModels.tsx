import { useTranslation } from '../../i18n/useTranslation';
import { translatePresentationMessage } from '../../i18n/presentationMessages';
import { modelKindText } from '../../i18n/modelMessages';
import React, { useEffect, useMemo, useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList } from 'react-window';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { useModelManager } from '../../services/modelLibrary/manager';
import { getManagedModelPrimaryLocations } from '../../services/modelLibrary/catalog';
import { getEffectiveModelPresentation, getModelLocalMetadata } from '../../services/modelLibrary/presentation';
import { executeModelCommand } from '../ModelManagerPanels';
import { copyTextToClipboard } from '../../utils/imageUtils';
import ComfyUITextActions from './ComfyUITextActions';
import WorkspaceSearch, { workspaceButtonClass as buttonClass, workspaceCardClass, workspaceFieldClass as fieldClass } from './WorkspaceSearch';

const session = { query: '', kind: '', base: '', favorites: false, selected: '', offset: 0 };
export default function WorkspaceModels({ active, visiblePanel = true, onAddText }: { active: boolean; visiblePanel?: boolean; onAddText: (text: string, channel: 'positive' | 'negative') => void }) {
  const { t } = useTranslation();
  const access = useFeatureAccess();
  return access.canUseModelManager ? <ModelCatalog active={active} visiblePanel={visiblePanel} onAddText={onAddText} /> :
    <div className="space-y-2 p-2 text-xs text-gray-400"><p>{t('integrations.modelProHelp')}</p><button className={buttonClass} onClick={() => access.showProModal('model_manager')}>{t('integrations.exploreModels')}</button></div>;
}
function ModelCatalog({ active, visiblePanel, onAddText }: { active: boolean; visiblePanel: boolean; onAddText: (text: string, channel: 'positive' | 'negative') => void }) {
  const { t } = useTranslation();
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
  return <section aria-label={t('integrations.workspaceModels')} className="flex h-full min-h-0 flex-col gap-2 p-2 text-gray-100">
    {status && <p role="status" className="text-xs text-gray-400">{translatePresentationMessage(status, t)}</p>}
    {selected ? <div className="min-h-0 flex-1 space-y-2 overflow-auto">
      <button className={buttonClass} onClick={() => update({ selected: '' })}>{t('integrations.backModels')}</button>
      <h3 className="break-words text-sm font-semibold">{selected.presentation.name}</h3>
      <p className="text-xs text-gray-400">{modelKindText(selected.location.sourceKind, t)}{selected.presentation.baseModel && ' · ' + selected.presentation.baseModel}</p>
      {selected.presentation.preview && <img alt="" src={selected.presentation.preview} className="max-h-44 w-full rounded object-contain" />}
      <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => favorite(selected.location.id, !selected.localMetadata?.favorite)}>{selected.localMetadata?.favorite ? t('promptLibrary.unfavorite') : t('promptLibrary.favorite')}</button><button className={buttonClass} onClick={() => copy(selected.location.fileName)}>{t('integrations.copyFilename')}</button>
        <button className={buttonClass} onClick={() => void report(async () => {
          const response = await window.electronAPI?.modelInspectorOpen({ items: items.map(({ location, localMetadata }) => ({ location, localMetadata })), selectedId: selected.location.id });
          if (!response?.success) throw new Error(response?.error || 'Model Inspector is unavailable.');
        })}>{t('modelLibrary.openInspector')}</button></div>
      {selected.presentation.description && <p className="whitespace-pre-wrap break-words text-xs text-gray-400">{selected.presentation.description}</p>}
      <h4 className="text-xs font-semibold">{t('modelLibrary.triggers')}</h4>
      {selected.presentation.triggerWords.length ? <>
        <div className="flex flex-wrap gap-2">{selected.presentation.triggerWords.map(word => <button key={word} className={buttonClass} onClick={() => copy(word)} title={t('integrations.copyTrigger')}>{word}</button>)}</div>
        <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => copy(selected.presentation.triggerWords.join(', '))}>{t('integrations.copyAll')}</button><button className={buttonClass} onClick={() => onAddText(selected.presentation.triggerWords.join(', '), 'positive')}>{t('integrations.addPositive')}</button><button className={buttonClass} onClick={() => onAddText(selected.presentation.triggerWords.join(', '), 'negative')}>{t('integrations.addNegative')}</button></div>
        <ComfyUITextActions positive={selected.presentation.triggerWords.join(', ')} active={active} />
      </> : <p className="text-xs text-gray-500">{t('integrations.noTriggers')}</p>}
    </div> : <>
      <WorkspaceSearch label={t('integrations.searchWorkspaceModels')} placeholder={t('integrations.searchModelsTriggers')} query={ui.query} onChange={query => update({ query })} />
      <div className="flex gap-2"><select aria-label={t('integrations.modelType')} className={fieldClass + ' flex-1'} value={ui.kind} onChange={e => update({ kind: e.target.value })}><option value="">{t('promptLibrary.allTypes')}</option>{[...new Set(items.map(item => item.location.sourceKind))].sort().map(kind => <option key={kind} value={kind}>{modelKindText(kind, t)}</option>)}</select>
        <select aria-label={t('modelLibrary.baseModel')} className={fieldClass + ' flex-1'} value={ui.base} onChange={e => update({ base: e.target.value })}><option value="">{t('integrations.allBases')}</option>{[...new Set(items.map(item => item.presentation.baseModel).filter(Boolean))].sort().map(base => <option key={base} value={base}>{base}</option>)}</select></div>
      <div className="flex items-center justify-between gap-2 text-xs text-gray-400">
        <span role="status">{t('integrations.modelCount', { count: visible.length })}</span>
        <button className={buttonClass + (ui.favorites ? ' border-accent/50 text-accent' : '')}
          aria-pressed={ui.favorites} onClick={() => update({ favorites: !ui.favorites })}>{t('promptLibrary.favorites')}</button>
      </div>
      <div className="min-h-0 flex-1">{manager.loading && !items.length ? <p className="text-xs">{t('integrations.loadingModels')}</p> : !visible.length ? <p className="text-xs text-gray-400">{items.length ? t('integrations.noModelMatches') : t('integrations.startModels')}</p> : <AutoSizer>{({ width, height }) => <FixedSizeList className="scrollbar-thin" height={height || 320} width={width || "100%"} itemSize={64} itemCount={visible.length} initialScrollOffset={session.offset} onScroll={({ scrollOffset }) => { if (visiblePanel) session.offset = scrollOffset; }} itemKey={index => visible[index].location.id}>
        {({ index, style }) => { const item = visible[index]; return <div style={style} className="pb-2"><button className={workspaceCardClass + ' flex h-full w-full min-w-0 items-center gap-2 px-1 text-left hover:bg-gray-800/60 focus-visible:outline focus-visible:outline-accent'} onClick={() => update({ selected: item.location.id })}>{item.presentation.preview && <img alt="" src={item.presentation.preview} className="h-12 w-12 shrink-0 rounded object-cover" />}<div className="min-w-0"><p className="truncate text-xs font-medium">{item.presentation.name}</p><p className="truncate text-xs text-gray-400">{modelKindText(item.location.sourceKind, t)}{item.presentation.baseModel && ' · ' + item.presentation.baseModel}</p></div></button></div>; }}
      </FixedSizeList>}</AutoSizer>}</div>
    </>}
    {ui.selected && !selected && <p className="text-xs text-gray-400">{t('integrations.modelGone')}</p>}
  </section>;
}

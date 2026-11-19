import { useTranslation } from '../i18n/useTranslation';
import { translateModelMessage } from '../i18n/modelMessages';
import React, { useEffect, useRef, useState } from 'react';
import { useModelManager } from '../services/modelLibrary/manager';
import { huggingFaceFileUrl, parseHuggingFaceLink } from '../services/modelLibrary/huggingFaceLink.mjs';
import { huggingFaceConfig, huggingFaceWatchId } from '../services/modelLibrary/huggingFaceTracking';
import { HuggingFaceReleaseGroup } from './UnifiedModelUpdatesPanel';
import type { HuggingFaceLookup, ModelInspectorItem, ModelManagerCommand } from '../services/modelLibrary/types';
import { executeModelCommand, modelButton, modelInput } from './ModelManagerPanels';

export function HuggingFaceModelPanel({ item, revealUpdates = 0 }: { item: ModelInspectorItem; revealUpdates?: number }) {
  const { t, language } = useTranslation();
  const manager = useModelManager();
  const copies = item.location.sha256 ? manager.catalog.locations.filter((location) => location.sha256?.toLowerCase() === item.location.sha256?.toLowerCase()) : [item.location];
  const [copyId, setCopyId] = useState(item.location.id);
  const location = copies.find((copy) => copy.id === copyId) ?? item.location;
  const binding = location.huggingFace;
  const differentCopyLinks = binding && copies.some((copy) => copy.huggingFace && (copy.huggingFace.repoId !== binding.repoId || copy.huggingFace.filePath !== binding.filePath || copy.huggingFace.linkedRevision !== binding.linkedRevision));
  const [url, setUrl] = useState('');
  const [target, setTarget] = useState({ repoId: '', revision: 'main', filePath: '' });
  const [lookup, setLookup] = useState<HuggingFaceLookup>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [monitoring, setMonitoring] = useState(huggingFaceConfig(binding ?? { filePath: '' }));
  const watch = binding ? manager.hfWatches?.[huggingFaceWatchId(binding)] : undefined;
  useEffect(() => { setMonitoring(huggingFaceConfig(binding ?? { filePath: '' })); }, [location.id, binding?.repoId, binding?.filePath, binding?.linkedRevision, binding?.trackedRevision, binding?.watchedDirectory, binding?.recursive, binding?.monitoringEnabled]);
  const selectedId = useRef(location.id); selectedId.current = location.id;
  useEffect(() => { setCopyId(item.location.id); }, [item.location.id]);
  useEffect(() => {
    setUrl(''); setLookup(undefined); setError('');
    setTarget({ repoId: '', revision: 'main', filePath: '' });
  }, [location.id]);
  const execute = async (command: ModelManagerCommand) => {
    const id = location.id;
    setError(''); setBusy(true);
    try {
      const result = await executeModelCommand(command);
      if (selectedId.current === id && command.type === 'lookupHF' && result) {
        setLookup(result);
        setTarget((previous) => ({ ...previous, filePath: result.files.some((file) => file.path === previous.filePath) ? previous.filePath : result.files[0].path }));
      }
    } catch (failure) { if (selectedId.current === id) setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const file = lookup?.files.find((entry) => entry.path === target.filePath);
  const blocked = busy || manager.loading || Boolean(manager.progress);
  const edit = (patch: Partial<typeof target>) => { setTarget({ ...target, ...patch }); setLookup(undefined); };
  return <section className="space-y-3 rounded-lg border border-gray-800 p-3" aria-label={t('modelLibrary.hfBinding')}>
    <h3 className="font-medium">Hugging Face</h3>
    {copies.length > 1 && <label className="block text-xs text-gray-400">{t('modelLibrary.fileLocation')}<select className={modelInput} value={location.id} onChange={(event) => setCopyId(event.target.value)}>{copies.map((copy) => <option key={copy.id} value={copy.id}>{copy.sourceName} / {copy.relativePath}{copy.huggingFace ? ` · ${copy.huggingFace.repoId}` : t('modelLibrary.unlinkedSuffix')}</option>)}</select></label>}
    {binding ? <>
      <p className="break-all text-sm">{binding.repoId}</p>
      <p className="break-all text-xs text-gray-300">{binding.filePath} · {binding.linkedRevision}</p>
      <p className="text-xs text-gray-400">{binding.verification === 'sha256' ? t('modelLibrary.verifiedSha') : t('modelLibrary.manualUnverified')}</p>
      <p className="text-xs text-gray-500">{t('modelLibrary.remoteFile', { size: binding.size.toLocaleString(language), date: new Date(binding.fetchedAt).toLocaleString(language), commit: binding.resolvedCommit.slice(0, 12) })}</p>
      <div className="flex flex-wrap gap-2">
        <button className={modelButton} onClick={() => void window.electronAPI?.openExternalUrl(huggingFaceFileUrl(binding))}>{t('modelLibrary.openHfFile')}</button>
        <button className={modelButton} disabled={blocked} onClick={() => void execute({ type: 'verifyHF', locationId: location.id })}>{t('modelLibrary.verifyMatch')}</button>
        <button className={modelButton} onClick={() => void execute({ type: 'unbindHF', locationId: location.id })}>{t('modelLibrary.removeHfLink')}</button>
      </div>
      {binding.verification === 'sha256' && copies.length > 1 && <p className="text-xs text-gray-500">{t('modelLibrary.sharedLinksHelp')}</p>}
      {differentCopyLinks && <p className="text-xs text-amber-400">{t('modelLibrary.differentLinksHelp')}</p>}
      <details><summary className="cursor-pointer text-xs text-gray-400">{t('modelLibrary.hfMonitoring', { state: '(' + t(huggingFaceConfig(binding).monitoringEnabled ? 'modelLibrary.on' : 'modelLibrary.off') + ')' })}</summary><form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void execute({ type: 'configureHF', locationId: location.id, config: monitoring }); }}>
        <label className="block text-xs text-gray-400"><input type="checkbox" checked={monitoring.monitoringEnabled} onChange={(event) => setMonitoring({ ...monitoring, monitoringEnabled: event.target.checked })} /> {t('modelLibrary.enableHfChecks')}</label>
        <label className="block text-xs text-gray-400">{t('modelLibrary.trackedRevision')}<input className={modelInput} value={monitoring.trackedRevision} onChange={(event) => setMonitoring({ ...monitoring, trackedRevision: event.target.value })} /></label>
        <label className="block text-xs text-gray-400">{t('modelLibrary.watchedFolder')}<input className={modelInput} value={monitoring.watchedDirectory} onChange={(event) => setMonitoring({ ...monitoring, watchedDirectory: event.target.value })} /></label>
        <label className="block text-xs text-gray-400"><input type="checkbox" checked={monitoring.recursive} onChange={(event) => setMonitoring({ ...monitoring, recursive: event.target.checked })} /> {t('modelLibrary.includeSubfolders')}</label>
        <p className="text-xs text-gray-500">{t('modelLibrary.monitorScopeHelp', { linked: binding.linkedRevision, tracked: monitoring.trackedRevision || t('modelLibrary.chooseRevision'), hours: manager.intervalHours ?? 24 })}</p>
        <button className={modelButton} disabled={blocked}>{t('modelLibrary.saveHfMonitoring')}</button>
      </form></details>
      <p className="text-xs text-gray-500">{t('modelLibrary.lastUpdateCheck', { date: watch?.lastSuccessAt ? new Date(watch.lastSuccessAt).toLocaleString(language) : t('modelLibrary.never') })}</p>
      {watch?.error && <p className="text-xs text-amber-400">{t('modelLibrary.hfCheckFailed', { error: translateModelMessage(watch.error, t) })}</p>}
      {watch && <HuggingFaceReleaseGroup key={watch.id} watch={watch} reveal={revealUpdates} />}
    </> : <p className="text-xs text-gray-400">{t('modelLibrary.linkPublicHelp')}</p>}
    <details key={location.id} open={!binding || undefined}>
      <summary className="cursor-pointer text-xs text-gray-400">{binding ? t('modelLibrary.changeHfLink') : t('modelLibrary.linkPublicFile')}</summary>
      <form className="mt-3 space-y-3" onSubmit={(event) => {
        event.preventDefault();
        try {
          const parsed = target.repoId ? target : parseHuggingFaceLink(url);
          void execute({ type: 'lookupHF', locationId: location.id, ...parsed });
        } catch (failure) { setError((failure as Error).message); }
      }}>
        <label className="block text-xs text-gray-400">{t('modelLibrary.repositoryUrl')}<input disabled={blocked} className={modelInput} value={url} placeholder="https://huggingface.co/owner/repository" onChange={(event) => {
          setUrl(event.target.value); setLookup(undefined);
          try { setTarget(parseHuggingFaceLink(event.target.value)); }
          catch { setTarget({ repoId: '', revision: 'main', filePath: '' }); }
        }} /></label>
        <label className="block text-xs text-gray-400">{t('modelLibrary.repository')}<input disabled={blocked} className={modelInput} value={target.repoId} placeholder="owner/repository" onChange={(event) => { setUrl(''); edit({ repoId: event.target.value }); }} /></label>
        <label className="block text-xs text-gray-400">{t('modelLibrary.revision')}<input disabled={blocked} className={modelInput} value={target.revision} onChange={(event) => edit({ revision: event.target.value })} /></label>
        <label className="block text-xs text-gray-400">{t('modelLibrary.filePathBrowse')}<input disabled={blocked} className={modelInput} value={target.filePath} placeholder="folder/model.safetensors" onChange={(event) => edit({ filePath: event.target.value })} /></label>
        <p className="text-xs text-gray-500">{t('modelLibrary.branchPathHelp')}</p>
        <button className={modelButton} disabled={blocked}>{t('modelLibrary.lookupFiles')}</button>
      </form>
      {lookup && <div className="mt-3 space-y-3">
        <label className="block text-xs text-gray-400">{t('modelLibrary.chooseSafetensors')}<select className={modelInput} value={target.filePath} onChange={(event) => setTarget({ ...target, filePath: event.target.value })}>{lookup.files.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}</select></label>
        {file && <><p className="break-all text-xs text-gray-400">{t('modelLibrary.remoteLookup', { repo: lookup.repoId, revision: lookup.revision, size: file.size.toLocaleString(language), commit: lookup.resolvedCommit.slice(0, 12) })}</p><p className="text-xs text-gray-500">{file.lfsSha256 ? t('modelLibrary.lfsAvailable') : t('modelLibrary.lfsUnavailable')}</p><button className={modelButton} disabled={blocked} onClick={() => void execute({ type: 'bindHF', locationId: location.id, repoId: lookup.repoId, revision: lookup.revision, filePath: file.path, fingerprint: file.fingerprint })}>{binding ? t('modelLibrary.replaceHfLink') : t('modelLibrary.confirmManualLink')}</button></>}
      </div>}
    </details>
    <p className="text-xs text-gray-500">{t('modelLibrary.publicMetadataHelp')}</p>
    {manager.progress?.kind === 'huggingFace' && <button className={modelButton} onClick={() => void execute({ type: 'cancel' })}>{t('modelLibrary.cancelHfOperation')}</button>}
    {error && <p role="alert" className="text-xs text-red-400">{translateModelMessage(error, t)}</p>}
  </section>;
}

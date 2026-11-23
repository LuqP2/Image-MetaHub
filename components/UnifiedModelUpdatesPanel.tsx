import { useTranslation } from '../i18n/useTranslation';
import { translateModelMessage } from '../i18n/modelMessages';
import React, { useEffect, useRef, useState } from 'react';
import { useModelManager, installedVersions } from '../services/modelLibrary/manager';
import { isHuggingFaceWatchActive, modelUpdateCounts, unreadHuggingFaceEvents } from '../services/modelLibrary/huggingFaceTracking';
import { unreadVersions } from '../services/modelLibrary/updateTracking';
import { huggingFaceFileUrl } from '../services/modelLibrary/huggingFaceLink.mjs';
import type { HuggingFaceEvent, HuggingFaceWatchRecord } from '../services/modelLibrary/types';
import { executeModelCommand, modelButton, ReleaseGroup } from './ModelManagerPanels';

function HuggingFaceEventRow({ event, watch }: { event: HuggingFaceEvent; watch: HuggingFaceWatchRecord }) {
  const { t, language } = useTranslation();
  const ref = useRef<HTMLDivElement>(null), [error, setError] = useState('');
  const seen = watch.seenEventIds.includes(event.id), ignored = watch.ignoredEventIds.includes(event.id);
  useEffect(() => {
    if (!ref.current || seen || ignored || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5);
      if (timer) clearTimeout(timer);
      if (visible) timer = setTimeout(() => {
        observer.disconnect();
        void executeModelCommand({ type: 'hfEventAction', watchId: watch.id, eventIds: [event.id], action: 'seen' }).catch((failure) => setError(failure.message));
      }, 250);
    }, { threshold: 0.5 });
    observer.observe(ref.current);
    return () => { observer.disconnect(); if (timer) clearTimeout(timer); };
  }, [watch.id, event.id, seen, ignored]);
  const label = event.kind === 'fileChanged' ? t('modelLibrary.eventFileChanged') : event.kind === 'newModelFile' ? t('modelLibrary.eventNewFile') : t('modelLibrary.eventUnavailable');
  const url = event.kind === 'fileUnavailable' ? `https://huggingface.co/${watch.repoId}` : huggingFaceFileUrl({ repoId: watch.repoId, linkedRevision: event.commit, filePath: event.path });
  return <div ref={ref} className="mt-2 space-y-2 rounded-md border border-gray-700/50 bg-gray-950/70 p-3">
    <p className="text-xs font-medium text-accent">{'Hugging Face'} · {label}{ignored ? t('modelLibrary.ignoredSuffix') : seen ? t('modelLibrary.viewedSuffix') : ''}</p>
    <p className="break-all text-xs text-gray-300">{event.path}</p>
    <p className="text-xs text-gray-500">{t('modelLibrary.eventDetected', { date: new Date(event.detectedAt).toLocaleString(language), revision: watch.trackedRevision })}</p>
    {event.kind === 'newModelFile' && <p className="text-xs text-gray-400">{t('modelLibrary.newFileHelp')}</p>}
    <div className="flex flex-wrap gap-2"><button className={modelButton} onClick={() => void window.electronAPI?.openExternalUrl(url)}>{event.kind === 'fileUnavailable' ? t('modelLibrary.openRepository') : t('modelLibrary.openHfFile')}</button><button className={modelButton} onClick={() => void executeModelCommand({ type: 'hfEventAction', watchId: watch.id, eventIds: [event.id], action: ignored ? 'restore' : 'ignore' }).catch((failure) => setError(failure.message))}>{ignored ? t('modelLibrary.restoreEvent') : t('modelLibrary.ignoreEvent')}</button></div>
    {error && <p role="alert" className="text-xs text-red-400 light:text-red-800">{translateModelMessage(error, t)}</p>}
  </div>;
}
export function HuggingFaceReleaseGroup({ watch, history: globalHistory, onOpen, reveal = 0 }: { watch: HuggingFaceWatchRecord; history?: boolean; onOpen?: () => void; reveal?: number }) {
  const { t, language } = useTranslation();
  const [expanded, setExpanded] = useState(false), [localHistory, setHistory] = useState(false);
  useEffect(() => { if (reveal) setExpanded(true); }, [reveal]);
  const history = globalHistory ?? localHistory;
  const events = history ? watch.events : watch.events.filter((event) => !watch.ignoredEventIds.includes(event.id));
  const unread = unreadHuggingFaceEvents(watch).length;
  return <details open={expanded} className="ui-disclosure ui-card p-3.5" onToggle={(event) => { setExpanded(event.currentTarget.open); if (event.currentTarget.open) onOpen?.(); }}><summary className="cursor-pointer text-sm font-medium text-gray-100">{'Hugging Face'} · {watch.repoId}{unread ? <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">{t('modelLibrary.unreadSuffix', { count: unread })}</span> : ''}</summary>{expanded && <div className="mt-3 space-y-2"><p className="break-all text-xs text-gray-400">{t('modelLibrary.watchScope', { file: watch.filePath, revision: watch.trackedRevision, folder: watch.watchedDirectory || t('modelLibrary.rootFolder'), recursive: watch.recursive ? t('modelLibrary.recursiveSuffix') : '' })}</p>{watch.error && <p className="text-xs text-amber-400 light:text-amber-800">{t('modelLibrary.checkFailedDetail', { error: translateModelMessage(watch.error, t) })}</p>}<p className="text-xs text-gray-500">{t('modelLibrary.lastCheck', { date: watch.lastSuccessAt ? new Date(watch.lastSuccessAt).toLocaleString(language) : t('modelLibrary.never') })}</p>{!events.length && <p className="text-xs text-gray-400">{watch.snapshot ? t('modelLibrary.baselineReady') : t('modelLibrary.noBaseline')}</p>}{events.map((event) => <HuggingFaceEventRow key={event.id} event={event} watch={watch} />)}{globalHistory === undefined && <button className="text-xs text-gray-400 hover:text-gray-200" onClick={() => setHistory(!localHistory)}>{localHistory ? t('modelLibrary.hideEventHistory') : t('modelLibrary.showEventHistory')}</button>}</div>}</details>;
}

export function ModelUpdatesPanel({ locationIds }: { locationIds?: string[] } = {}) {
  const { t } = useTranslation();
  const manager = useModelManager(), [history, setHistory] = useState(false), [opened, setOpened] = useState<string[]>([]), [error, setError] = useState('');
  const catalog = locationIds ? { ...manager.catalog, locations: manager.catalog.locations.filter((location) => locationIds.includes(location.id)) } : manager.catalog;
  const remoteIds = new Set(catalog.locations.flatMap((location) => location.civitai && 'modelId' in location.civitai ? [location.civitai.modelId] : []));
  const civitai = Object.values(manager.watches).filter((watch) => remoteIds.has(watch.modelId));
  const hf = Object.values(manager.hfWatches ?? {}).filter((watch) => isHuggingFaceWatchActive(watch, catalog.locations));
  const civiUnread = (watch: typeof civitai[number]) => unreadVersions(watch, installedVersions(watch.modelId).map((version) => version.versionId));
  const civiEvents = civitai.reduce((total, watch) => total + civiUnread(watch).length, 0), hfEvents = hf.reduce((total, watch) => total + unreadHuggingFaceEvents(watch).length, 0);
  const count = Object.values(modelUpdateCounts(catalog, manager.watches, manager.hfWatches, manager.catalog)).filter((count) => count > 0).length;
  const visibleCivi = civitai.filter((watch) => history || civiUnread(watch).length || opened.includes(`civitai:${watch.id}`));
  const visibleHF = hf.filter((watch) => history || unreadHuggingFaceEvents(watch).length || opened.includes(watch.id));
  const open = (id: string) => setOpened((previous) => previous.includes(id) ? previous : [...previous, id]);
  return <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-gray-100">{t('modelLibrary.whatsNew')}</h2><p className="mt-0.5 text-xs text-gray-400">{t('modelLibrary.updatesSummary', { count, civitai: civiEvents, hf: hfEvents })}</p></div>{civiEvents + hfEvents > 0 && <button className={modelButton} onClick={() => { void Promise.all([...civitai.map((watch) => executeModelCommand({ type: 'seen', modelId: watch.modelId, versionIds: civiUnread(watch).map((version) => version.id) })), ...hf.map((watch) => executeModelCommand({ type: 'hfEventAction', watchId: watch.id, action: 'seen', eventIds: unreadHuggingFaceEvents(watch).map((event) => event.id) }))]).catch((failure) => setError(failure.message)); }}>{t('modelLibrary.markViewed')}</button>}</div><label className="inline-flex cursor-pointer items-center gap-2 text-xs text-gray-400 hover:text-gray-200"><input type="checkbox" className="ui-checkbox" checked={history} onChange={(event) => setHistory(event.target.checked)} /> {t('modelLibrary.includeHistory')}</label>{error && <p role="alert" className="text-xs text-red-400 light:text-red-800">{translateModelMessage(error, t)}</p>}{!visibleCivi.length && !visibleHF.length && <p className="py-8 text-xs text-gray-400">{t('modelLibrary.caughtUp')}</p>}{visibleCivi.map((watch) => <ReleaseGroup key={`civitai:${watch.id}`} watch={watch} history={history} onOpen={() => open(`civitai:${watch.id}`)} />)}{visibleHF.map((watch) => <HuggingFaceReleaseGroup key={watch.id} watch={watch} history={history} onOpen={() => open(watch.id)} />)}</section>;
}

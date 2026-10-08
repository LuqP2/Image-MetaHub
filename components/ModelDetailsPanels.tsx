import React, { useEffect, useMemo, useState } from 'react';
import { ModelActionsPanel, ModelFilesPanel, ModelLocalEditor, ModelMediaPanel, ModelQuickActions } from './ModelManagerPanels';
import { HuggingFaceModelPanel } from './HuggingFaceModelPanel';
import ModelUsagePanel from './ModelUsagePanel';
import { useModelManager } from '../services/modelLibrary/manager';
import { modelUpdateCounts } from '../services/modelLibrary/huggingFaceTracking';
import type { ModelInspectorItem } from '../services/modelLibrary/types';

export default function ModelDetailsPanels({ item, revealUpdates = 0, connectionExtras }: { item: ModelInspectorItem; revealUpdates?: number; connectionExtras?: React.ReactNode }) {
  const manager = useModelManager();
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  useEffect(() => { if (revealUpdates > 0) setConnectionsOpen(true); }, [revealUpdates]);
  const counts = useMemo(() => modelUpdateCounts(manager.catalog, manager.watches, manager.hfWatches), [manager.catalog, manager.watches, manager.hfWatches]);
  const identity = item.location.sha256 ? `sha256:${item.location.sha256.toLowerCase()}` : `location:${item.location.id}`;
  const updates = counts[identity] ?? 0;
  const copies = item.location.sha256 ? manager.catalog.locations.filter((location) => location.sha256?.toLowerCase() === item.location.sha256?.toLowerCase()) : [item.location];
  const watchErrors = copies.some((location) => location.civitai && 'modelId' in location.civitai && manager.watches[String(location.civitai.modelId)]?.error)
    || Object.values(manager.hfWatches ?? {}).some((watch) => watch.error && copies.some((location) => location.huggingFace?.repoId === watch.repoId && location.huggingFace?.filePath === watch.filePath));
  const sectionClass = 'rounded-lg border border-gray-800 p-3';
  return <div className="space-y-4">
    <ModelQuickActions item={item} />
    <ModelUsagePanel item={item} />
    <details open={connectionsOpen} onToggle={(event) => setConnectionsOpen(event.currentTarget.open)} className={sectionClass}><summary className="cursor-pointer text-sm font-medium">Connections &amp; updates{updates > 0 ? ` · ${updates} new` : ''}{watchErrors ? ' · Check failed' : ''}</summary><div className="mt-3 space-y-3">{connectionExtras}<ModelActionsPanel item={item} revealUpdates={revealUpdates} grouped /><HuggingFaceModelPanel item={item} revealUpdates={revealUpdates} /></div></details>
    <details open={filesOpen} onToggle={(event) => setFilesOpen(event.currentTarget.open)} className={sectionClass}><summary className="cursor-pointer text-sm font-medium">Files</summary><div className="mt-3"><ModelFilesPanel item={item} /></div></details>
    <details open={mediaOpen} onToggle={(event) => setMediaOpen(event.currentTarget.open)} className={sectionClass}><summary className="cursor-pointer text-sm font-medium">Cover &amp; examples</summary><div className="mt-3"><ModelMediaPanel item={item} /></div></details>
    <ModelLocalEditor item={item} />
  </div>;
}

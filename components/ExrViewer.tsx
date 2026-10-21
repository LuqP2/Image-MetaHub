import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import type { IndexedImage, ZoomState } from '../types';
import type { ExrAssetInfo, ExrColorProfile, ExrConfigInfo, ExrMode, ExrPreviewResult } from '../services/exr/contracts';
import { DEFAULT_EXR_PROFILE, EXR_CONFIGS, exrChannelGroups } from '../services/exr/model';
import { loadExrPreview, resolveExrPath, subscribeExrChanged, unwrapExr } from '../services/exr/client';
import SettingsModal from './SettingsModal';

const control = 'max-w-48 rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-200';
export default function ExrViewer({ image, directoryPath, externalZoom, onZoomChange }: { image: IndexedImage; directoryPath?: string; externalZoom?: ZoomState; onZoomChange?: (zoom: number, x: number, y: number) => void }) {
  const api = window.electronAPI?.exr;
  const [asset, setAsset] = useState<ExrAssetInfo | null>(null);
  const [profile, setProfile] = useState<ExrColorProfile>(DEFAULT_EXR_PROFILE);
  const [config, setConfig] = useState<ExrConfigInfo | null>(null);
  const [partIndex, setPartIndex] = useState(0);
  const [channels, setChannels] = useState<string[]>([]);
  const [mode, setMode] = useState<ExrMode>('auto');
  const [exposure, setExposure] = useState(0);
  const [range, setRange] = useState<[number, number] | undefined>();
  const [overview, setOverview] = useState<ExrPreviewResult | null>(null);
  const [overviewKey, setOverviewKey] = useState('');
  const [detail, setDetail] = useState<ExrPreviewResult | null>(null);
  const [detailRegion, setDetailRegion] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: 800, height: 600 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  useEffect(() => {
    if (!externalZoom || !transformRef.current) return;
    const current = transformRef.current.state;
    if (Math.abs(current.scale - externalZoom.zoom) > .001 || Math.abs(current.positionX - externalZoom.x) > .1 || Math.abs(current.positionY - externalZoom.y) > .1) transformRef.current.setTransform(externalZoom.x, externalZoom.y, externalZoom.zoom, 0);
  }, [externalZoom]);
  useEffect(() => subscribeExrChanged(() => setRevision(n => n + 1)), []);
  useEffect(() => {
    if (!viewportRef.current) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width && rect.height) setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(viewportRef.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let current = true;
    setAsset(null); setOverview(null); setDetail(null); setError(''); setExposure(0); setRange(undefined); setMode('auto');
    void (async () => {
      if (!api) throw new Error('EXR support requires the desktop app.');
      const status = unwrapExr(await api.status());
      if (!status.installed || !status.enabled) throw new Error('EXR support not installed or disabled. Open EXR / OpenColorIO settings to enable it.');
      const info = unwrapExr(await api.inspect(await resolveExrPath(image, directoryPath)));
      if (!current) return;
      const part = info.parts.find(p => !p.deep && exrChannelGroups(p).some(g => g.channels.length >= 3)) ?? info.parts.find(p => !p.deep) ?? info.parts[0];
      setAsset(info); setPartIndex(part.index); setChannels(exrChannelGroups(part)[0]?.channels ?? []);
      setProfile(info.profile ?? DEFAULT_EXR_PROFILE);
    })().catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [api, image.id, image.contentModifiedMs, directoryPath, revision]);
  useEffect(() => {
    let current = true; setConfig(null);
    if (asset && api) void api.config(profile.config).then(unwrapExr).then(c => { if (current) setConfig(c); }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [api, asset, profile.config]);
  const part = asset?.parts.find(p => p.index === partIndex);
  const groups = useMemo(() => part ? exrChannelGroups(part) : [], [part]);
  const sourceWidth = part?.width || 1, sourceHeight = part?.height || 1;
  const aspect = part?.pixelAspectRatio || 1;
  const fitScale = Math.min(viewport.width / (sourceWidth * aspect), viewport.height / sourceHeight);
  const fitWidth = sourceWidth * aspect * fitScale, fitHeight = sourceHeight * fitScale;
  const display = profile.display || config?.defaultDisplay || '';
  const views = config?.displays.find(d => d.name === display)?.views ?? [];
  const selectionKey = JSON.stringify({ profile, partIndex, channels, mode, exposure, range });
  useEffect(() => {
    if (!asset || !channels.length || !api || part?.deep) return;
    setDetail(null); setDetailRegion(null);
    let current = true; const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      setLoading(true); setError(''); setDetail(null); setDetailRegion(null);
      void loadExrPreview(image, directoryPath, { requestId, profile, part: partIndex, channels, mode, exposure, range }).then(result => {
        if (current) { setOverview(result); setOverviewKey(selectionKey); }
      }).catch(e => { if (current) setError(e.message); }).finally(() => { if (current) setLoading(false); });
    }, 150);
    return () => { current = false; clearTimeout(timer); api.cancel(requestId); };
  }, [api, asset, image.id, image.contentModifiedMs, directoryPath, profile, partIndex, channels, mode, exposure, range, part?.deep]);
  useEffect(() => {
    if (!overview || overviewKey !== selectionKey || view.scale <= 1.1 || !api || !asset) { setDetail(null); return; }
    const x = Math.max(0, Math.floor(-view.x / view.scale / fitWidth * sourceWidth));
    const y = Math.max(0, Math.floor(-view.y / view.scale / fitHeight * sourceHeight));
    const width = Math.min(sourceWidth - x, Math.ceil(viewport.width / view.scale / fitWidth * sourceWidth));
    const height = Math.min(sourceHeight - y, Math.ceil(viewport.height / view.scale / fitHeight * sourceHeight));
    if (width <= 0 || height <= 0 || x >= sourceWidth || y >= sourceHeight) return;
    const region = { x, y, width, height }; let current = true; const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      void loadExrPreview(image, directoryPath, { requestId, profile, part: partIndex, channels, mode, exposure, range, region, maxEdge: Math.min(4096, Math.max(2048, viewport.width, viewport.height)) }).then(result => { if (current) { setDetail(result); setDetailRegion(region); } }).catch(e => { if (current) setError(e.message); });
    }, 150);
    return () => { current = false; clearTimeout(timer); api.cancel(requestId); };
  }, [api, overview, overviewKey, selectionKey, asset, view, viewport, fitWidth, fitHeight, sourceWidth, sourceHeight, profile, partIndex, channels, mode, exposure, range, image, directoryPath]);
  const dataView = mode === 'auto' ? channels.length < 3 || /normal|position/i.test(channels[0] ?? '') : mode !== 'color';
  return <div data-no-window-drag="true" className="flex h-full min-h-0 w-full flex-col bg-black" onMouseDown={e => e.stopPropagation()}>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-800 bg-gray-950 p-2">
      <span className="text-xs font-medium text-gray-300">EXR</span>
      {asset && <>
        <select aria-label="EXR part" className={control} value={partIndex} onChange={e => { const p = asset.parts.find(p => p.index === Number(e.target.value))!; setOverview(null); setDetail(null); setPartIndex(p.index); setChannels(exrChannelGroups(p)[0]?.channels ?? []); setRange(undefined); }}>{asset.parts.map(p => <option key={p.index} value={p.index}>{p.name}{p.deep ? ' (deep: unsupported)' : ''}</option>)}</select>
        <select aria-label="Render pass or channel" className={control} value={JSON.stringify(channels)} onChange={e => { setChannels(JSON.parse(e.target.value)); setRange(undefined); }}>{groups.map(g => <option key={JSON.stringify(g.channels)} value={JSON.stringify(g.channels)}>{g.name}</option>)}</select>
        <select aria-label="Channel interpretation" className={control} value={mode} onChange={e => setMode(e.target.value as ExrMode)}>{['auto','color','scalar','normal','id'].map(m => <option key={m} value={m}>{m}</option>)}</select>
        <select aria-label="OCIO configuration" className={control} value={profile.config} onChange={e => setProfile({ ...profile, config: e.target.value, input: 'auto', display: '', view: '' })}>{EXR_CONFIGS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}{!EXR_CONFIGS.some(c => c.id === profile.config) && <option value={profile.config}>{profile.config}</option>}</select>
        <select aria-label="Input color space" disabled={Boolean(dataView)} className={control} value={profile.input} onChange={e => setProfile({ ...profile, input: e.target.value })}><option value="auto">Auto input</option>{config?.spaces.map(s => <option key={s}>{s}</option>)}</select>
        <select aria-label="OCIO display" disabled={Boolean(dataView)} className={control} value={profile.display} onChange={e => setProfile({ ...profile, display: e.target.value, view: '' })}><option value="">Default display</option>{config?.displays.map(d => <option key={d.name}>{d.name}</option>)}</select>
        <select aria-label="OCIO view" disabled={Boolean(dataView)} className={control} value={profile.view} onChange={e => setProfile({ ...profile, view: e.target.value })}><option value="">Default view</option>{views.map(v => <option key={v}>{v}</option>)}</select>
        <label className="flex items-center gap-1 text-xs text-gray-300">EV<input aria-label="Exposure slider" type="range" min={-10} max={10} step={0.1} value={exposure} disabled={Boolean(dataView)} onChange={e => setExposure(Number(e.target.value))} className="w-24" /><input aria-label="Exposure stops" type="number" min={-10} max={10} step={0.1} value={exposure} disabled={Boolean(dataView)} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) setExposure(Math.max(-10, Math.min(10, n))); }} className={`${control} w-16`} /></label>
        {overview?.mode === 'scalar' && <label className="flex items-center gap-1 text-xs text-gray-300">Range{[0,1].map(i => <input key={i} aria-label={i ? 'Scalar maximum' : 'Scalar minimum'} type="number" step="any" value={(range ?? overview.range ?? [0,1])[i]} className={`${control} w-20`} onChange={e => { const next: [number,number] = [...(range ?? overview.range ?? [0,1])]; next[i] = Number(e.target.value); if (Number.isFinite(next[i]) && next[1] > next[0]) setRange(next); }} />)}<button className={control} onClick={() => setRange(undefined)}>Auto</button></label>}
      </>}
      <button className={`${control} ml-auto`} onClick={() => setSettingsOpen(true)}>EXR settings</button>
    </div>
    <div className="relative min-h-0 flex-1 overflow-hidden" ref={viewportRef}>
      {overview && <TransformWrapper ref={transformRef} key={`${image.id}:${partIndex}`} minScale={1} maxScale={64} centerOnInit onTransformed={(_, state) => { setView({ scale: state.scale, x: state.positionX, y: state.positionY }); onZoomChange?.(state.scale, state.positionX, state.positionY); }}>
        {({ zoomIn, zoomOut, resetTransform }) => <>
          <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: fitWidth, height: fitHeight }}>
            <div className="relative shrink-0" style={{ width: fitWidth, height: fitHeight, background: 'repeating-conic-gradient(#222 0% 25%, #333 0% 50%) 0 / 16px 16px' }}>
              <img src={overview.url} alt={image.name} draggable={false} className="h-full w-full" />
              {detail && detailRegion && <img src={detail.url} alt="EXR inspection region" draggable={false} className="absolute" style={{ left: detailRegion.x / sourceWidth * fitWidth, top: detailRegion.y / sourceHeight * fitHeight, width: detailRegion.width / sourceWidth * fitWidth, height: detailRegion.height / sourceHeight * fitHeight }} />}
            </div>
          </TransformComponent>
          <div className="absolute bottom-2 left-2 flex gap-2"><button className={control} onClick={() => zoomOut()}>−</button><button className={control} onClick={() => zoomIn()}>+</button><button className={control} onClick={() => resetTransform()}>Fit</button></div>
        </>}
      </TransformWrapper>}
      {!overview && !error && !part?.deep && <div role="status" className="flex h-full items-center justify-center text-sm text-gray-400">Loading EXR…</div>}
      {part?.deep && <p className="absolute inset-x-0 top-3 text-center text-sm text-amber-300">Deep EXR parts are not supported.</p>}
      {error && <p role="alert" className="absolute inset-x-0 top-3 mx-3 rounded bg-gray-950/95 p-3 text-center text-sm text-amber-200">{error}</p>}
      {loading && overview && <span role="status" className="absolute right-2 top-2 text-xs text-gray-300">Updating…</span>}
    </div>
    {overview && <div className="shrink-0 px-2 py-1 text-xs text-gray-400">{sourceWidth} × {sourceHeight} · {overview.mode === 'color' ? `${overview.input}${overview.assumedInput ? ' (assumed)' : ''} · OCIO · ${exposure.toFixed(1)} EV` : `${overview.mode} diagnostic · OCIO bypassed`} · temporary view</div>}
    <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} initialTab="general" focusSection="exr" />
  </div>;
}

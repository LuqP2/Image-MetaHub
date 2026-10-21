import React, { useEffect, useState } from 'react';
import type { ExrColorProfile, ExrConfigInfo, ExrRuntimeStatus, ExrSettings } from '../../services/exr/contracts';
import { EXR_CONFIGS } from '../../services/exr/model';
import { unwrapExr } from '../../services/exr/client';
import { useImageStore } from '../../store/useImageStore';
import { SettingsSectionCard } from './SettingsSectionCard';

const control = 'rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 disabled:opacity-50';
export function ExrSettingsPanel() {
  const [status, setStatus] = useState<ExrRuntimeStatus | null>(null);
  const [settings, setSettings] = useState<ExrSettings | null>(null);
  const [config, setConfig] = useState<ExrConfigInfo | null>(null);
  const [scope, setScope] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const directories = useImageStore(s => s.directories);
  const api = window.electronAPI?.exr;
  const refresh = async () => {
    if (!api) return;
    const [state, preferences] = await Promise.all([api.status(), api.settings()]);
    setStatus(unwrapExr(state)); setSettings(unwrapExr(preferences));
  };
  useEffect(() => {
    if (!api) return;
    void refresh().catch(e => setError(String(e.message)));
    return api.onChanged(next => { if (next) setStatus(next); else void refresh().catch(e => setError(String(e.message))); });
  }, [api]);
  const profile = settings ? (scope ? settings.folders[scope] ?? settings.global : settings.global) : null;
  useEffect(() => {
    let current = true; setConfig(null);
    if (api && status?.installed && status.enabled && profile) void api.config(profile.config).then(unwrapExr).then(value => { if (current) setConfig(value); }).catch(e => { if (current) setError(String(e.message)); });
    return () => { current = false; };
  }, [api, status?.installed, status?.enabled, profile?.config]);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await work(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const saveProfile = (patch: Partial<ExrColorProfile>) => {
    if (!settings || !profile || !api) return;
    const next = { ...profile, ...patch };
    void run(async () => setSettings(unwrapExr(await api.saveSettings(scope ? { ...settings, folders: { ...settings.folders, [scope]: next } } : { ...settings, global: next }))));
  };
  const displays = config?.displays ?? [];
  const selectedDisplay = profile?.display || config?.defaultDisplay || '';
  const views = displays.find(d => d.name === selectedDisplay)?.views ?? [];
  const downloading = status && ['downloading', 'verifying', 'installing'].includes(status.phase ?? '');
  return <div className="space-y-4">
    <SettingsSectionCard title="EXR / OpenColorIO" description="Browse local renders with color-managed previews. Available for Free and Pro.">
      <p className="text-sm text-gray-400">Installed only when you request it. Processing works offline after installation. Original files are preserved.</p>
      {!api ? <p>EXR support requires the desktop app.</p> : <>
        <p className="text-sm text-gray-300">{status?.installed ? `Installed · ${status.version} · ${status.enabled ? 'Enabled' : 'Disabled'}` : 'Not installed'}{status?.downloadBytes ? ` · ${(status.downloadBytes / 1048576).toFixed(1)} MB download` : ''}</p>
        {status && !status.available && <p className="text-sm text-amber-300">The verified component package is not available for this app version/platform yet.</p>}
        <div className="flex flex-wrap gap-2">
          {!status?.installed && <button className={control} disabled={busy || !status?.available} onClick={() => void run(async () => unwrapExr(await api.install()))}>Install EXR support</button>}
          {status?.installed && settings && <>
            <button className={control} disabled={busy} onClick={() => void run(async () => unwrapExr(await api.saveSettings({ ...settings, enabled: !settings.enabled })))}>{settings.enabled ? 'Disable' : 'Enable'}</button>
            <button className={control} disabled={busy} onClick={() => void run(async () => unwrapExr(await api.remove()))}>Remove component</button>
          </>}
          {downloading && <button className={control} onClick={() => void api.cancelInstall()}>Cancel installation</button>}
        </div>
        {downloading && <div role="status" className="space-y-1 text-sm text-gray-300"><p>{status.phase} · {Math.round((status.receivedBytes ?? 0) / 1048576)} MB</p><progress className="w-full" value={status.receivedBytes ?? 0} max={status.downloadBytes || 1} /></div>}
      </>}
    </SettingsSectionCard>
    {profile && settings && api && <details className="rounded-2xl border border-gray-700/80 bg-gray-900/70 p-4 md:p-5">
      <summary className="cursor-pointer text-base font-semibold text-gray-100">Color settings</summary>
      <div className="mt-4 space-y-3">
      <label className="block text-sm text-gray-300">Apply to <select aria-label="Profile scope" className={`${control} ml-2 max-w-full`} value={scope} onChange={e => setScope(e.target.value)}>
        <option value="">Global default</option>
        {directories.filter(d => d.path).map(d => <option key={d.id} value={d.path}>{d.name}</option>)}
      </select></label>
      {scope && <div className="flex items-center gap-2 text-sm text-gray-400"><span>{settings.folders[scope] ? 'Folder override (inherited by subfolders)' : 'Inheriting global default'}</span>{settings.folders[scope] && <button className={control} disabled={busy} onClick={() => void run(async () => { const folders = { ...settings.folders }; delete folders[scope]; unwrapExr(await api.saveSettings({ ...settings, folders })); })}>Use global default</button>}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-300">Configuration<select className={control} disabled={busy} value={profile.config} onChange={e => saveProfile({ config: e.target.value, input: 'auto', display: '', view: '' })}>{EXR_CONFIGS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}{!EXR_CONFIGS.some(c => c.id === profile.config) && <option value={profile.config}>{profile.config}</option>}</select></label>
        <button className={`${control} self-end`} disabled={busy} onClick={() => void run(async () => { const selected = unwrapExr(await api.chooseConfig()); if (selected) { const next = { ...profile, config: selected, input: 'auto', display: '', view: '' }; unwrapExr(await api.saveSettings(scope ? { ...settings, folders: { ...settings.folders, [scope]: next } } : { ...settings, global: next })); } })}>Load config.ocio…</button>
        <label className="flex flex-col gap-1 text-sm text-gray-300">Input color space<select className={control} disabled={busy || !config} value={profile.input} onChange={e => saveProfile({ input: e.target.value })}><option value="auto">Auto (Linear sRGB if unknown)</option>{config?.spaces.map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm text-gray-300">Display<select className={control} disabled={busy || !config} value={profile.display} onChange={e => saveProfile({ display: e.target.value, view: '' })}><option value="">Configuration default</option>{displays.map(d => <option key={d.name}>{d.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm text-gray-300">View<select className={control} disabled={busy || !config} value={profile.view} onChange={e => saveProfile({ view: e.target.value })}><option value="">Configuration default</option>{views.map(v => <option key={v}>{v}</option>)}</select></label>
      </div>
      <p className="text-xs text-gray-400">Viewer adjustments are temporary. These defaults control new views and thumbnails. SDR sRGB presentation is supported; incompatible displays report an error.</p>
      </div>
    </details>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
  </div>;
}

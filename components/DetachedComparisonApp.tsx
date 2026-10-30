import React, { useEffect, useState } from 'react';
import { ComparisonSurface } from './ComparisonSurface';
import { useImageStore } from '../store/useImageStore';
import { useComparisonUIStore } from '../store/useComparisonUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useLicenseStore } from '../store/useLicenseStore';
import { resolveTheme } from '../src/theme/themeRegistry';
import type { ComparisonSnapshot } from '../services/comparisonContracts';
import type { IndexedImage, Directory } from '../types';
export default function DetachedComparisonApp() {
  const [snapshot, setSnapshot] = useState<ComparisonSnapshot | null>(null);
  const sessionId = new URLSearchParams(window.location.search).get('sessionId') || '';
  const theme = useSettingsStore(state => state.theme);
  useEffect(() => {
    let active = true;
    const apply = (dark: boolean) => { if (!active) return; const resolved = resolveTheme(theme, dark); document.documentElement.classList.toggle('dark', resolved.dark); document.documentElement.setAttribute('data-theme', resolved.id); };
    void window.electronAPI?.getTheme().then(value => apply(value.shouldUseDarkColors));
    const unsubscribe = window.electronAPI?.onThemeUpdated(value => apply(value.shouldUseDarkColors));
    return () => { active = false; unsubscribe?.(); };
  }, [theme]);
  useEffect(() => { void Promise.resolve(useLicenseStore.persist.rehydrate()).then(() => useLicenseStore.getState().checkLicenseStatus()); }, []);
  useEffect(() => {
    const api = window.electronAPI?.comparison; if (!api) return;
    let active = true; let initialized = false;
    const apply = (next: ComparisonSnapshot | null) => {
      if (!active || !next || next.sessionId !== sessionId) return;
      // UI is owned locally while detached. Later snapshots only refresh library records.
      if (!initialized) { initialized = true; useComparisonUIStore.setState({ ui: next.ui }); }
      useImageStore.setState({ comparisonImages: next.images as IndexedImage[], images: next.images as IndexedImage[], directories: next.directories as Directory[] });
      setSnapshot(next);
    };
    const unsubscribe = api.onSnapshot(apply);
    void api.ready(sessionId).then(apply);
    const unsubscribeUI = useComparisonUIStore.subscribe(state => { if (initialized) void api.command(sessionId, { type: 'ui', ui: state.ui }); });
    return () => { active = false; unsubscribe(); unsubscribeUI(); };
  }, [sessionId]);
  useEffect(() => { if (snapshot) void window.electronAPI?.comparison?.ready(sessionId, true); }, [snapshot, sessionId]);
  const api = window.electronAPI?.comparison;
  if (!snapshot) return <p role="status">Loading comparison…</p>;
  return <ComparisonSurface onGenerate={async request => { await api?.command(sessionId, { type: 'generate', request }); }} isOpen onClose={() => { void api?.close(sessionId); }} onReturn={() => { void api?.close(sessionId, true); }} onSwap={() => { void api?.command(sessionId, { type: 'swap' }); }} onRemove={index => { void api?.command(sessionId, { type: 'remove', index }); }} />;
}

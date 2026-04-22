import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { resetAllCaches } from '../../utils/cacheReset';
import { AdvancedSection } from './AdvancedSection';
import { SettingRow } from './SettingRow';
import { SettingsPanel } from './SettingsPanel';
import { SettingsSectionCard } from './SettingsSectionCard';
import { SettingSwitch } from './SettingSwitch';

const startupVerificationModeDetails: Record<
  'off' | 'idle' | 'strict',
  {
    label: string;
    title: string;
    description: string;
    impact: string;
  }
> = {
  off: {
    label: 'Off',
    title: 'Off',
    description: 'Open from cache only. Folder verification waits for later refreshes or file monitoring.',
    impact: 'Fastest startup.',
  },
  idle: {
    label: 'Background',
    title: 'Background',
    description: 'Open immediately, then verify saved folders a few seconds later in the background.',
    impact: 'Best balance for most libraries.',
  },
  strict: {
    label: 'Strict',
    title: 'Strict',
    description: 'Verify saved folders before startup finishes.',
    impact: 'Most accurate on open, but slowest for large libraries.',
  },
};

export const LibrarySettingsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const cachePath = useSettingsStore((state) => state.cachePath);
  const autoUpdate = useSettingsStore((state) => state.autoUpdate);
  const setCachePath = useSettingsStore((state) => state.setCachePath);
  const toggleAutoUpdate = useSettingsStore((state) => state.toggleAutoUpdate);
  const indexingConcurrency = useSettingsStore((state) => state.indexingConcurrency);
  const setIndexingConcurrency = useSettingsStore((state) => state.setIndexingConcurrency);
  const globalAutoWatch = useSettingsStore((state) => state.globalAutoWatch);
  const toggleGlobalAutoWatch = useSettingsStore((state) => state.toggleGlobalAutoWatch);
  const startupVerificationMode = useSettingsStore((state) => state.startupVerificationMode);
  const setStartupVerificationMode = useSettingsStore((state) => state.setStartupVerificationMode);
  const performanceDiagnosticsEnabled = useSettingsStore((state) => state.performanceDiagnosticsEnabled);
  const setPerformanceDiagnosticsEnabled = useSettingsStore((state) => state.setPerformanceDiagnosticsEnabled);

  const [currentCachePath, setCurrentCachePath] = useState('');
  const [defaultCachePath, setDefaultCachePath] = useState('');

  const hardwareConcurrency =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : null;
  const maxConcurrency = hardwareConcurrency
    ? Math.max(1, Math.min(16, Math.floor(hardwareConcurrency)))
    : 16;
  const selectedStartupVerificationMode = startupVerificationModeDetails[startupVerificationMode];

  useEffect(() => {
    window.electronAPI?.getDefaultCachePath()
      .then((result) => {
        if (result.success && result.path) {
          setDefaultCachePath(result.path);
          setCurrentCachePath(cachePath || result.path);
        }
      })
      .catch((error) => {
        console.error('Failed to get default cache path:', error);
      });
  }, [cachePath]);

  const handleSelectCacheDirectory = async () => {
    const result = await window.electronAPI?.showDirectoryDialog();
    if (result && result.success && result.path) {
      setCachePath(result.path);
      setCurrentCachePath(result.path);
    }
  };

  const handleResetCacheDirectory = () => {
    setCachePath(defaultCachePath);
    setCurrentCachePath(defaultCachePath);
  };

  const handleOpenCacheLocation = async () => {
    if (currentCachePath) {
      await window.electronAPI?.openCacheLocation(currentCachePath);
    }
  };

  const handleClearCache = async () => {
    const confirmed = window.confirm(
      [
        'Clear all cache and reset the app?',
        '',
        'This will:',
        '- delete indexed image metadata',
        '- remove loaded directories',
        '- clear search filters and selections',
        '- reset cache location and local settings',
        '',
        'Your image files will not be deleted.',
        'The app will reload after the reset.',
        '',
        'This action cannot be undone.',
      ].join('\n')
    );

    if (!confirmed) {
      return;
    }

    try {
      await resetAllCaches();
      alert('Cache cleared. The app will now reload to complete the reset.');
      onClose();
    } catch (error) {
      console.error('Failed to clear cache:', error);
      alert('Failed to clear cache. Check console for details.');
    }
  };

  return (
    <SettingsPanel title="Library" description="Performance, indexing, startup checks and cache storage.">
      <SettingsSectionCard title="Startup">
        <SettingRow
          label="File monitoring"
          description="Watch indexed folders for new or modified images."
          control={<SettingSwitch checked={globalAutoWatch} onChange={() => toggleGlobalAutoWatch()} />}
        />

        <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-100">Startup verification</p>
            <p className="text-sm text-gray-400">Choose how much Image MetaHub checks saved folders when it opens.</p>
          </div>

          <select
            value={startupVerificationMode}
            onChange={(event) => setStartupVerificationMode(event.target.value as 'off' | 'idle' | 'strict')}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          >
            <option value="off">{startupVerificationModeDetails.off.label}</option>
            <option value="idle">{startupVerificationModeDetails.idle.label}</option>
            <option value="strict">{startupVerificationModeDetails.strict.label}</option>
          </select>

          <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3">
            <p className="text-sm font-medium text-blue-100">{selectedStartupVerificationMode.title}</p>
            <p className="mt-1 text-sm text-blue-100/85">{selectedStartupVerificationMode.description}</p>
            <p className="mt-2 text-xs text-blue-200/70">{selectedStartupVerificationMode.impact}</p>
          </div>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="Indexing">
        <SettingRow
          label="Metadata workers"
          description="Increase on faster machines. Reduce if the UI becomes less responsive."
          control={
            <input
              type="number"
              min={1}
              max={maxConcurrency}
              value={indexingConcurrency}
              onChange={(event) => setIndexingConcurrency(Number(event.target.value) || 1)}
              className="w-24 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-right text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
          }
        />
        {hardwareConcurrency ? (
          <p className="text-sm text-gray-500">Detected {hardwareConcurrency} logical cores.</p>
        ) : null}
      </SettingsSectionCard>

      <SettingsSectionCard title="Cache location">
        <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3">
          <p className="truncate text-sm text-gray-200">{currentCachePath || 'Loading cache location...'}</p>
          {defaultCachePath ? <p className="mt-2 text-xs text-gray-500">Default: {defaultCachePath}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSelectCacheDirectory}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Change location
          </button>
          <button
            type="button"
            onClick={handleOpenCacheLocation}
            className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-gray-100 hover:bg-gray-600"
          >
            Open location
          </button>
          <button
            type="button"
            onClick={handleResetCacheDirectory}
            disabled={!defaultCachePath || currentCachePath === defaultCachePath}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset to default
          </button>
        </div>
      </SettingsSectionCard>

      <AdvancedSection title="Advanced / Troubleshooting" description="Less common options and recovery tools.">
        <SettingRow
          label="Check for updates on startup"
          description="Disable this to keep the app fully offline during launch."
          control={<SettingSwitch checked={autoUpdate} onChange={() => toggleAutoUpdate()} />}
        />
        <SettingRow
          label="Performance diagnostics"
          description="Collect renderer timing traces, React commit samples and long-task summaries in `window.__IMH_PERF__` and the console."
          control={
            <SettingSwitch
              checked={performanceDiagnosticsEnabled}
              onChange={setPerformanceDiagnosticsEnabled}
            />
          }
        />

        <SettingsSectionCard
          title="Clear all cache"
          description="Use this only when the library index or local settings need a full reset."
          tone="danger"
          className="space-y-3"
        >
          <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>This removes indexed metadata, loaded directories and local settings, but keeps your image files intact.</p>
          </div>
          <button
            type="button"
            onClick={handleClearCache}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            Clear all cache
          </button>
        </SettingsSectionCard>
      </AdvancedSection>
    </SettingsPanel>
  );
};

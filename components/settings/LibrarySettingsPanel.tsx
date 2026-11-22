import { useTranslation, type Translate } from '../../i18n/useTranslation';
import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DesktopRuntimeInfo } from '../../types';
import { createAnnotationBackup } from '../../services/annotationBackup';
import { useSemanticStore } from '../../store/useSemanticStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { clearLibraryCaches, LIBRARY_CACHE_REBUILD_KEY, resetAllCaches } from '../../utils/cacheReset';
import { AdvancedSection } from './AdvancedSection';
import { SettingRow } from './SettingRow';
import { SettingsPanel } from './SettingsPanel';
import { SettingsSectionCard } from './SettingsSectionCard';
import { SettingSwitch } from './SettingSwitch';

const getStartupVerificationModeDetails = (t: Translate): Record<
  'off' | 'idle' | 'strict',
  {
    label: string;
    title: string;
    description: string;
    impact: string;
  }
> => ({
  off: {
    label: t("settings.library.off"),
    title: t("settings.library.off"),
    description: t("settings.library.openFromCacheOnlyFolderVerificationWaits"),
    impact: t("settings.library.fastestStartup"),
  },
  idle: {
    label: t("settings.library.background"),
    title: t("settings.library.background"),
    description: t("settings.library.openImmediatelyThenVerifySavedFoldersA"),
    impact: t("settings.library.bestBalanceForMostLibraries"),
  },
  strict: {
    label: t("settings.library.strict"),
    title: t("settings.library.strict"),
    description: t("settings.library.verifySavedFoldersBeforeStartupFinishes"),
    impact: t("settings.library.mostAccurateOnOpenButSlowestFor"),
  },
});

export const LibrarySettingsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
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
  const [runtimeInfo, setRuntimeInfo] = useState<DesktopRuntimeInfo | null>(null);
  const [cacheLocationError, setCacheLocationError] = useState<string | null>(null);
  const [cacheClearState, setCacheClearState] = useState<'idle' | 'clearing' | 'reloading'>('idle');

  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState<{ message: string; error: boolean } | null>(null);

  const handleExportBackup = async () => {
    const api = window.electronAPI;
    if (!api?.showSaveDialog || !api?.writeFile) return;

    setIsExportingBackup(true);
    setBackupFeedback(null);
    try {
      const backup = await createAnnotationBackup();
      const result = await api.showSaveDialog({
        title: t("settings.library.exportTagsAndFavorites"),
        defaultPath: `Image-MetaHub-annotations-${backup.exportedAt.slice(0, 10)}.json`,
        filters: [{ name: t("settings.library.jsonBackup"), extensions: ['json'] }],
      });
      if (result.canceled) return;
      if (!result.success || !result.path) throw new Error(result.error || t("settings.library.couldNotSelectABackupFile"));

      const written = await api.writeFile(result.path, JSON.stringify(backup, null, 2));
      if (!written.success) throw new Error(written.error || t("settings.library.couldNotWriteTheBackupFile"));
      setBackupFeedback({ message: t("settings.library.backupSaved"), error: false });
    } catch (error) {
      setBackupFeedback({
        message: t("settings.library.backupFailure", { error: error instanceof Error ? error.message : String(error) }),
        error: true,
      });
    } finally {
      setIsExportingBackup(false);
    }
  };

  const hardwareConcurrency =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : null;
  const maxConcurrency = hardwareConcurrency
    ? Math.max(1, Math.min(16, Math.floor(hardwareConcurrency)))
    : 16;
  const startupVerificationModeDetails = getStartupVerificationModeDetails(t);
  const selectedStartupVerificationMode = startupVerificationModeDetails[startupVerificationMode];
  const isPortable = runtimeInfo?.isPortable === true;

  useEffect(() => {
    window.electronAPI?.getRuntimeInfo?.()
      .then(setRuntimeInfo)
      .catch((error) => {
        console.error('Failed to get desktop runtime information:', error);
      });
  }, []);

  useEffect(() => {
    window.electronAPI?.getDefaultCachePath()
      .then((result) => {
        if (result.success && result.path) {
          setDefaultCachePath(result.path);
          setCurrentCachePath(isPortable ? result.path : cachePath || result.path);
        }
      })
      .catch((error) => {
        console.error('Failed to get default cache path:', error);
      });
  }, [cachePath, isPortable]);

  const handleSelectCacheDirectory = async () => {
    const result = await window.electronAPI?.showDirectoryDialog();
    if (result && result.success && result.path) {
      await useSemanticStore.getState().teardown();
      setCachePath(result.path);
      setCurrentCachePath(result.path);
    }
  };

  const handleResetCacheDirectory = async () => {
    await useSemanticStore.getState().teardown();
    setCachePath(defaultCachePath);
    setCurrentCachePath(defaultCachePath);
  };

  const handleOpenCacheLocation = async () => {
    if (!currentCachePath || !window.electronAPI?.openCacheLocation) {
      return;
    }

    setCacheLocationError(null);
    try {
      const result = await window.electronAPI.openCacheLocation();
      if (!result.success) {
        setCacheLocationError(result.error || t("settings.library.failedToOpenTheCacheLocation"));
      }
    } catch (error) {
      setCacheLocationError(
        error instanceof Error ? error.message : t("settings.library.failedToOpenTheCacheLocation"),
      );
    }
  };

  const handleClearLibraryCache = async () => {
    if (cacheClearState !== 'idle') return;

    const confirmed = window.confirm(
      [
        t("settings.library.clearLibraryCacheQuestion"),
        '',
        t("settings.library.thisWillRemoveCachedIndexedMetadataThumbnails"),
        '',
        t("settings.library.yourImageFilesSavedFoldersPreferencesTags"),
        t("settings.library.theAppWillReloadSoTheLibrary"),
      ].join('\n')
    );

    if (!confirmed) {
      return;
    }

    setCacheClearState('clearing');
    try {
      await clearLibraryCaches();
      sessionStorage.setItem(LIBRARY_CACHE_REBUILD_KEY, '1');
      setCacheClearState('reloading');
      // Allow the reload status to paint before replacing the renderer.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      window.location.reload();
    } catch (error) {
      setCacheClearState('idle');
      console.error('Failed to clear library cache:', error);
      alert(t("settings.library.failedToClearLibraryCacheCheckConsole"));
    }
  };

  const handleResetAppData = async () => {
    const confirmed = window.confirm(
      [
        t("settings.library.resetAppDataQuestion"),
        '',
        t("settings.library.thisWill"),
        t("settings.library.deleteIndexedImageMetadata"),
        t("settings.library.removeLoadedDirectories"),
        t("settings.library.clearSearchFiltersAndSelections"),
        t("settings.library.resetCacheLocationAndLocalSettings"),
        t("settings.library.clearTagsRatingsSmartCollectionsAndAutomation"),
        '',
        t("settings.library.yourImageFilesWillNotBeDeleted"),
        t("settings.library.yourLicenseAndTrialStateWillBe"),
        t("settings.library.savedPromptsWillBeKept"),
        t("settings.library.theAppWillReloadAfterTheReset"),
        '',
        t("settings.library.thisActionCannotBeUndone"),
      ].join('\n')
    );

    if (!confirmed) {
      return;
    }

    try {
      await resetAllCaches();
      alert(t("settings.library.appDataResetTheAppWillNow"));
      onClose();
    } catch (error) {
      console.error('Failed to reset app data:', error);
      alert(t("settings.library.failedToResetAppDataCheckConsole"));
    }
  };

  return (
    <SettingsPanel title={t("settings.library.library")}>
      <SettingsSectionCard title={t("settings.library.startup")}>
        <SettingRow
          label={t("settings.library.fileMonitoring")}
          description={t("settings.library.watchIndexedFoldersForNewOrModified")}
          control={<SettingSwitch checked={globalAutoWatch} onChange={() => toggleGlobalAutoWatch()} />}
        />

        <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-100">{t("settings.library.startupVerification")}</p>
            <p className="text-sm text-gray-400">{t("settings.library.chooseHowMuchImageMetahubChecksSaved")}</p>
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
            <p className="text-sm font-medium text-blue-100 light:text-blue-900">{selectedStartupVerificationMode.title}</p>
            <p className="mt-1 text-sm text-blue-100/85 light:text-blue-900/85">{selectedStartupVerificationMode.description}</p>
            <p className="mt-2 text-xs text-blue-200/70 light:text-blue-800/80">{selectedStartupVerificationMode.impact}</p>
          </div>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title={t("settings.library.indexing")}>
        <SettingRow
          label={t("settings.library.metadataWorkers")}
          description={t("settings.library.increaseOnFasterMachinesReduceIfThe")}
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
          <p className="text-sm text-gray-500">{t("settings.library.detectedCores", { count: hardwareConcurrency })}</p>
        ) : null}
      </SettingsSectionCard>

      {window.electronAPI?.showSaveDialog && window.electronAPI?.writeFile && (
        <SettingsSectionCard title={t("settings.library.backup")}>
          <SettingRow
            label={t("settings.library.tagsAndFavorites")}
            description={t("settings.library.saveAJsonBackupOfYourTag")}
            control={
              <button
                type="button"
                disabled={isExportingBackup}
                onClick={handleExportBackup}
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50"
              >
                {isExportingBackup ? t("settings.library.exporting") : t("settings.library.exportBackup")}
              </button>
            }
          />
          {backupFeedback && (
            <p role={backupFeedback.error ? 'alert' : 'status'} className={backupFeedback.error ? 'text-sm text-red-400' : 'text-sm text-gray-300'}>
              {backupFeedback.message}
            </p>
          )}
        </SettingsSectionCard>
      )}

      <SettingsSectionCard title={isPortable ? t("settings.library.portableStorage") : t("settings.library.cacheLocation")}>
        <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3">
          <p className="truncate text-sm text-gray-200">{currentCachePath || t("settings.library.loadingCacheLocation")}</p>
          {isPortable ? (
            <p className="mt-2 text-xs text-gray-500">{t("settings.library.settingsBrowserDataAndCachesStayWith")}</p>
          ) : defaultCachePath ? (
            <p className="mt-2 text-xs text-gray-500">{t("settings.library.default")} {defaultCachePath}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {!isPortable ? (
            <button
              type="button"
              onClick={handleSelectCacheDirectory}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 hover:text-gray-950"
            >
              {t("settings.library.changeLocation")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleOpenCacheLocation}
            className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-gray-100 hover:bg-gray-600"
          >
            {t("settings.library.openLocation")}
          </button>
          {!isPortable ? (
            <button
              type="button"
              onClick={handleResetCacheDirectory}
              disabled={!defaultCachePath || currentCachePath === defaultCachePath}
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("settings.library.resetToDefault")}
            </button>
          ) : null}
        </div>
        {cacheLocationError ? (
          <p role="alert" className="text-sm text-red-400">{cacheLocationError}</p>
        ) : null}
      </SettingsSectionCard>

      <AdvancedSection title={t("settings.library.advancedTroubleshooting")} description={t("settings.library.lessCommonOptionsAndRecoveryTools")}>
        <SettingRow
          label={t("settings.library.checkForUpdatesOnStartup")}
          description={isPortable
            ? t("settings.library.portableBuildsAreUpdatedManuallyFromGithub")
            : t("settings.library.disableThisToKeepTheAppFully")}
          control={(
            <SettingSwitch
              checked={isPortable ? false : autoUpdate}
              onChange={() => toggleAutoUpdate()}
              disabled={isPortable}
            />
          )}
        />
        <SettingRow
          label={t("settings.library.performanceDiagnostics")}
          description={t("settings.library.diagnosticsHelp")}
          control={
            <SettingSwitch
              checked={performanceDiagnosticsEnabled}
              onChange={setPerformanceDiagnosticsEnabled}
            />
          }
        />

        <SettingsSectionCard
          title={t("settings.library.clearLibraryCache")}
          description={t("settings.library.rebuildIndexedMetadataThumbnailsAndSmartLibrary")}
          className="space-y-3"
        >
          <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3 text-sm text-gray-300">
            <p>{t("settings.library.removesOnlyCacheDataThatCanBe")}</p>
          </div>
          <button
            type="button"
            onClick={handleClearLibraryCache}
            disabled={cacheClearState !== 'idle'}
            className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-gray-100 enabled:hover:bg-gray-600 disabled:cursor-wait disabled:opacity-70"
          >
            {cacheClearState === 'clearing' ? t("settings.library.clearingLibraryCache") : cacheClearState === 'reloading' ? t("settings.library.reloadingLibrary") : t("settings.library.clearLibraryCache")}
          </button>
          <span role="status" className="sr-only">
            {cacheClearState === 'clearing' ? t("settings.library.clearingLibraryCache") : cacheClearState === 'reloading' ? t("settings.library.reloadingLibrary") : ''}
          </span>
        </SettingsSectionCard>

        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-red-100">{t("settings.library.dangerZone")}</h3>
            <p className="text-sm text-gray-400">{t("settings.library.destructiveLocalRecoveryActionsImageFilesLicense")}</p>
          </div>

          <SettingsSectionCard
            title={t("settings.library.resetAppData")}
            description={t("settings.library.useThisWhenLocalAppStateNeeds")}
            tone="danger"
            className="space-y-3"
          >
            <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{t("settings.library.thisRemovesSavedFoldersPreferencesFiltersAnnotations")}</p>
            </div>
            <button
              type="button"
              onClick={handleResetAppData}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              {t("settings.library.resetAppData")}
            </button>
          </SettingsSectionCard>
        </div>
      </AdvancedSection>
    </SettingsPanel>
  );
};

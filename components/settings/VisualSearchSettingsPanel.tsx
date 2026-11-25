import { useTranslation, type Translate } from '../../i18n/useTranslation';
import React, { useEffect } from 'react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useSemanticStore, deleteSemanticModel } from '../../store/useSemanticStore';
import { useFeatureAccess, SEMANTIC_FREE_TIER_LIMIT } from '../../hooks/useFeatureAccess';
import { EMBEDDING_MODELS, getEmbeddingModel } from '../../services/embeddings/embeddingModel';
import { getModelDownloadSize } from '../../services/embeddings/embeddingService';
import { SettingRow } from './SettingRow';
import { SettingsPanel } from './SettingsPanel';
import { SettingsSectionCard } from './SettingsSectionCard';
import { SettingSwitch } from './SettingSwitch';
import type { SemanticSearchPrecision } from '../../services/embeddings/semanticSearchPrecision';

const getPrecisionOptions = (t: Translate): Array<{
  value: SemanticSearchPrecision;
  label: string;
  description: string;
}> => [
  { value: 'broad', label: t("settings.visualSearch.moreResults"), description: t("settings.visualSearch.includesWeakerMatches") },
  { value: 'balanced', label: t("settings.visualSearch.balanced"), description: t("settings.visualSearch.recommendedDefault") },
  { value: 'strict', label: t("settings.visualSearch.morePrecise"), description: t("settings.visualSearch.onlyResultsCloseToTheBestMatches") },
];

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
};

const formatEta = (t: Translate, ms?: number): string => {
  if (!ms || !Number.isFinite(ms)) return '';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return t("settings.visualSearch.underAMinuteLeft");
  if (minutes < 60) return t("settings.visualSearch.minutesLeft", { minutes });
  return t("settings.visualSearch.hoursLeft", { hours: (minutes / 60).toFixed(1) });
};

export const VisualSearchSettingsPanel: React.FC = () => {
  const { t } = useTranslation();
  const enabled = useSettingsStore((s) => s.semanticSearchEnabled);
  const setEnabled = useSettingsStore((s) => s.setSemanticSearchEnabled);
  const deviceSetting = useSettingsStore((s) => s.semanticSearchDevice);
  const setDeviceSetting = useSettingsStore((s) => s.setSemanticSearchDevice);
  const modelSetting = useSettingsStore((s) => s.semanticSearchModel);
  const setModelSetting = useSettingsStore((s) => s.setSemanticSearchModel);
  const precisionSetting = useSettingsStore((s) => s.semanticSearchPrecision);
  const setPrecisionSetting = useSettingsStore((s) => s.setSemanticSearchPrecision);

  const { semanticSearchImageLimit, canUseUnlimitedSemanticSearch } = useFeatureAccess();

  const {
    device,
    activeDevice,
    modelInstalled,
    gpuModelInstalled,
    modelDownloading,
    modelProgress,
    indexProgress,
    coverage,
    isBackfilling,
    isPaused,
    lastError,
    setDevice,
    setModel,
    refreshModelStatus,
    startModelDownload,
    cancelModelDownload,
    openForLibrary,
    startBackfill,
    pauseBackfill,
    resumeBackfill,
    cancelBackfill,
    deleteIndex,
    teardown,
  } = useSemanticStore();

  const handleEnabledChange = async (nextEnabled: boolean) => {
    if (!nextEnabled) {
      // Keep the controls visible until cancellation has reached the backfill
      // flush and the download handler has settled, then tear workers down.
      await teardown();
    }
    setEnabled(nextEnabled);
  };

  // Keep the engine's backend and model in sync with the persisted settings.
  useEffect(() => {
    setDevice(deviceSetting === 'webgpu' ? 'webgpu' : 'wasm');
  }, [deviceSetting, setDevice]);

  useEffect(() => {
    void setModel(getEmbeddingModel(modelSetting).key);
  }, [modelSetting, setModel]);

  useEffect(() => {
    if (enabled) {
      refreshModelStatus();
      openForLibrary();
    }
  }, [enabled, refreshModelStatus, openForLibrary]);

  const activeModel = getEmbeddingModel(modelSetting);
  const usingGpu = device === 'webgpu';
  // GPU selected but its towers aren't downloaded yet: the worker will run on CPU
  // until they are, so make that explicit rather than looking broken.
  const gpuNeedsDownload = usingGpu && modelInstalled && !gpuModelInstalled;

  const cap = canUseUnlimitedSemanticSearch ? null : SEMANTIC_FREE_TIER_LIMIT;

  const downloadPercent = modelProgress?.totalBytes
    ? Math.min(100, Math.round(((modelProgress.receivedBytes ?? 0) / modelProgress.totalBytes) * 100))
    : 0;
  const indexPercent = indexProgress?.total
    ? Math.min(100, Math.round((indexProgress.current / indexProgress.total) * 100))
    : 0;

  return (
    <SettingsPanel
      title={t("settings.visualSearch.localVisualSearch")}
    >
      <SettingsSectionCard title={t("settings.visualSearch.localVisualSearchSection")}>
        <SettingRow
          label={t("settings.visualSearch.enableLocalVisualSearch")}
          description={t("settings.visualSearch.optInToARebuildableOnDevice")}
          control={<SettingSwitch checked={enabled} onChange={handleEnabledChange} />}
        />

        {enabled && (
          <SettingRow
            label={t("settings.visualSearch.useGpuAccelerationWebgpu")}
            description={t("settings.visualSearch.muchFasterIndexingOnASupportedGpu")}
            control={<SettingSwitch checked={deviceSetting === 'webgpu'} onChange={(v) => setDeviceSetting(v ? 'webgpu' : 'wasm')} />}
          />
        )}

        {enabled && (
          <div className="space-y-4">
            {/* Model choice */}
            <div className="rounded-md border border-gray-800 bg-gray-950/60 px-4 py-3 space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-100">{t("settings.visualSearch.imageEmbeddingModel")}</p>
                <p className="text-xs text-gray-400">
                  {t("settings.visualSearch.bothRunEntirelyOnYourMachineAnd")}
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {Object.values(EMBEDDING_MODELS).map((option) => {
                  const selected = option.key === activeModel.key;
                  return (
                    <button
                      key={option.key}
                      onClick={() => setModelSetting(option.key)}
                      disabled={isBackfilling || modelDownloading}
                      aria-pressed={selected}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        selected
                          ? 'border-accent bg-accent/10 light:border-accent/60 light:bg-accent/10'
                          : 'border-gray-700 hover:bg-gray-800/60'
                      }`}
                    >
                      <p className={`text-xs font-medium ${selected ? 'text-accent light:text-gray-100' : 'text-gray-200'}`}>
                        {option.key === 'clip-b32' ? t('settings.visualSearch.balancedModel') : t('settings.visualSearch.higherQualityModel')}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-gray-400">{option.key === 'clip-b32' ? t('settings.visualSearch.balancedModelHelp') : t('settings.visualSearch.higherQualityModelHelp')}</p>
                    </button>
                  );
                })}
              </div>

              {(isBackfilling || modelDownloading) && (
                <p className="text-[11px] text-gray-500">
                  {isBackfilling ? t("settings.visualSearch.switchingWhileIndexing") : t("settings.visualSearch.switchingWhileDownloading")}
                </p>
              )}
            </div>

            <div className="rounded-md border border-gray-800 bg-gray-950/60 px-4 py-3 space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-100">{t("settings.visualSearch.experimentalTextQueryMatching")}</p>
                <p className="text-xs text-gray-400">
                  {t("settings.visualSearch.textToImageResultsAreApproximateAnd")}
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                {getPrecisionOptions(t).map((option) => {
                  const selected = option.value === precisionSetting;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPrecisionSetting(option.value)}
                      aria-pressed={selected}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                        selected
                          ? 'border-accent bg-accent/10 light:border-accent/60 light:bg-accent/10'
                          : 'border-gray-700 hover:bg-gray-800/60'
                      }`}
                    >
                      <p className={`text-xs font-medium ${selected ? 'text-accent light:text-gray-100' : 'text-gray-200'}`}>
                        {option.label}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-gray-400">{option.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Model download */}
            <div className="rounded-md border border-gray-800 bg-gray-950/60 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-100">{t("settings.visualSearch.searchModel")}</p>
                  <p className="text-xs text-gray-400">
                    {t("settings.visualSearch.modelDownloadSize", { model: activeModel.id, size: formatBytes(getModelDownloadSize(device, activeModel.key)) })}
                  </p>
                </div>
                {modelDownloading ? (
                  <button
                    onClick={cancelModelDownload}
                    className="ui-btn"
                  >
                    {t("settings.visualSearch.cancel")}
                  </button>
                ) : !modelInstalled || gpuNeedsDownload ? (
                  <button
                    onClick={startModelDownload}
                    className="ui-btn-primary"
                  >
                    {gpuNeedsDownload ? t("settings.visualSearch.downloadGpuModel") : t("settings.visualSearch.downloadModel")}
                  </button>
                ) : (
                  <span className="text-xs font-medium text-emerald-400 light:text-emerald-800">
                    {t("settings.visualSearch.installed")}{usingGpu ? (activeDevice === 'webgpu' ? ' ' + t("settings.visualSearch.gpuSuffix") : ' ' + t("settings.visualSearch.cpuGpuUnavailable")) : ''}
                  </span>
                )}
              </div>

              {modelDownloading && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${downloadPercent}%` }} />
                  </div>
                  <p className="text-xs text-gray-500">
                    {modelProgress?.file} · {formatBytes(modelProgress?.receivedBytes ?? 0)}
                    {modelProgress?.totalBytes ? ` / ${formatBytes(modelProgress.totalBytes)}` : ''}
                  </p>
                </div>
              )}
            </div>

            {/* Index build */}
            {modelInstalled && (
              <div className="rounded-md border border-gray-800 bg-gray-950/60 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-100">{t("settings.visualSearch.searchIndex")}</p>
                    <p className="text-xs text-gray-400">
                      {coverage
                        ? t("settings.visualSearch.indexCoverage", { indexed: coverage.embedded, total: coverage.total })
                        : t("settings.visualSearch.notBuiltYet")}
                      {cap !== null ? t("settings.visualSearch.freeCap", { limit: cap }) : ''}
                    </p>
                  </div>
                  {isBackfilling ? (
                    <div className="flex items-center gap-2">
                      {isPaused ? (
                        <button
                          onClick={resumeBackfill}
                          className="ui-btn"
                        >
                          {t("settings.visualSearch.resume")}
                        </button>
                      ) : (
                        <button
                          onClick={pauseBackfill}
                          className="ui-btn"
                        >
                          {t("settings.visualSearch.pause")}
                        </button>
                      )}
                      <button
                        onClick={cancelBackfill}
                        className="ui-btn"
                      >
                        {t("settings.visualSearch.stop")}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startBackfill(cap)}
                      className="ui-btn-primary"
                    >
                      {coverage && coverage.embedded > 0 ? t("settings.visualSearch.updateIndex") : t("settings.visualSearch.buildIndex")}
                    </button>
                  )}
                </div>

                {isBackfilling && indexProgress && (
                  <div className="space-y-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${indexPercent}%` }} />
                    </div>
                    <p className="text-xs text-gray-500">
                      {indexProgress.current.toLocaleString()} / {indexProgress.total.toLocaleString()}
                      {indexProgress.imagesPerSecond ? ` · ${indexProgress.imagesPerSecond.toFixed(1)}/s` : ''}
                      {indexProgress.etaMs ? ` · ${formatEta(t, indexProgress.etaMs)}` : ''}
                    </p>
                  </div>
                )}

                {!canUseUnlimitedSemanticSearch && coverage && coverage.total > SEMANTIC_FREE_TIER_LIMIT && (
                  <p className="text-xs text-accent/80 light:text-accent">
                    {t("settings.visualSearch.upgradeForFullCoverage", { limit: SEMANTIC_FREE_TIER_LIMIT, total: coverage.total })}
                  </p>
                )}
              </div>
            )}

            {lastError && (
              <p className="text-xs text-red-400">
                {lastError === 'Model download failed' ? t('settings.visualSearch.modelDownloadFailed') : lastError}
              </p>
            )}

            {/* Danger zone */}
            {(modelInstalled || (coverage?.embedded ?? 0) > 0) && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={deleteIndex}
                  className="ui-btn"
                >
                  {t("settings.visualSearch.deleteSearchIndex")}
                </button>
                <button
                  onClick={deleteSemanticModel}
                  className="ui-btn"
                >
                  {t("settings.visualSearch.removeDownloadedModel")}
                </button>
              </div>
            )}
          </div>
        )}
      </SettingsSectionCard>
    </SettingsPanel>
  );
};

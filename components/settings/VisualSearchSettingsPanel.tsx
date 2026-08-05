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

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
};

const formatEta = (ms?: number): string => {
  if (!ms || !Number.isFinite(ms)) return '';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under a minute left';
  if (minutes < 60) return `~${minutes} min left`;
  return `~${(minutes / 60).toFixed(1)} h left`;
};

export const VisualSearchSettingsPanel: React.FC = () => {
  const enabled = useSettingsStore((s) => s.semanticSearchEnabled);
  const setEnabled = useSettingsStore((s) => s.setSemanticSearchEnabled);
  const deviceSetting = useSettingsStore((s) => s.semanticSearchDevice);
  const setDeviceSetting = useSettingsStore((s) => s.setSemanticSearchDevice);
  const modelSetting = useSettingsStore((s) => s.semanticSearchModel);
  const setModelSetting = useSettingsStore((s) => s.setSemanticSearchModel);

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
  } = useSemanticStore();

  // Keep the engine's backend and model in sync with the persisted settings.
  useEffect(() => {
    setDevice(deviceSetting === 'webgpu' ? 'webgpu' : 'wasm');
  }, [deviceSetting, setDevice]);

  useEffect(() => {
    setModel(getEmbeddingModel(modelSetting).key);
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
      title="Visual Search"
      description="Find images by what they show — including screenshots and downloads with no prompt. Runs entirely on your machine."
    >
      <SettingsSectionCard title="Local visual search">
        <SettingRow
          label="Enable visual search"
          description="Builds a small on-device index of what each image looks like. Nothing is uploaded — the only network request is a one-time model download."
          control={<SettingSwitch checked={enabled} onChange={setEnabled} />}
        />

        {enabled && (
          <SettingRow
            label="Use GPU acceleration (WebGPU)"
            description="Much faster indexing on a supported GPU, using a separate fp16 model. May compete for VRAM with image generation — leave off while generating. Falls back to CPU automatically if the GPU is unavailable."
            control={<SettingSwitch checked={deviceSetting === 'webgpu'} onChange={(v) => setDeviceSetting(v ? 'webgpu' : 'wasm')} />}
          />
        )}

        {enabled && (
          <div className="space-y-4">
            {/* Model choice */}
            <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3 space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-100">Search quality</p>
                <p className="text-xs text-gray-400">
                  Both run entirely on your machine and produce the same index size and search speed —
                  they differ only in how much detail they look at, and so in how long indexing takes.
                  Each keeps its own index, so switching back never re-indexes.
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
                          ? 'border-indigo-500 bg-indigo-500/10'
                          : 'border-gray-700 hover:bg-gray-800/60'
                      }`}
                    >
                      <p className={`text-xs font-medium ${selected ? 'text-indigo-200' : 'text-gray-200'}`}>
                        {option.label}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-gray-400">{option.description}</p>
                    </button>
                  );
                })}
              </div>

              {(isBackfilling || modelDownloading) && (
                <p className="text-[11px] text-gray-500">
                  Switching is disabled while {isBackfilling ? 'the index is building' : 'the model is downloading'}.
                </p>
              )}
            </div>

            {/* Model download */}
            <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-100">Search model</p>
                  <p className="text-xs text-gray-400">
                    {activeModel.id} · one-time download, about {formatBytes(getModelDownloadSize(device, activeModel.key))} from huggingface.co
                  </p>
                </div>
                {modelDownloading ? (
                  <button
                    onClick={cancelModelDownload}
                    className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800"
                  >
                    Cancel
                  </button>
                ) : !modelInstalled || gpuNeedsDownload ? (
                  <button
                    onClick={startModelDownload}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                  >
                    {gpuNeedsDownload ? 'Download GPU model' : 'Download model'}
                  </button>
                ) : (
                  <span className="text-xs font-medium text-emerald-400">
                    Installed{usingGpu ? (activeDevice === 'webgpu' ? ' · GPU' : ' · CPU (GPU unavailable)') : ''}
                  </span>
                )}
              </div>

              {modelDownloading && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                    <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${downloadPercent}%` }} />
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
              <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-100">Search index</p>
                    <p className="text-xs text-gray-400">
                      {coverage
                        ? `${coverage.embedded.toLocaleString()} of ${coverage.total.toLocaleString()} images indexed`
                        : 'Not built yet'}
                      {cap !== null ? ` · Free indexes your ${cap.toLocaleString()} newest` : ''}
                    </p>
                  </div>
                  {isBackfilling ? (
                    <div className="flex items-center gap-2">
                      {isPaused ? (
                        <button
                          onClick={resumeBackfill}
                          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800"
                        >
                          Resume
                        </button>
                      ) : (
                        <button
                          onClick={pauseBackfill}
                          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800"
                        >
                          Pause
                        </button>
                      )}
                      <button
                        onClick={cancelBackfill}
                        className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800"
                      >
                        Stop
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startBackfill(cap)}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                    >
                      {coverage && coverage.embedded > 0 ? 'Update index' : 'Build index'}
                    </button>
                  )}
                </div>

                {isBackfilling && indexProgress && (
                  <div className="space-y-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                      <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${indexPercent}%` }} />
                    </div>
                    <p className="text-xs text-gray-500">
                      {indexProgress.current.toLocaleString()} / {indexProgress.total.toLocaleString()}
                      {indexProgress.imagesPerSecond ? ` · ${indexProgress.imagesPerSecond.toFixed(1)}/s` : ''}
                      {indexProgress.etaMs ? ` · ${formatEta(indexProgress.etaMs)}` : ''}
                    </p>
                  </div>
                )}

                {!canUseUnlimitedSemanticSearch && coverage && coverage.total > SEMANTIC_FREE_TIER_LIMIT && (
                  <p className="text-xs text-indigo-300/80">
                    Free indexes your {SEMANTIC_FREE_TIER_LIMIT.toLocaleString()} newest images. Upgrade to Pro to search all {coverage.total.toLocaleString()}.
                  </p>
                )}
              </div>
            )}

            {lastError && (
              <p className="text-xs text-red-400">{lastError}</p>
            )}

            {/* Danger zone */}
            {(modelInstalled || (coverage?.embedded ?? 0) > 0) && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={deleteIndex}
                  className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
                >
                  Delete search index
                </button>
                <button
                  onClick={deleteSemanticModel}
                  className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
                >
                  Remove downloaded model
                </button>
              </div>
            )}
          </div>
        )}
      </SettingsSectionCard>
    </SettingsPanel>
  );
};

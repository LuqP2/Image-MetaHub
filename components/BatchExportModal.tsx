import { useTranslation, type MessageKey } from '../i18n/useTranslation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { getPersistedShadowMetadata } from '../services/userDataPersistenceAdapter';
import { buildEffectiveMetadata } from '../utils/editableMetadata';
import {
  type ExportFileDescriptor,
  type ExportBatchProgress,
  type IndexedImage,
  type MetadataExportPolicy,
} from '../types';
import { getUnsupportedModel3DBatchExportError } from '../utils/model3DTransfer';
import { getRelativeImagePath } from '../utils/imagePaths';
import { useTeamWorkspaceStore } from '../store/useTeamWorkspaceStore';
import { filterApprovedDeliveryImages } from '../services/team/reviewService';
import {
  buildProvenanceAuditEntries,
  serializeAuditReportCsv,
  serializeAuditReportHtml,
  serializeAuditReportJson,
} from '../services/team/auditReportService';

interface BatchExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedImageIds: Set<string>;
  filteredImages: IndexedImage[];
  allImages?: IndexedImage[];
  directories: { id: string; path: string }[];
  requestedImageIds?: string[] | null;
  preferredSource?: BatchSource | null;
  restrictToRequestedSelection?: boolean;
}

type BatchSource = 'selected' | 'filtered';
type BatchOutput = 'folder' | 'zip';

const METADATA_REWRITE_SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);

const getScopeFromSelection = (source: BatchSource, count: number) => {
  if (source === 'selected') {
    return count === 1 ? 'single' : 'selected';
  }

  return 'filtered';
};

const resolveDefaultSource = (
  hasSelected: boolean,
  preferredSource?: BatchSource | null
): BatchSource => {
  if (preferredSource === 'filtered') {
    return 'filtered';
  }

  if (hasSelected) {
    return 'selected';
  }

  return 'filtered';
};

type ExportStatus = { type: 'success' | 'error' } & (
  | { key: MessageKey; values?: Record<string, number> }
  | { message: string }
);

const BatchExportModal: React.FC<BatchExportModalProps> = ({
  isOpen,
  onClose,
  selectedImageIds,
  filteredImages,
  allImages,
  directories,
  requestedImageIds,
  preferredSource,
  restrictToRequestedSelection = false,
}) => {
  const { t } = useTranslation();
  const availableImages = allImages ?? filteredImages;
  const effectiveSelectedImageIds = useMemo(
    () => (requestedImageIds && requestedImageIds.length > 0 ? requestedImageIds : Array.from(selectedImageIds)),
    [requestedImageIds, selectedImageIds]
  );
  const selectedImages = useMemo(() => {
    const imageLookup = new Map<string, IndexedImage>();

    for (const image of availableImages) {
      imageLookup.set(image.id, image);
    }

    for (const image of filteredImages) {
      if (!imageLookup.has(image.id)) {
        imageLookup.set(image.id, image);
      }
    }

    return effectiveSelectedImageIds
      .map((imageId) => imageLookup.get(imageId))
      .filter((image): image is IndexedImage => Boolean(image));
  }, [availableImages, effectiveSelectedImageIds, filteredImages]);
  const hasSelected = selectedImages.length > 0;

  const [source, setSource] = useState<BatchSource>(resolveDefaultSource(hasSelected));
  const [output, setOutput] = useState<BatchOutput>('folder');
  const [metadataPolicy, setMetadataPolicy] = useState<MetadataExportPolicy>('preserve');
  const [applyShadowEdits, setApplyShadowEdits] = useState(true);
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [includeAuditReport, setIncludeAuditReport] = useState(true);
  const teamWorkspacesById = useTeamWorkspaceStore((state) => state.workspacesById);
  const teamAssetStatesByWorkspace = useTeamWorkspaceStore((state) => state.assetStatesByWorkspace);
  const hasActiveTeamWorkspace = Object.keys(teamWorkspacesById).length > 0;
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<ExportStatus | null>(null);
  const [progress, setProgress] = useState<ExportBatchProgress | null>(null);
  const [activeExportId, setActiveExportId] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const activeExportIdRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!hasSelected && source === 'selected') {
      setSource('filtered');
    }
  }, [hasSelected, source]);

  useEffect(() => {
    // Only enforce 'selected' source when restricted AND images are actually available
    // This prevents oscillation with the fallback effect below
    if (restrictToRequestedSelection && hasSelected && source !== 'selected') {
      setSource('selected');
    }
  }, [restrictToRequestedSelection, hasSelected, source]);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setStatus(null);
      setIsExporting(false);
      setSource(resolveDefaultSource(hasSelected, preferredSource));
      setOutput('folder');
      setMetadataPolicy('preserve');
      setApplyShadowEdits(true);
      setApprovedOnly(false);
      setIncludeAuditReport(true);
      setProgress(null);
      setActiveExportId(null);
      setExportPath(null);
      setIsCancelling(false);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, hasSelected, preferredSource]);

  useEffect(() => {
    activeExportIdRef.current = activeExportId;
  }, [activeExportId]);

  const baseImagesToExport = source === 'selected' ? selectedImages : filteredImages;
  const approvedImagesInSource = useMemo(
    () => (hasActiveTeamWorkspace
      ? filterApprovedDeliveryImages(baseImagesToExport, directories, teamWorkspacesById, teamAssetStatesByWorkspace)
      : []),
    [hasActiveTeamWorkspace, baseImagesToExport, directories, teamWorkspacesById, teamAssetStatesByWorkspace],
  );
  const imagesToExport = approvedOnly && hasActiveTeamWorkspace ? approvedImagesInSource : baseImagesToExport;
  const exportCount = imagesToExport.length;
  const unsupportedRewriteCount = useMemo(() => (
    imagesToExport.filter((image) => {
      const ext = image.name.includes('.') ? image.name.slice(image.name.lastIndexOf('.')).toLowerCase() : '';
      return !METADATA_REWRITE_SUPPORTED_EXTENSIONS.has(ext);
    }).length
  ), [imagesToExport]);
  const progressPercent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
    : 0;

  useEffect(() => {
    if (!isOpen || !window.electronAPI?.onExportBatchProgress) {
      return;
    }

    const unsubscribe = window.electronAPI.onExportBatchProgress((payload) => {
      const currentExportId = activeExportIdRef.current;
      if (!currentExportId) {
        return;
      }
      if (payload.exportId && payload.exportId !== currentExportId) {
        return;
      }
      setProgress(payload);
    });

    return unsubscribe;
  }, [isOpen]);

  const handleOpenFolder = () => {
    if (exportPath && window.electronAPI) {
      window.electronAPI.showItemInFolder(exportPath);
    }
  };

  const handleRequestClose = async () => {
    if (!isExporting) {
      onClose();
      return;
    }

    const exportId = activeExportIdRef.current;
    if (!exportId || !window.electronAPI?.cancelBatchExport || isCancelling) {
      return;
    }

    setIsCancelling(true);
    setStatus({ type: 'error', key: 'batchExport.canceling' });

    try {
      await window.electronAPI.cancelBatchExport({ exportId });
    } catch (error: any) {
      setStatus({ type: 'error', ...(error?.message ? { message: error?.message } : { key: 'batchExport.cancelFailed' }) });
      setIsCancelling(false);
    }
  };

  const handleExport = async () => {
    if (!window.electronAPI) {
      setStatus({ type: 'error', key: 'batchExport.desktopOnly' });
      return;
    }

    if (imagesToExport.length === 0) {
      setStatus({ type: 'error', key: 'batchExport.empty' });
      return;
    }

    if (restrictToRequestedSelection && source !== 'selected') {
      setStatus({ type: 'error', key: 'batchExport.requestedOnly' });
      return;
    }

    const unsupportedModelError = getUnsupportedModel3DBatchExportError(imagesToExport);
    if (unsupportedModelError) {
      setStatus({ type: 'error', key: 'batchExport.modelUnsupported' });
      return;
    }

    const directoryMap = new Map(directories.map(dir => [dir.id, dir.path]));
    const files = (await Promise.all(imagesToExport.map(async (image) => {
        const dirPath = directoryMap.get(image.directoryId || '');
        if (!dirPath) {
          return null;
        }

        const shadowMetadata = applyShadowEdits ? await getPersistedShadowMetadata(image) : null;
        const effectiveMetadata = metadataPolicy === 'metahub_standard'
          ? buildEffectiveMetadata(image.metadata?.normalizedMetadata, shadowMetadata)
          : null;

        return {
          imageId: image.id,
          directoryPath: dirPath,
          relativePath: getRelativeImagePath(image),
          effectiveMetadata,
        };
      })))
      .filter(Boolean) as ExportFileDescriptor[];

    if (files.length === 0) {
      setStatus({ type: 'error', key: 'batchExport.missingFolders' });
      return;
    }

    setIsExporting(true);
    setIsCancelling(false);
    setStatus(null);
    setExportPath(null);

    try {
      if (output === 'folder') {
        const destResult = await window.electronAPI.showDirectoryDialog();
        if (destResult.canceled || !destResult.path) {
          setIsExporting(false);
          return;
        }

        const exportId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setActiveExportId(exportId);
        setProgress({
          exportId,
          mode: 'folder',
          total: files.length,
          processed: 0,
          exportedCount: 0,
          failedCount: 0,
          stage: 'copying',
        });

        const exportResult = await window.electronAPI.exportBatchToFolder({
          files,
          destDir: destResult.path,
          exportId,
          metadataPolicy,
          applyShadowEdits,
          scope: getScopeFromSelection(source, files.length),
          targetFormat: metadataPolicy === 'metahub_standard' ? 'png' : 'original',
        });

        if (!exportResult.success) {
          setStatus({ type: 'error', ...(exportResult.error ? { message: exportResult.error } : { key: 'batchExport.failed' }) });
        } else {
          if (hasActiveTeamWorkspace && approvedOnly && includeAuditReport && window.electronAPI?.team?.writeAuditReports) {
            const firstWorkspace = Object.values(teamWorkspacesById)[0];
            const entries = buildProvenanceAuditEntries(
              imagesToExport,
              directories,
              teamWorkspacesById,
              teamAssetStatesByWorkspace,
            );
            const meta = {
              workspaceName: firstWorkspace?.manifest.name || 'Team Workspace',
              workspaceId: firstWorkspace?.manifest.workspaceId ?? null,
              generatedAt: new Date().toISOString(),
              metadataStrippedFromDeliverables: metadataPolicy === 'strip',
            };
            await window.electronAPI.team.writeAuditReports({
              destDir: destResult.path,
              csvContent: serializeAuditReportCsv(entries),
              jsonContent: serializeAuditReportJson(entries, meta),
              htmlContent: serializeAuditReportHtml(entries, meta),
            });
          }
          const failures = exportResult.failedCount || 0;
          setStatus({
            type: failures > 0 ? 'error' : 'success',
            key: failures > 0 ? 'batchExport.completedWithFailures' : 'batchExport.completed',
            values: { count: exportResult.exportedCount, failed: failures },
          });
          setExportPath(destResult.path);
        }
      } else {
        const saveResult = await window.electronAPI.showSaveDialog({
          title: t('batchExport.saveZip'),
          defaultPath: 'ImageMetaHub-Export.zip',
          filters: [{ name: t('batchExport.zipArchive'), extensions: ['zip'] }],
        });
        if (saveResult.canceled || !saveResult.path) {
          setIsExporting(false);
          return;
        }

        const exportId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setActiveExportId(exportId);
        setProgress({
          exportId,
          mode: 'zip',
          total: files.length,
          processed: 0,
          exportedCount: 0,
          failedCount: 0,
          stage: 'copying',
        });

        const exportResult = await window.electronAPI.exportBatchToZip({
          files,
          destZipPath: saveResult.path,
          exportId,
          metadataPolicy,
          applyShadowEdits,
          scope: getScopeFromSelection(source, files.length),
          targetFormat: metadataPolicy === 'metahub_standard' ? 'png' : 'original',
        });

        if (!exportResult.success) {
          setStatus({ type: 'error', ...(exportResult.error ? { message: exportResult.error } : { key: 'batchExport.zipFailed' }) });
        } else {
          const failures = exportResult.failedCount || 0;
          setStatus({
            type: failures > 0 ? 'error' : 'success',
            key: failures > 0 ? 'batchExport.zipCompletedWithFailures' : 'batchExport.zipCompleted',
            values: { count: exportResult.exportedCount, failed: failures },
          });
          setExportPath(saveResult.path);
        }
      }
    } catch (error: any) {
      setStatus({ type: 'error', ...(error?.message ? { message: error?.message } : { key: 'batchExport.failed' }) });
    } finally {
      setIsExporting(false);
      setActiveExportId(null);
      setIsCancelling(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 border border-gray-700">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Download className="w-5 h-5 text-blue-300" />
            </div>
            <h2 className="text-lg font-semibold text-white">{t('batchExport.title')}</h2>
          </div>
          <button
            onClick={() => { void handleRequestClose(); }}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            title={isExporting ? t('batchExport.cancelExport') : t('comparison.close')}
            aria-label={isExporting ? t('batchExport.cancelExport') : t('comparison.close')}
            disabled={isCancelling}
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="space-y-2">
            <p className="text-sm text-gray-400">{t('batchExport.source')}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSource('selected')}
                disabled={!hasSelected}
                className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                  source === 'selected'
                    ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                } ${!hasSelected ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {t('batchExport.selected', { count: selectedImages.length })}
              </button>
              <button
                type="button"
                onClick={() => setSource('filtered')}
                disabled={restrictToRequestedSelection}
                className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                  source === 'filtered'
                    ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                } ${restrictToRequestedSelection ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {t('batchExport.filtered', { count: filteredImages.length })}
              </button>
            </div>
            {restrictToRequestedSelection && (
              <p className="text-xs text-amber-300/90">
                {t('batchExport.selectionNotice')}
              </p>
            )}
            {hasActiveTeamWorkspace && (
              <div className="space-y-2 rounded-lg border border-emerald-700/60 bg-emerald-950/30 px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-emerald-100 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={approvedOnly}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setApprovedOnly(next);
                        if (next) {
                          setMetadataPolicy('strip');
                        }
                      }}
                      className="rounded border-emerald-600 bg-gray-900 text-emerald-500 focus:ring-emerald-500"
                    />
                    <span>Client Delivery Pack — Approved only ({approvedImagesInSource.length})</span>
                  </label>
                  {approvedOnly && (
                    <span className="text-[11px] text-emerald-300">Metadata stripped</span>
                  )}
                </div>
                {approvedOnly && output === 'folder' && (
                  <label className="flex items-center gap-2 pl-5 text-[11px] text-emerald-200/90 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeAuditReport}
                      onChange={(e) => setIncludeAuditReport(e.target.checked)}
                      className="rounded border-emerald-600 bg-gray-900 text-emerald-500 focus:ring-emerald-500"
                    />
                    <span>Include Provenance &amp; Approval Audit Report (CSV + JSON + HTML)</span>
                  </label>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm text-gray-400">{t('batchExport.output')}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOutput('folder')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                  output === 'folder'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-100'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                {t('batchExport.folder')}
              </button>
              <button
                type="button"
                onClick={() => setOutput('zip')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                  output === 'zip'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-100'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                ZIP
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-gray-400">{t('batchExport.metadata')}</p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setMetadataPolicy('preserve')}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  metadataPolicy === 'preserve'
                    ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                {t('batchExport.preserve')}
              </button>
              <button
                type="button"
                onClick={() => setMetadataPolicy('strip')}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  metadataPolicy === 'strip'
                    ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                {t('batchExport.strip')}
              </button>
              <button
                type="button"
                onClick={() => setMetadataPolicy('metahub_standard')}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  metadataPolicy === 'metahub_standard'
                    ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                {t('batchExport.standard')}
              </button>
            </div>

            {metadataPolicy === 'metahub_standard' && (
              <label className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={applyShadowEdits}
                  onChange={(event) => setApplyShadowEdits(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
                />
                {t('batchExport.applyEdits')}
              </label>
            )}
          </div>

          <div className="bg-gray-800/70 border border-gray-700 rounded-lg p-3 text-sm text-gray-300">
            {isExporting && progress ? (
              <span>
                {progress.stage === 'canceled'
                  ? t('batchExport.canceling')
                  : progress.stage === 'finalizing'
                  ? t('batchExport.finalizing')
                  : t('batchExport.progress', { processed: progress.processed, total: progress.total })}
              </span>
            ) : (
              <span>
                {t('batchExport.planned', { count: exportCount })}
              </span>
            )}
            {output === 'folder' && (
              <span className="block text-xs text-gray-400 mt-1">{t('batchExport.folderNotice')}</span>
            )}
            {output === 'zip' && (
              <span className="block text-xs text-gray-400 mt-1">{t('batchExport.zipNotice')}</span>
            )}
            {metadataPolicy !== 'preserve' && (
              <span className="block text-xs text-amber-300/90 mt-1">
                {t('batchExport.formatNotice')}
              </span>
            )}
            {metadataPolicy !== 'preserve' && unsupportedRewriteCount > 0 && (
              <span className="block text-xs text-amber-300/90 mt-1">
                {t('batchExport.unsupported', { count: unsupportedRewriteCount })}
              </span>
            )}
            {isExporting && progress && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>{progressPercent}%</span>
                  <span>{t('batchExport.resultCounts', { ok: progress.exportedCount, failed: progress.failedCount })}</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-700">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {status && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm flex items-center justify-between ${
                status.type === 'success'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-red-500/40 bg-red-500/10 text-red-200'
              }`}
            >
              <span>{'key' in status ? t(status.key, status.values) : status.message}</span>
              {status.type === 'success' && exportPath && (
                <button
                  onClick={handleOpenFolder}
                  className="ml-4 text-emerald-400 hover:text-emerald-300 underline font-medium whitespace-nowrap"
                >
                  {t('batchExport.goToFolder')}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-700">
          <button
            onClick={() => { void handleRequestClose(); }}
            className="px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-60"
            disabled={isCancelling}
          >
            {isExporting ? (isCancelling ? t('batchExport.cancelShort') : t('batchExport.cancelExport')) : t('batchExport.cancel')}
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || exportCount === 0}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-accent-strong text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            {isExporting ? t('batchExport.exporting') : t('batchExport.export')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BatchExportModal;

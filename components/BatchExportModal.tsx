import { useTranslation, type MessageKey } from '../i18n/useTranslation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FolderOpen, X } from 'lucide-react';
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
import Toast from './Toast';
import { createPortal } from 'react-dom';

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
  const [destination, setDestination] = useState('');
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [pickedFilePath, setPickedFilePath] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ count: number; path: string } | null>(null);
  const dismissNotification = useCallback(() => setNotification(null), []);
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
      setDestination('');
      setPickedFilePath(null);
      setNotification(null);
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
  const destinationKind = output === 'zip' ? 'zip' : exportCount === 1 ? 'file' : 'folder';
  const singleImage = imagesToExport[0];
  const originalExtension = singleImage?.name.match(/\.([^.]+)$/)?.[1] ?? '';
  // AVIF metadata is rewritten in place; other standard exports become PNG.
  const exportExtension = metadataPolicy === 'metahub_standard' && originalExtension.toLowerCase() !== 'avif'
    ? 'png' : originalExtension;
  const defaultFileName = output === 'zip' ? 'ImageMetaHub-Export.zip'
    : metadataPolicy === 'metahub_standard' && originalExtension.toLowerCase() !== 'avif'
      ? `${singleImage?.name.replace(/\.[^.]+$/, '') ?? 'ImageMetaHub-Export'}.png`
      : singleImage?.name ?? '';

  useEffect(() => {
    setDestination('');
    setStatus(null);
  }, [destinationKind, defaultFileName]);

  const browseDestination = async (): Promise<string | null> => {
    const api = window.electronAPI;
    if (!api) return null;
    setIsBrowsing(true);
    try {
      const result = destinationKind === 'folder'
        ? await api.showDirectoryDialog()
        : await api.showSaveDialog({
          title: t(output === 'zip' ? 'batchExport.saveZip' : 'batchExport.saveFile'),
          defaultPath: destination.trim() || defaultFileName,
          filters: [{ name: output === 'zip' ? t('batchExport.zipArchive') : exportExtension.toUpperCase(),
            extensions: output === 'zip' ? ['zip'] : [exportExtension || '*'] }],
        });
      if (result.canceled) return null;
      if (!result.path) throw new Error(result.error || t('batchExport.failed'));
      setDestination(result.path);
      setPickedFilePath(destinationKind === 'folder' ? null : result.path);
      return result.path;
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof Error ? error.message : t('batchExport.failed') });
      return null;
    } finally {
      setIsBrowsing(false);
    }
  };

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
    } catch (error) {
      setStatus({ type: 'error', ...(error instanceof Error ? { message: error.message } : { key: 'batchExport.cancelFailed' }) });
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

    setIsExporting(true);
    setIsCancelling(false);
    setStatus(null);
    setExportPath(null);

    try {
      const typedPath = destination.trim();
      const targetPath = typedPath || await browseDestination();
      const overwriteConfirmed = !typedPath || targetPath === pickedFilePath;
      if (!targetPath) return;
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

      if (files.length !== imagesToExport.length) {
        setStatus({ type: 'error', key: 'batchExport.missingFolders' });
        return;
      }

      if (output === 'folder') {
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
          ...(destinationKind === 'file' ? { destFilePath: targetPath } : { destDir: targetPath }),
          exportId,
          metadataPolicy,
          overwriteConfirmed,
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
          setExportPath(targetPath);
          if (failures === 0) {
            setNotification({ count: exportResult.exportedCount, path: targetPath });
            onClose();
          }
        }
      } else {
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
          destZipPath: targetPath,
          exportId,
          metadataPolicy,
          overwriteConfirmed,
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
          setExportPath(targetPath);
          if (failures === 0) {
            setNotification({ count: exportResult.exportedCount, path: targetPath });
            onClose();
          }
        }
      }
    } catch (error) {
      setStatus({ type: 'error', ...(error instanceof Error ? { message: error.message } : { key: 'batchExport.failed' }) });
    } finally {
      setIsExporting(false);
      setActiveExportId(null);
      setIsCancelling(false);
    }
  };

  const successToast = notification ? createPortal(
    <Toast
      message={t('batchExport.completed', { count: notification.count })}
      duration={7000}
      prominent
      onDismiss={dismissNotification}
      action={{ label: t('batchExport.goToFolder'), onClick: () => window.electronAPI?.showItemInFolder(notification.path) }}
    />, document.body
  ) : null;

  if (!isOpen) return successToast;

  return (
    <>
    {successToast}
    <div role="dialog" aria-modal="true" aria-label={t('batchExport.title')} className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="ui-dialog flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent/10 rounded-lg">
              <Download className="w-5 h-5 text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-gray-100">{t('batchExport.title')}</h2>
          </div>
          <button
            onClick={() => { void handleRequestClose(); }}
            className="ui-icon-btn"
            title={isExporting ? t('batchExport.cancelExport') : t('comparison.close')}
            aria-label={isExporting ? t('batchExport.cancelExport') : t('comparison.close')}
            disabled={isCancelling}
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <fieldset disabled={isExporting || isBrowsing} className="min-h-0 overflow-y-auto p-5 space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-gray-400">{t('batchExport.source')}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSource('selected')}
                aria-pressed={source === 'selected'}
                disabled={!hasSelected}
                className={`ui-btn flex-1 ${
                  source === 'selected'
                    ? 'border-accent/50 bg-accent/15 text-accent'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                } ${!hasSelected ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {t('batchExport.selected', { count: selectedImages.length })}
              </button>
              <button
                type="button"
                onClick={() => setSource('filtered')}
                aria-pressed={source === 'filtered'}
                disabled={restrictToRequestedSelection}
                className={`ui-btn flex-1 ${
                  source === 'filtered'
                    ? 'border-accent/50 bg-accent/15 text-accent'
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
                aria-pressed={output === 'folder'}
                className={`ui-btn flex-1 ${
                  output === 'folder'
                    ? 'border-accent/50 bg-accent/15 text-accent'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                {t(exportCount === 1 ? 'batchExport.file' : 'batchExport.folder')}
              </button>
              <button
                type="button"
                onClick={() => setOutput('zip')}
                aria-pressed={output === 'zip'}
                className={`ui-btn flex-1 ${
                  output === 'zip'
                    ? 'border-accent/50 bg-accent/15 text-accent'
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
                aria-pressed={metadataPolicy === 'preserve'}
                className={`ui-btn w-full justify-start ${
                  metadataPolicy === 'preserve'
                    ? 'border-accent/50 bg-accent/15 text-accent'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                {t('batchExport.preserve')}
              </button>
              <button
                type="button"
                onClick={() => setMetadataPolicy('strip')}
                aria-pressed={metadataPolicy === 'strip'}
                className={`ui-btn w-full justify-start ${
                  metadataPolicy === 'strip'
                    ? 'border-accent/50 bg-accent/15 text-accent'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                {t('batchExport.strip')}
              </button>
              <button
                type="button"
                onClick={() => setMetadataPolicy('metahub_standard')}
                aria-pressed={metadataPolicy === 'metahub_standard'}
                className={`ui-btn w-full justify-start ${
                  metadataPolicy === 'metahub_standard'
                    ? 'border-accent/50 bg-accent/15 text-accent'
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
                  className="ui-checkbox w-4"
                />
                {t('batchExport.applyEdits')}
              </label>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="export-destination" className="text-sm text-gray-400">
              {t(destinationKind === 'folder' ? 'batchExport.folderPath' : 'batchExport.filePath')}
            </label>
            <div className="flex gap-2">
              <input id="export-destination" className="ui-input flex-1" value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder={destinationKind === 'folder' ? t('batchExport.chooseFolder') : defaultFileName} />
              <button type="button" className="ui-icon-btn" onClick={() => void browseDestination()}
                title={t('fileOperations.destination')} aria-label={t('fileOperations.destination')}>
                <FolderOpen size={14} />
              </button>
            </div>
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
            {destinationKind === 'folder' && (
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
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {status && !notification && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm flex items-center justify-between ${
                status.type === 'success'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-red-500/40 bg-red-500/10 text-red-200'
              }`}
            >
              <span>{'key' in status ? t(status.key, status.values) : status.message}</span>
              {exportPath && (
                <button
                  onClick={handleOpenFolder}
                  className="ml-4 text-emerald-400 hover:text-emerald-300 underline font-medium whitespace-nowrap"
                >
                  {t('batchExport.goToFolder')}
                </button>
              )}
            </div>
          )}
        </fieldset>

        <div className="flex shrink-0 items-center justify-end gap-3 p-4 border-t border-gray-700">
          <button
            onClick={() => { void handleRequestClose(); }}
            className="ui-btn"
            disabled={isCancelling}
          >
            {isExporting ? (isCancelling ? t('batchExport.cancelShort') : t('batchExport.cancelExport')) : t('batchExport.cancel')}
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || isBrowsing || exportCount === 0}
            className="ui-btn-primary"
          >
            <Download className="w-4 h-4" />
            {isExporting ? t('batchExport.exporting') : t('batchExport.export')}
          </button>
        </div>
      </div>
    </div>
    </>
  );
};

export default BatchExportModal;

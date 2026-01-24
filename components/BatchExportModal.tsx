import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { type ExportBatchProgress, type IndexedImage } from '../types';

interface BatchExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedImageIds: Set<string>;
  filteredImages: IndexedImage[];
  directories: { id: string; path: string }[];
}

type BatchSource = 'selected' | 'filtered';
type BatchOutput = 'folder' | 'zip';

const BatchExportModal: React.FC<BatchExportModalProps> = ({
  isOpen,
  onClose,
  selectedImageIds,
  filteredImages,
  directories,
}) => {
  const selectedImages = useMemo(
    () => filteredImages.filter(image => selectedImageIds.has(image.id)),
    [filteredImages, selectedImageIds]
  );
  const hasSelected = selectedImages.length > 0;

  const [source, setSource] = useState<BatchSource>(hasSelected ? 'selected' : 'filtered');
  const [output, setOutput] = useState<BatchOutput>('folder');
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [progress, setProgress] = useState<ExportBatchProgress | null>(null);
  const [activeExportId, setActiveExportId] = useState<string | null>(null);
  const activeExportIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasSelected && source === 'selected') {
      setSource('filtered');
    }
  }, [hasSelected, source]);

  useEffect(() => {
    if (isOpen) {
      setStatus(null);
      setIsExporting(false);
      setSource(hasSelected ? 'selected' : 'filtered');
      setOutput('folder');
      setProgress(null);
      setActiveExportId(null);
    }
  }, [isOpen, hasSelected]);

  useEffect(() => {
    activeExportIdRef.current = activeExportId;
  }, [activeExportId]);

  const exportCount = source === 'selected' ? selectedImages.length : filteredImages.length;
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

  const handleExport = async () => {
    if (!window.electronAPI) {
      setStatus({ type: 'error', message: 'Export is only available in the desktop app.' });
      return;
    }

    const imagesToExport = source === 'selected' ? selectedImages : filteredImages;
    if (imagesToExport.length === 0) {
      setStatus({ type: 'error', message: 'No images available for export.' });
      return;
    }

    const directoryMap = new Map(directories.map(dir => [dir.id, dir.path]));
    const files = imagesToExport
      .map(image => {
        const dirPath = directoryMap.get(image.directoryId || '');
        if (!dirPath) {
          return null;
        }
        return {
          directoryPath: dirPath,
          relativePath: image.name,
        };
      })
      .filter(Boolean) as Array<{ directoryPath: string; relativePath: string }>;

    if (files.length === 0) {
      setStatus({ type: 'error', message: 'Selected images are missing their source folders.' });
      return;
    }

    setIsExporting(true);
    setStatus(null);

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
        });

        if (!exportResult.success) {
          setStatus({ type: 'error', message: exportResult.error || 'Batch export failed.' });
        } else {
          const failures = exportResult.failedCount || 0;
          const summary = failures > 0
            ? `Exported ${exportResult.exportedCount} images with ${failures} failures.`
            : `Exported ${exportResult.exportedCount} images.`;
          setStatus({ type: failures > 0 ? 'error' : 'success', message: summary });
        }
      } else {
        const saveResult = await window.electronAPI.showSaveDialog({
          title: 'Save batch export as ZIP',
          defaultPath: 'ImageMetaHub-Export.zip',
          filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
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
        });

        if (!exportResult.success) {
          setStatus({ type: 'error', message: exportResult.error || 'ZIP export failed.' });
        } else {
          const failures = exportResult.failedCount || 0;
          const summary = failures > 0
            ? `Created ZIP with ${exportResult.exportedCount} images and ${failures} failures.`
            : `Created ZIP with ${exportResult.exportedCount} images.`;
          setStatus({ type: failures > 0 ? 'error' : 'success', message: summary });
        }
      }
    } catch (error: any) {
      setStatus({ type: 'error', message: error?.message || 'Batch export failed.' });
    } finally {
      setIsExporting(false);
      setActiveExportId(null);
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
            <h2 className="text-lg font-semibold text-white">Batch Export</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            title="Close"
            disabled={isExporting}
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="space-y-2">
            <p className="text-sm text-gray-400">Source</p>
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
                Selected ({selectedImages.length})
              </button>
              <button
                type="button"
                onClick={() => setSource('filtered')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
                  source === 'filtered'
                    ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                Filtered ({filteredImages.length})
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-gray-400">Output</p>
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
                Folder
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

          <div className="bg-gray-800/70 border border-gray-700 rounded-lg p-3 text-sm text-gray-300">
            {isExporting && progress ? (
              <span>
                {progress.stage === 'finalizing'
                  ? 'Finalizing ZIP...'
                  : `Exporting ${progress.processed} of ${progress.total} images.`}
              </span>
            ) : (
              <span>
                Exporting <span className="font-semibold text-white">{exportCount}</span> images.
              </span>
            )}
            {output === 'folder' && (
              <span className="block text-xs text-gray-400 mt-1">All files will be flattened and renamed automatically if needed.</span>
            )}
            {output === 'zip' && (
              <span className="block text-xs text-gray-400 mt-1">ZIP will contain flattened files with auto-renamed collisions.</span>
            )}
            {isExporting && progress && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>{progressPercent}%</span>
                  <span>{progress.exportedCount} ok / {progress.failedCount} failed</span>
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
              className={`rounded-lg border px-3 py-2 text-sm ${
                status.type === 'success'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-red-500/40 bg-red-500/10 text-red-200'
              }`}
            >
              {status.message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            disabled={isExporting}
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || exportCount === 0}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BatchExportModal;

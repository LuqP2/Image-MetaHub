import React from 'react';
import { CheckCircle2, Download, ExternalLink, RefreshCw, RotateCcw, X } from 'lucide-react';
import { type UpdateDownloadProgress, type UpdateNotificationPayload } from '../types';

export type UpdateNotificationStatus = 'available' | 'downloading' | 'downloaded' | 'error';

interface UpdateNotificationModalProps {
  isOpen: boolean;
  status: UpdateNotificationStatus;
  update: UpdateNotificationPayload | null;
  progress: UpdateDownloadProgress | null;
  error?: string | null;
  onClose: () => void;
  onDownload: () => void;
  onSkip: () => void;
  onInstallNow: () => void;
}

const formatBytes = (value?: number): string | null => {
  if (!value || value <= 0) return null;

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const getReleaseNotesText = (update: UpdateNotificationPayload | null): string => {
  if (!update?.releaseNotes) {
    return update?.releaseName ? `Release: ${update.releaseName}` : 'No release notes were included with this update.';
  }

  if (typeof update.releaseNotes === 'string') {
    return update.releaseNotes;
  }

  return update.releaseNotes
    .map((note) => note.note)
    .filter(Boolean)
    .join('\n');
};

const renderReleaseNotes = (text: string) => {
  const lines = text
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 18);

  if (lines.length === 0) {
    return <p className="text-sm text-gray-400">No release notes were included with this update.</p>;
  }

  return (
    <div className="space-y-2">
      {lines.map((line, index) => {
        if (/^#{1,6}\s+/.test(line)) {
          return (
            <h3 key={`${line}-${index}`} className="pt-2 text-sm font-semibold text-gray-200">
              {line.replace(/^#{1,6}\s+/, '')}
            </h3>
          );
        }

        const bulletText = line.replace(/^[-*]\s+/, '').replace(/\*\*/g, '');
        const isBullet = /^[-*]\s+/.test(line);

        if (isBullet) {
          return (
            <div key={`${line}-${index}`} className="flex gap-2 text-sm leading-6 text-gray-300">
              <span className="mt-[9px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-500" />
              <span>{bulletText}</span>
            </div>
          );
        }

        return (
          <p key={`${line}-${index}`} className="text-sm leading-6 text-gray-300">
            {bulletText}
          </p>
        );
      })}
    </div>
  );
};

const UpdateNotificationModal: React.FC<UpdateNotificationModalProps> = ({
  isOpen,
  status,
  update,
  progress,
  error,
  onClose,
  onDownload,
  onSkip,
  onInstallNow,
}) => {
  if (!isOpen || !update) return null;

  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0));
  const transferred = formatBytes(progress?.transferred);
  const total = formatBytes(progress?.total);
  const releaseNotes = getReleaseNotesText(update);
  const changelogUrl = update.changelogUrl ?? `https://github.com/LuqP2/Image-MetaHub/releases/tag/v${update.version}`;

  const title = status === 'downloaded' ? 'Update ready to install' : 'Update available';
  const subtitle =
    status === 'downloaded'
      ? `Image MetaHub ${update.version} has been downloaded.`
      : `Image MetaHub ${update.version} is ready to download.`;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-700 p-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-lg bg-blue-500/15 p-2 text-blue-300">
              {status === 'downloaded' ? <CheckCircle2 size={22} /> : <Download size={22} />}
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-gray-100">{title}</h2>
              <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-100"
            title="Close"
            aria-label="Close update notification"
            disabled={status === 'downloading'}
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {status === 'downloading' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-sm text-gray-300">
                <RefreshCw size={18} className="animate-spin text-blue-300" />
                Downloading update...
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${percent}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{percent.toFixed(0)}%</span>
                {transferred && total ? <span>{transferred} of {total}</span> : null}
              </div>
            </div>
          ) : status === 'error' ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200 light:text-red-800">
              {error || 'The update could not be downloaded. Please try again later.'}
            </div>
          ) : (
            <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-4">
              {renderReleaseNotes(releaseNotes)}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-gray-700 bg-gray-950/50 p-6 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => window.electronAPI?.openExternalUrl(changelogUrl)}
            className="inline-flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-blue-300"
          >
            <ExternalLink size={16} />
            View release notes
          </button>

          {status === 'downloaded' ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-800"
              >
                Install Later
              </button>
              <button
                type="button"
                onClick={onInstallNow}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
              >
                <RotateCcw size={16} />
                Restart and Install
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onSkip}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
                disabled={status === 'downloading'}
              >
                Skip Version
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
                disabled={status === 'downloading'}
              >
                Later
              </button>
              <button
                type="button"
                onClick={onDownload}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={status === 'downloading'}
              >
                <Download size={16} />
                Download
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpdateNotificationModal;

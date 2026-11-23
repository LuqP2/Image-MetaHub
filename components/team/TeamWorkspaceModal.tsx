import React, { useEffect, useState } from 'react';
import { RefreshCw, Users, FolderCheck, X, FileDown, FileUp } from 'lucide-react';
import { useTeamWorkspaceStore } from '../../store/useTeamWorkspaceStore';
import { useImageStore } from '../../store/useImageStore';
import { resolveImageTeamContext } from '../../services/team/reviewService';
import {
  buildClientReviewSheetHtml,
  buildOpsFromClientFeedback,
  parseClientFeedbackFile,
} from '../../services/team/clientReviewSheetService';
import { TeamSharedResourcesTabs } from './TeamSharedResourcesTabs';

interface TeamWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  directoryPath: string;
  directoryName: string;
}

const PROFILE_SWATCHES = [
  '#3B82F6', '#10B981', '#F59E0B', '#EC4899',
  '#8B5CF6', '#06B6D4', '#EF4444', '#84CC16',
];

export const TeamWorkspaceModal: React.FC<TeamWorkspaceModalProps> = ({
  isOpen,
  onClose,
  directoryPath,
  directoryName,
}) => {
  const {
    initialized,
    localProfile,
    syncingWorkspaceIds,
    error,
    initialize,
    detectWorkspace,
    initWorkspace,
    openWorkspace,
    updateProfile,
    syncNow,
    getWorkspaceForRootPath,
  } = useTeamWorkspaceStore();

  const [detectedName, setDetectedName] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState(directoryName);
  const [displayName, setDisplayName] = useState('');
  const [color, setColor] = useState(PROFILE_SWATCHES[0]);
  const [busy, setBusy] = useState(false);
  const [clientNotice, setClientNotice] = useState<string | null>(null);

  const workspacesById = useTeamWorkspaceStore((state) => state.workspacesById);
  const assetStatesByWorkspace = useTeamWorkspaceStore((state) => state.assetStatesByWorkspace);
  const queueOp = useTeamWorkspaceStore((state) => state.queueOp);
  const refreshWorkspaceOps = useTeamWorkspaceStore((state) => state.refreshWorkspaceOps);
  const filteredImages = useImageStore((state) => state.filteredImages);
  const directories = useImageStore((state) => state.directories);

  const activeWorkspace = getWorkspaceForRootPath(directoryPath);

  useEffect(() => {
    if (!isOpen) return;
    if (!initialized) {
      void initialize();
    }
    setWorkspaceName(directoryName);
    void detectWorkspace(directoryPath).then((found) => {
      setDetectedName(found?.manifest.name ?? null);
    });
  }, [isOpen, initialized, directoryPath, directoryName, initialize, detectWorkspace]);

  useEffect(() => {
    if (localProfile) {
      setDisplayName(localProfile.displayName);
      setColor(localProfile.color);
    }
  }, [localProfile]);

  if (!isOpen) return null;

  const isSyncing = activeWorkspace ? Boolean(syncingWorkspaceIds[activeWorkspace.manifest.workspaceId]) : false;

  const handleSaveProfile = async () => {
    setBusy(true);
    try {
      await updateProfile({ displayName, color });
    } finally {
      setBusy(false);
    }
  };

  const handleExportClientReviewSheet = async () => {
    if (!activeWorkspace || !window.electronAPI?.team?.saveTextFile) return;
    setBusy(true);
    setClientNotice(null);
    try {
      const wsId = activeWorkspace.manifest.workspaceId;
      const wsRoot = activeWorkspace.rootPath.replace(/[\\/]+$/, '');
      const candidates = filteredImages
        .map((img) => ({
          img,
          ctx: resolveImageTeamContext(img, directories, workspacesById, assetStatesByWorkspace),
        }))
        .filter((entry): entry is { img: typeof filteredImages[number]; ctx: NonNullable<ReturnType<typeof resolveImageTeamContext>> } => (
          Boolean(entry.ctx && entry.ctx.workspaceId === wsId)
        ))
        .slice(0, 120);

      if (candidates.length === 0) {
        setClientNotice('No images in the current view belong to this Team Workspace.');
        return;
      }

      const items = [];
      for (const { img, ctx } of candidates) {
        const fullPath = `${wsRoot}/${ctx.relativePath}`;
        const thumbRes = await window.electronAPI.team.buildThumbnailDataUrl({
          filePath: fullPath,
          maxEdge: 768,
          quality: 80,
        });
        items.push({
          assetKey: ctx.assetKey,
          relativePath: ctx.relativePath,
          fileName: img.name.replace(/\\/g, '/').split('/').pop() || img.name,
          currentStatus: ctx.assetState?.reviewStatus ?? 'none',
          baseOpId: ctx.assetState?.reviewDecision?.opId ?? null,
          contentHash: ctx.contentHash,
          thumbnailDataUrl: thumbRes.success && thumbRes.data ? thumbRes.data : '',
        });
      }

      const html = buildClientReviewSheetHtml({
        workspaceId: wsId,
        workspaceName: activeWorkspace.manifest.name,
        exportedAt: new Date().toISOString(),
        items,
      });

      const safeName = activeWorkspace.manifest.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const saveRes = await window.electronAPI.team.saveTextFile({
        title: 'Export Offline Client Review Sheet (.html)',
        defaultPath: `ReviewSheet-${safeName}.html`,
        filters: [{ name: 'HTML Review Sheet', extensions: ['html'] }],
        content: html,
      });
      if (saveRes.success && saveRes.data?.saved) {
        setClientNotice(`Exported ${items.length} assets to offline Review Sheet.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleImportClientFeedback = async () => {
    if (!activeWorkspace || !window.electronAPI?.team?.pickAndReadFeedback) return;
    setBusy(true);
    setClientNotice(null);
    try {
      const wsId = activeWorkspace.manifest.workspaceId;
      const picked = await window.electronAPI.team.pickAndReadFeedback();
      if (!picked.success || !picked.data) return;
      const parsed = parseClientFeedbackFile(picked.data.content, wsId);
      const ops = buildOpsFromClientFeedback(parsed);
      for (const op of ops) {
        await queueOp(wsId, op, false);
      }
      await window.electronAPI.team.flushOps(wsId);
      await refreshWorkspaceOps(wsId);
      const decisionCount = ops.filter((o) => o.type === 'set_review_status').length;
      const commentCount = ops.filter((o) => o.type === 'add_comment').length;
      setClientNotice(`Imported ${decisionCount} decisions and ${commentCount} notes from ${parsed.reviewerName}.`);
    } catch (err) {
      setClientNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleEnableOrConnect = async () => {
    setBusy(true);
    try {
      await updateProfile({ displayName, color });
      if (detectedName) {
        await openWorkspace(directoryPath);
      } else {
        await initWorkspace(directoryPath, workspaceName);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className={`w-full ${activeWorkspace ? 'max-w-xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 text-gray-100 shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-400" />
            <h2 className="text-base font-semibold">Team Workspace</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2 text-xs text-gray-400">
            <div className="truncate font-mono text-gray-300" title={directoryPath}>{directoryPath}</div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-300">Display name (local attribution)</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={64}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
            <div className="flex items-center gap-2 pt-1">
              {PROFILE_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => setColor(swatch)}
                  className={`h-5 w-5 rounded-full border-2 ${color === swatch ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: swatch }}
                  aria-label={`Select color ${swatch}`}
                />
              ))}
            </div>
          </div>

          {!activeWorkspace ? (
            <div className="space-y-3 border-t border-gray-800 pt-3">
              {detectedName ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-800/60 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
                  <FolderCheck className="h-4 w-4 shrink-0" />
                  <span>Workspace detected: <strong>{detectedName}</strong></span>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-300">Workspace name</label>
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                  <p className="text-xs text-gray-400">
                    Creates a <code className="text-gray-300">.imh-team/</code> folder with immutable event batches. Files never pass through Image MetaHub servers.
                  </p>
                </div>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={handleEnableOrConnect}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {detectedName ? 'Connect to Team Workspace' : 'Enable Team Workspace'}
              </button>
            </div>
          ) : (
            <div className="space-y-3 border-t border-gray-800 pt-3">
              <div className="flex items-center justify-between text-xs text-gray-300">
                <span>
                  Synced ops: <strong>{activeWorkspace.syncStatus.appliedOpCount}</strong> ({activeWorkspace.syncStatus.appliedFileCount} files)
                </span>
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={() => void syncNow(activeWorkspace.manifest.workspaceId)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Syncing…' : 'Sync now'}
                </button>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-medium text-gray-400">
                  Devices ({activeWorkspace.members.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activeWorkspace.members.map((member) => (
                    <span
                      key={member.deviceId}
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-700 bg-gray-800/80 px-2.5 py-1 text-xs text-gray-200"
                    >
                      <span
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                        style={{ backgroundColor: member.color }}
                      >
                        {member.initials}
                      </span>
                      {member.displayName}
                    </span>
                  ))}
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={handleSaveProfile}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 hover:bg-gray-700 disabled:opacity-50"
              >
                Save profile
              </button>

              <div className="space-y-2 border-t border-gray-800 pt-3">
                <div className="text-xs font-medium text-gray-400">Client Review (Offline HTML)</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleExportClientReviewSheet()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800/80 px-3 py-2 text-xs font-medium text-gray-100 hover:bg-gray-700 disabled:opacity-50"
                  >
                    <FileDown className="h-3.5 w-3.5 text-blue-400" />
                    Export Review (.html)
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleImportClientFeedback()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800/80 px-3 py-2 text-xs font-medium text-gray-100 hover:bg-gray-700 disabled:opacity-50"
                  >
                    <FileUp className="h-3.5 w-3.5 text-emerald-400" />
                    Import Feedback (.json)
                  </button>
                </div>
                {clientNotice && (
                  <div className="rounded-md border border-blue-800/60 bg-blue-950/40 px-2.5 py-1.5 text-xs text-blue-200">
                    {clientNotice}
                  </div>
                )}
              </div>

              <TeamSharedResourcesTabs workspaceId={activeWorkspace.manifest.workspaceId} />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-800/70 bg-red-950/50 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

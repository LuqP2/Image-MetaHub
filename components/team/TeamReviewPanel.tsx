import React, { useState } from 'react';
import { AlertTriangle, Check, MapPin, MessageSquare, Send, Users, X } from 'lucide-react';
import type { Directory, IndexedImage } from '../../types';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { useTeamWorkspaceStore } from '../../store/useTeamWorkspaceStore';
import {
  REVIEW_STATUS_META,
  REVIEW_STATUS_ORDER,
  addAssetComment,
  resolveAssetReviewConflict,
  resolveImageTeamContext,
  setAssetReviewStatus,
  toggleAssetCommentResolved,
} from '../../services/team/reviewService';
import type { TeamReviewStatus } from '../../services/team/teamWorkspaceTypes';

interface TeamReviewPanelProps {
  image: IndexedImage;
  directories: Directory[];
}

export const TeamReviewPanel: React.FC<TeamReviewPanelProps> = ({ image, directories }) => {
  const { canUseTeams } = useFeatureAccess();
  const workspacesById = useTeamWorkspaceStore((state) => state.workspacesById);
  const assetStatesByWorkspace = useTeamWorkspaceStore((state) => state.assetStatesByWorkspace);
  const pinPlacementActive = useTeamWorkspaceStore((state) => state.pinPlacementActive);
  const draftPin = useTeamWorkspaceStore((state) => state.draftPin);
  const highlightedCommentId = useTeamWorkspaceStore((state) => state.highlightedCommentId);
  const setPinPlacementActive = useTeamWorkspaceStore((state) => state.setPinPlacementActive);
  const setDraftPin = useTeamWorkspaceStore((state) => state.setDraftPin);
  const setHighlightedCommentId = useTeamWorkspaceStore((state) => state.setHighlightedCommentId);

  const [commentText, setCommentText] = useState('');
  const [busy, setBusy] = useState(false);

  const context = resolveImageTeamContext(
    image,
    directories,
    workspacesById,
    assetStatesByWorkspace,
  );

  if (!context) return null;

  const currentStatus: TeamReviewStatus = context.assetState?.reviewStatus ?? 'none';
  const conflict = context.assetState?.reviewConflict ?? null;
  const comments = context.assetState?.comments ?? [];

  const handleStatusClick = async (status: TeamReviewStatus) => {
    if (!canUseTeams) return;
    setBusy(true);
    try {
      const nextStatus = currentStatus === status && !conflict ? 'none' : status;
      if (conflict) {
        await resolveAssetReviewConflict(context, nextStatus);
      } else {
        await setAssetReviewStatus(context, nextStatus);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canUseTeams || !commentText.trim() || busy) return;
    setBusy(true);
    try {
      await addAssetComment(context, commentText, draftPin);
      setCommentText('');
      setDraftPin(null);
      setPinPlacementActive(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-700/80 bg-gray-900/70 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-200">
          <Users className="h-3.5 w-3.5 text-blue-400" />
          <span>Team Review</span>
          {!canUseTeams && (
            <span className="rounded bg-amber-950/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-200 border border-amber-700/60">
              Read-only
            </span>
          )}
        </div>
        <span className="truncate text-[11px] text-gray-400" title={context.workspace.manifest.name}>
          {context.workspace.manifest.name}
        </span>
      </div>

      {conflict && (
        <div className="space-y-2 rounded-md border border-rose-600/70 bg-rose-950/50 p-2.5 text-xs text-rose-100">
          <div className="flex items-center gap-1.5 font-semibold text-rose-200">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Concurrent approval conflict</span>
          </div>
          <div className="space-y-1">
            {conflict.competingDecisions.map((decision) => (
              <div key={decision.opId} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate">
                  <strong>{decision.authorName || decision.deviceId}</strong> → {REVIEW_STATUS_META[decision.status].label}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleStatusClick(decision.status)}
                  className="shrink-0 rounded border border-rose-400/60 bg-rose-900/70 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-rose-800 disabled:opacity-50"
                >
                  Keep
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        {REVIEW_STATUS_ORDER.map((status) => {
          const meta = REVIEW_STATUS_META[status];
          const isActive = !conflict && currentStatus === status;
          return (
            <button
              key={status}
              type="button"
              disabled={busy || !canUseTeams}
              onClick={() => void handleStatusClick(status)}
              className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                isActive
                  ? meta.buttonActiveClass
                  : 'border-gray-700 bg-gray-800/80 text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      {context.assetState?.reviewDecision && !conflict && currentStatus !== 'none' && (
        <div className="text-[11px] text-gray-400">
          Updated by <span className="text-gray-200">{context.assetState.reviewDecision.authorName || context.assetState.reviewDecision.deviceId}</span>
        </div>
      )}

      <div className="space-y-2 border-t border-gray-800 pt-2.5">
        <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-gray-400">
          <span className="inline-flex items-center gap-1.5">
            <MessageSquare className="h-3 w-3" />
            <span>Comments ({comments.length})</span>
          </span>
          <button
            type="button"
            disabled={!canUseTeams}
            onClick={() => setPinPlacementActive(!pinPlacementActive)}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              pinPlacementActive
                ? 'bg-blue-600 text-white'
                : 'border border-gray-700 bg-gray-800 text-gray-300 hover:text-white'
            }`}
            title="Click on the image to anchor this comment to an exact point"
          >
            <MapPin className="h-3 w-3" />
            <span>{pinPlacementActive ? 'Click image…' : 'Pin'}</span>
          </button>
        </div>

        {comments.length > 0 && (
          <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {(() => {
              let pinCounter = 0;
              return comments.map((comment) => {
                const pinNumber = comment.pin ? ++pinCounter : null;
                const isHighlighted = highlightedCommentId === comment.commentId;
                return (
                  <div
                    key={comment.commentId}
                    onMouseEnter={() => comment.pin && setHighlightedCommentId(comment.commentId)}
                    onMouseLeave={() => comment.pin && setHighlightedCommentId(null)}
                    className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                      isHighlighted
                        ? 'border-blue-500 bg-blue-950/40 text-gray-100'
                        : comment.resolved
                          ? 'border-gray-800 bg-gray-900/40 text-gray-500'
                          : 'border-gray-700/70 bg-gray-800/70 text-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[10px] text-gray-400">
                      <span className="inline-flex items-center gap-1.5 font-medium text-gray-300">
                        {pinNumber !== null && (
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-gray-950">
                            {pinNumber}
                          </span>
                        )}
                        {comment.authorName || comment.deviceId}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toggleAssetCommentResolved(context, comment.commentId, !comment.resolved)}
                        className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-gray-700 ${
                          comment.resolved ? 'text-emerald-400' : 'text-gray-400 hover:text-gray-200'
                        }`}
                        title={comment.resolved ? 'Reopen comment' : 'Resolve comment'}
                      >
                        <Check className="h-3 w-3" />
                        <span>{comment.resolved ? 'Resolved' : 'Resolve'}</span>
                      </button>
                    </div>
                    <p className={`mt-0.5 whitespace-pre-wrap break-words ${comment.resolved ? 'line-through' : ''}`}>
                      {comment.text}
                    </p>
                  </div>
                );
              });
            })()}
          </div>
        )}

        {draftPin && (
          <div className="flex items-center justify-between rounded border border-blue-700/60 bg-blue-950/40 px-2 py-1 text-[11px] text-blue-200">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              Pinned at ({Math.round(draftPin.x * 100)}%, {Math.round(draftPin.y * 100)}%)
            </span>
            <button
              type="button"
              onClick={() => setDraftPin(null)}
              className="rounded p-0.5 text-blue-300 hover:bg-blue-900/60"
              aria-label="Clear pin"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <form onSubmit={handleAddComment} className="flex items-center gap-1.5">
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            disabled={!canUseTeams}
            placeholder={canUseTeams ? 'Add review note...' : 'Teams license required to comment'}
            className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !canUseTeams || !commentText.trim()}
            className="inline-flex items-center justify-center rounded-md bg-blue-600 p-1.5 text-white hover:bg-blue-500 disabled:opacity-40"
            aria-label="Send comment"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};

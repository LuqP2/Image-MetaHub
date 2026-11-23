import React, { useState } from 'react';
import { AlertTriangle, Check, MessageSquare, Send, Users } from 'lucide-react';
import type { Directory, IndexedImage } from '../../types';
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
  const workspacesById = useTeamWorkspaceStore((state) => state.workspacesById);
  const assetStatesByWorkspace = useTeamWorkspaceStore((state) => state.assetStatesByWorkspace);

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
    if (!commentText.trim() || busy) return;
    setBusy(true);
    try {
      await addAssetComment(context, commentText);
      setCommentText('');
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
              disabled={busy}
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
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400">
          <MessageSquare className="h-3 w-3" />
          <span>Comments ({comments.length})</span>
        </div>

        {comments.length > 0 && (
          <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {comments.map((comment) => (
              <div
                key={comment.commentId}
                className={`rounded-md border px-2.5 py-1.5 text-xs ${
                  comment.resolved
                    ? 'border-gray-800 bg-gray-900/40 text-gray-500'
                    : 'border-gray-700/70 bg-gray-800/70 text-gray-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[10px] text-gray-400">
                  <span className="font-medium text-gray-300">{comment.authorName || comment.deviceId}</span>
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
            ))}
          </div>
        )}

        <form onSubmit={handleAddComment} className="flex items-center gap-1.5">
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add review note..."
            className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !commentText.trim()}
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

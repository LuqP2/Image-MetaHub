import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, XCircle, Wrench } from 'lucide-react';
import { REVIEW_STATUS_META, resolveImageTeamContext } from '../../services/team/reviewService';
import type { TeamAssetState } from '../../services/team/teamWorkspaceTypes';
import type { IndexedImage } from '../../types';
import { useImageStore } from '../../store/useImageStore';
import { useTeamWorkspaceStore } from '../../store/useTeamWorkspaceStore';

interface TeamReviewBadgeProps {
  assetState: TeamAssetState | null | undefined;
  compact?: boolean;
}

export const TeamReviewBadge: React.FC<TeamReviewBadgeProps> = ({ assetState, compact = false }) => {
  if (!assetState) return null;

  if (assetState.reviewConflict) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-rose-500/80 bg-rose-950/90 px-1.5 py-0.5 text-[10px] font-semibold text-rose-100 shadow-sm"
        title="Concurrent review conflict — open image to resolve"
      >
        <AlertTriangle className="h-3 w-3 shrink-0" />
        {!compact && <span>Conflict</span>}
      </span>
    );
  }

  if (assetState.reviewStatus === 'none') return null;

  const meta = REVIEW_STATUS_META[assetState.reviewStatus];
  const Icon =
    assetState.reviewStatus === 'approved'
      ? CheckCircle2
      : assetState.reviewStatus === 'needs_changes'
        ? Wrench
        : assetState.reviewStatus === 'rejected'
          ? XCircle
          : Clock;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium shadow-sm ${meta.badgeClass}`}
      title={
        assetState.reviewDecision?.authorName
          ? `${meta.label} by ${assetState.reviewDecision.authorName}`
          : meta.label
      }
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{compact ? meta.shortLabel : meta.label}</span>
    </span>
  );
};

export const ImageCardTeamReviewBadge: React.FC<{ image: Pick<IndexedImage, 'directoryId' | 'name'> }> = React.memo(({ image }) => {
  const workspacesById = useTeamWorkspaceStore((state) => state.workspacesById);
  const assetStatesByWorkspace = useTeamWorkspaceStore((state) => state.assetStatesByWorkspace);
  const directories = useImageStore((state) => state.directories);

  if (Object.keys(workspacesById).length === 0) return null;

  const ctx = resolveImageTeamContext(image, directories, workspacesById, assetStatesByWorkspace);
  if (!ctx?.assetState) return null;
  if (!ctx.assetState.reviewConflict && ctx.assetState.reviewStatus === 'none') return null;

  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-10">
      <TeamReviewBadge assetState={ctx.assetState} compact />
    </div>
  );
});
ImageCardTeamReviewBadge.displayName = 'ImageCardTeamReviewBadge';

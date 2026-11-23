import type { Directory, IndexedImage } from '../../types';
import { buildWorkspaceAssetKey, normalizeWorkspaceRelativePath } from './teamOpsReducer';
import type {
  TeamAssetState,
  TeamCommentPin,
  TeamReviewStatus,
  TeamWorkspaceSummary,
} from './teamWorkspaceTypes';
import { useTeamWorkspaceStore } from '../../store/useTeamWorkspaceStore';

export interface ReviewStatusMeta {
  status: TeamReviewStatus;
  label: string;
  shortLabel: string;
  badgeClass: string;
  buttonActiveClass: string;
}

export const REVIEW_STATUS_ORDER: TeamReviewStatus[] = [
  'in_review',
  'needs_changes',
  'approved',
  'rejected',
];

export const REVIEW_STATUS_META: Record<TeamReviewStatus, ReviewStatusMeta> = {
  none: {
    status: 'none',
    label: 'Unreviewed',
    shortLabel: 'None',
    badgeClass: 'bg-gray-800/80 text-gray-300 border-gray-700',
    buttonActiveClass: 'bg-gray-700 text-gray-100 border-gray-500',
  },
  in_review: {
    status: 'in_review',
    label: 'In Review',
    shortLabel: 'Review',
    badgeClass: 'bg-blue-950/85 text-blue-200 border-blue-700/70',
    buttonActiveClass: 'bg-blue-600 text-white border-blue-400',
  },
  needs_changes: {
    status: 'needs_changes',
    label: 'Needs Changes',
    shortLabel: 'Changes',
    badgeClass: 'bg-amber-950/85 text-amber-200 border-amber-700/70',
    buttonActiveClass: 'bg-amber-600 text-white border-amber-400',
  },
  approved: {
    status: 'approved',
    label: 'Approved',
    shortLabel: 'Approved',
    badgeClass: 'bg-emerald-950/85 text-emerald-200 border-emerald-700/70',
    buttonActiveClass: 'bg-emerald-600 text-white border-emerald-400',
  },
  rejected: {
    status: 'rejected',
    label: 'Rejected',
    shortLabel: 'Rejected',
    badgeClass: 'bg-red-950/85 text-red-200 border-red-700/70',
    buttonActiveClass: 'bg-red-600 text-white border-red-400',
  },
};

export interface ImageTeamContext {
  workspace: TeamWorkspaceSummary;
  workspaceId: string;
  assetKey: string;
  relativePath: string;
  contentHash: string | null;
  assetState: TeamAssetState | null;
}

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function resolveImageTeamContext(
  image: Pick<IndexedImage, 'directoryId' | 'name'>,
  directories: Directory[],
  workspacesById: Record<string, TeamWorkspaceSummary>,
  assetStatesByWorkspace: Record<string, Record<string, TeamAssetState>>,
): ImageTeamContext | null {
  if (!image.directoryId || !image.name) return null;
  const dir = directories.find((d) => d.id === image.directoryId);
  if (!dir?.path) return null;

  const normalizedDir = normalizeFsPath(dir.path);
  const workspace = Object.values(workspacesById).find(
    (ws) => normalizeFsPath(ws.rootPath) === normalizedDir,
  );
  if (!workspace) return null;

  let relativePath: string;
  try {
    relativePath = normalizeWorkspaceRelativePath(image.name);
  } catch {
    return null;
  }

  const workspaceId = workspace.manifest.workspaceId;
  const statesRecord = assetStatesByWorkspace[workspaceId] ?? {};
  const defaultKey = buildWorkspaceAssetKey(relativePath, null);

  let assetState: TeamAssetState | null = statesRecord[defaultKey] ?? null;
  if (!assetState) {
    assetState = Object.values(statesRecord).find((s) => s.relativePath === relativePath) ?? null;
  }

  return {
    workspace,
    workspaceId,
    assetKey: assetState?.assetKey ?? defaultKey,
    relativePath,
    contentHash: assetState?.contentHash ?? null,
    assetState,
  };
}

export async function setAssetReviewStatus(
  context: ImageTeamContext,
  status: TeamReviewStatus,
  note?: string,
): Promise<void> {
  const baseOpId = context.assetState?.reviewDecision?.opId ?? null;
  await useTeamWorkspaceStore.getState().queueOp(
    context.workspaceId,
    {
      type: 'set_review_status',
      assetKey: context.assetKey,
      relativePath: context.relativePath,
      contentHash: context.contentHash,
      status,
      baseOpId,
      ...(note && note.trim() ? { note: note.trim() } : {}),
    },
    true,
  );
}

export async function resolveAssetReviewConflict(
  context: ImageTeamContext,
  chosenStatus: TeamReviewStatus,
  note?: string,
): Promise<void> {
  const competingOpIds = context.assetState?.reviewConflict?.competingDecisions.map((d) => d.opId) ?? [];
  if (competingOpIds.length === 0) {
    await setAssetReviewStatus(context, chosenStatus, note);
    return;
  }
  await useTeamWorkspaceStore.getState().queueOp(
    context.workspaceId,
    {
      type: 'resolve_review_conflict',
      assetKey: context.assetKey,
      relativePath: context.relativePath,
      contentHash: context.contentHash,
      status: chosenStatus,
      resolvedOpIds: competingOpIds,
      ...(note && note.trim() ? { note: note.trim() } : {}),
    },
    true,
  );
}

export async function addAssetComment(
  context: ImageTeamContext,
  text: string,
  pin?: TeamCommentPin | null,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const commentId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  await useTeamWorkspaceStore.getState().queueOp(
    context.workspaceId,
    {
      type: 'add_comment',
      assetKey: context.assetKey,
      relativePath: context.relativePath,
      contentHash: context.contentHash,
      commentId,
      text: trimmed,
      ...(pin ? { pin } : {}),
    },
    true,
  );
}

export async function toggleAssetCommentResolved(
  context: ImageTeamContext,
  commentId: string,
  resolved: boolean,
): Promise<void> {
  await useTeamWorkspaceStore.getState().queueOp(
    context.workspaceId,
    {
      type: 'resolve_comment',
      assetKey: context.assetKey,
      relativePath: context.relativePath,
      contentHash: context.contentHash,
      commentId,
      resolved,
    },
    true,
  );
}

export type TeamReviewFilterValue =
  | 'all'
  | 'approved'
  | 'needs_changes'
  | 'in_review'
  | 'rejected'
  | 'conflict'
  | 'unreviewed';

export function filterImagesByTeamReview(
  images: IndexedImage[],
  filterValue: TeamReviewFilterValue,
  directories: Directory[],
  workspacesById: Record<string, TeamWorkspaceSummary>,
  assetStatesByWorkspace: Record<string, Record<string, TeamAssetState>>,
): IndexedImage[] {
  if (filterValue === 'all' || Object.keys(workspacesById).length === 0) {
    return images;
  }

  return images.filter((image) => {
    const context = resolveImageTeamContext(
      image,
      directories,
      workspacesById,
      assetStatesByWorkspace,
    );
    if (!context) return false;
    const state = context.assetState;

    if (filterValue === 'conflict') {
      return Boolean(state?.reviewConflict);
    }
    if (filterValue === 'unreviewed') {
      return !state || (!state.reviewConflict && state.reviewStatus === 'none');
    }
    return Boolean(state && !state.reviewConflict && state.reviewStatus === filterValue);
  });
}

export function filterApprovedDeliveryImages(
  images: IndexedImage[],
  directories: Array<{ id: string; path: string }>,
  workspacesById: Record<string, TeamWorkspaceSummary>,
  assetStatesByWorkspace: Record<string, Record<string, TeamAssetState>>,
): IndexedImage[] {
  const dirList = directories as Directory[];
  return images.filter((image) => {
    const context = resolveImageTeamContext(
      image,
      dirList,
      workspacesById,
      assetStatesByWorkspace,
    );
    return Boolean(
      context?.assetState
      && !context.assetState.reviewConflict
      && context.assetState.reviewStatus === 'approved',
    );
  });
}

export async function bulkSetAssetReviewStatus(
  images: IndexedImage[],
  directories: Directory[],
  status: TeamReviewStatus,
): Promise<number> {
  const store = useTeamWorkspaceStore.getState();
  const touchedWorkspaces = new Set<string>();
  let updatedCount = 0;

  for (const image of images) {
    const context = resolveImageTeamContext(
      image,
      directories,
      store.workspacesById,
      store.assetStatesByWorkspace,
    );
    if (!context) continue;
    const baseOpId = context.assetState?.reviewDecision?.opId ?? null;
    await store.queueOp(
      context.workspaceId,
      {
        type: 'set_review_status',
        assetKey: context.assetKey,
        relativePath: context.relativePath,
        contentHash: context.contentHash,
        status,
        baseOpId,
      },
      false,
    );
    touchedWorkspaces.add(context.workspaceId);
    updatedCount += 1;
  }

  for (const wsId of touchedWorkspaces) {
    await window.electronAPI?.team?.flushOps(wsId);
    await store.refreshWorkspaceOps(wsId);
  }

  return updatedCount;
}

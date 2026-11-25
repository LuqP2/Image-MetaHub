import type { Directory, ImageRating, IndexedImage } from '../../types';
import { isDevTeamsLicenseOverride } from '../../hooks/useFeatureAccess';
import { useLicenseStore, getTrialPeriod, TRIAL_DURATION_DAYS } from '../../store/useLicenseStore';
import { useTeamWorkspaceStore } from '../../store/useTeamWorkspaceStore';
import { resolveImageTeamContext } from './reviewService';
import type { TeamAssetState } from './teamWorkspaceTypes';

let isApplyingRemoteTeamSync = false;

/**
 * Non-React entitlement check mirroring `useFeatureAccess().canUseTeams`.
 * Reading existing `.imh-team/` data remains free/open; writing collaborative ops requires Teams or active trial.
 */
export function hasTeamWriteAccess(): boolean {
  if (isDevTeamsLicenseOverride()) return true;
  const license = useLicenseStore.getState();
  if (!license.initialized) return false;
  const hasTeamsLicense =
    (license.licenseStatus === 'pro' || license.licenseStatus === 'lifetime')
    && license.licenseTier === 'teams';
  if (hasTeamsLicense) return true;

  const trialPeriod = getTrialPeriod(license);
  if (license.licenseStatus === 'trial' && trialPeriod.startDate) {
    const now = Date.now();
    const duration = trialPeriod.durationDays ?? TRIAL_DURATION_DAYS;
    const trialEnd = trialPeriod.startDate + duration * 24 * 60 * 60 * 1000;
    if (now >= trialPeriod.startDate && now < trialEnd) {
      return true;
    }
  }
  return false;
}

function resolveWritableContext(
  image: Pick<IndexedImage, 'directoryId' | 'name'> | undefined,
  directories: Directory[],
) {
  if (!image || isApplyingRemoteTeamSync || !hasTeamWriteAccess()) return null;
  const teamState = useTeamWorkspaceStore.getState();
  if (Object.keys(teamState.workspacesById).length === 0) return null;
  return resolveImageTeamContext(
    image,
    directories,
    teamState.workspacesById,
    teamState.assetStatesByWorkspace,
  );
}

export async function emitTeamFavoriteOp(
  image: Pick<IndexedImage, 'directoryId' | 'name'> | undefined,
  directories: Directory[],
  isFavorite: boolean,
): Promise<boolean> {
  const ctx = resolveWritableContext(image, directories);
  if (!ctx) return false;
  await useTeamWorkspaceStore.getState().queueOp(
    ctx.workspaceId,
    {
      type: 'set_favorite',
      assetKey: ctx.assetKey,
      relativePath: ctx.relativePath,
      contentHash: ctx.contentHash,
      isFavorite,
    },
    false,
  );
  return true;
}

export async function emitTeamRatingOp(
  image: Pick<IndexedImage, 'directoryId' | 'name'> | undefined,
  directories: Directory[],
  rating: ImageRating | null,
): Promise<boolean> {
  const ctx = resolveWritableContext(image, directories);
  if (!ctx) return false;
  await useTeamWorkspaceStore.getState().queueOp(
    ctx.workspaceId,
    {
      type: 'set_rating',
      assetKey: ctx.assetKey,
      relativePath: ctx.relativePath,
      contentHash: ctx.contentHash,
      rating,
    },
    false,
  );
  return true;
}

export async function emitTeamTagsAddOp(
  image: Pick<IndexedImage, 'directoryId' | 'name'> | undefined,
  directories: Directory[],
  tags: string[],
): Promise<boolean> {
  const cleanTags = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (cleanTags.length === 0) return false;
  const ctx = resolveWritableContext(image, directories);
  if (!ctx) return false;
  await useTeamWorkspaceStore.getState().queueOp(
    ctx.workspaceId,
    {
      type: 'tags_add',
      assetKey: ctx.assetKey,
      relativePath: ctx.relativePath,
      contentHash: ctx.contentHash,
      tags: cleanTags,
    },
    false,
  );
  return true;
}

export async function emitTeamTagsRemoveOp(
  image: Pick<IndexedImage, 'directoryId' | 'name'> | undefined,
  directories: Directory[],
  tags: string[],
): Promise<boolean> {
  const cleanTags = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (cleanTags.length === 0) return false;
  const ctx = resolveWritableContext(image, directories);
  if (!ctx) return false;
  await useTeamWorkspaceStore.getState().queueOp(
    ctx.workspaceId,
    {
      type: 'tags_remove',
      assetKey: ctx.assetKey,
      relativePath: ctx.relativePath,
      contentHash: ctx.contentHash,
      tags: cleanTags,
    },
    false,
  );
  return true;
}

export interface RemoteTeamAnnotationPatch {
  imageId: string;
  isFavorite?: boolean;
  rating?: ImageRating | null;
  tags?: string[];
}

/**
 * Compute annotation updates needed to align local `images` with reduced `TeamAssetState`
 * for a given workspace. Only returns entries where synced fields actually differ.
 */
export function computeTeamAnnotationDiffs(
  images: IndexedImage[],
  directories: Directory[],
  workspaceId: string,
  workspacesById: ReturnType<typeof useTeamWorkspaceStore.getState>['workspacesById'],
  assetStatesRecord: Record<string, TeamAssetState>,
): RemoteTeamAnnotationPatch[] {
  const patches: RemoteTeamAnnotationPatch[] = [];
  const wrapped = { [workspaceId]: assetStatesRecord };

  for (const image of images) {
    const ctx = resolveImageTeamContext(image, directories, workspacesById, wrapped);
    if (!ctx || ctx.workspaceId !== workspaceId || !ctx.assetState) continue;

    const remote = ctx.assetState;
    const remoteRating = (
      typeof remote.rating === 'number' && remote.rating >= 1 && remote.rating <= 5
        ? (Math.trunc(remote.rating) as ImageRating)
        : null
    );
    const localFavorite = Boolean(image.isFavorite);
    const localRating = image.rating ?? null;
    const localTags = [...(image.tags ?? [])].sort();
    const remoteTags = [...remote.tags].sort();

    const tagsChanged =
      localTags.length !== remoteTags.length
      || localTags.some((tag, index) => tag !== remoteTags[index]);

    const patch: RemoteTeamAnnotationPatch = { imageId: image.id };
    if (remote.annotationFields?.isFavorite && localFavorite !== remote.isFavorite) {
      patch.isFavorite = remote.isFavorite;
    }
    if (remote.annotationFields?.rating && localRating !== remoteRating) {
      patch.rating = remoteRating;
    }
    if (remote.annotationFields?.tags && tagsChanged) patch.tags = remoteTags;
    if (Object.keys(patch).length > 1) patches.push(patch);
  }

  return patches;
}

export async function runWithRemoteTeamSyncGuard<T>(operation: () => Promise<T>): Promise<T> {
  isApplyingRemoteTeamSync = true;
  try {
    return await operation();
  } finally {
    isApplyingRemoteTeamSync = false;
  }
}

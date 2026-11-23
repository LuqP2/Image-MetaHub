import type {
  TeamAssetState,
  TeamComment,
  TeamCommentPin,
  TeamOpEvent,
  TeamReviewConflict,
  TeamReviewDecision,
  TeamReviewStatus,
  WorkspaceAssetIdentity,
} from './teamWorkspaceTypes';

export function normalizeCommentPin(pin: unknown): TeamCommentPin | null {
  if (!pin || typeof pin !== 'object' || Array.isArray(pin)) return null;
  const candidate = pin as { x?: unknown; y?: unknown };
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return {
    x: Math.round(x * 10_000) / 10_000,
    y: Math.round(y * 10_000) / 10_000,
  };
}

/**
 * Normalize a workspace-relative path to POSIX form (`a/b/c.png`).
 * Rejects absolute paths and path traversal segments (`..`).
 */
export function normalizeWorkspaceRelativePath(rawPath: string): string {
  if (typeof rawPath !== 'string') {
    throw new Error('Workspace relative path must be a string.');
  }
  const slashNormalized = rawPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = slashNormalized.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.length === 0) {
    throw new Error('Workspace relative path cannot be empty.');
  }
  if (segments.some((segment) => segment === '..') || /^[a-zA-Z]:/.test(segments[0])) {
    throw new Error(`Invalid workspace relative path: ${rawPath}`);
  }
  return segments.join('/');
}

/**
 * Build a deterministic workspace-scoped asset key.
 * When a contentHash is known, combine it with the normalized relativePath so:
 *  - Identical content in two different folders (duplicates) never collide.
 *  - Renames can be detected and remapped cleanly via contentHash matching.
 */
export function buildWorkspaceAssetKey(relativePath: string, contentHash?: string | null): string {
  const normalizedPath = normalizeWorkspaceRelativePath(relativePath);
  const normalizedHash = typeof contentHash === 'string' && contentHash.trim()
    ? contentHash.trim().toLowerCase()
    : null;
  return normalizedHash ? `h:${normalizedHash}|p:${normalizedPath}` : `p:${normalizedPath}`;
}

export interface KnownAssetRecord {
  workspaceAssetKey: string;
  relativePath: string;
  contentHash: string | null;
}

export interface AssetIdentityResolution {
  identity: WorkspaceAssetIdentity;
  renamedFrom: KnownAssetRecord | null;
}

/**
 * Resolve canonical workspace asset identities across a directory snapshot,
 * preserving identity across unambiguous renames while keeping duplicate files distinct.
 */
export function resolveWorkspaceAssetIdentities(
  currentFiles: Array<{ relativePath: string; contentHash: string | null; fileSize?: number | null }>,
  previousRecords: KnownAssetRecord[],
): AssetIdentityResolution[] {
  const normalizedCurrent = currentFiles.map((file) => ({
    relativePath: normalizeWorkspaceRelativePath(file.relativePath),
    contentHash: file.contentHash ? file.contentHash.trim().toLowerCase() : null,
    fileSize: file.fileSize ?? null,
  }));

  const currentPathSet = new Set(normalizedCurrent.map((file) => file.relativePath));
  const previousByPath = new Map<string, KnownAssetRecord>();
  const missingPreviousByHash = new Map<string, KnownAssetRecord[]>();
  const currentCountByHash = new Map<string, number>();

  for (const file of normalizedCurrent) {
    if (file.contentHash) {
      currentCountByHash.set(file.contentHash, (currentCountByHash.get(file.contentHash) ?? 0) + 1);
    }
  }

  for (const prev of previousRecords) {
    const prevPath = normalizeWorkspaceRelativePath(prev.relativePath);
    const normalizedPrev: KnownAssetRecord = {
      workspaceAssetKey: prev.workspaceAssetKey,
      relativePath: prevPath,
      contentHash: prev.contentHash ? prev.contentHash.trim().toLowerCase() : null,
    };
    previousByPath.set(prevPath, normalizedPrev);
    if (!currentPathSet.has(prevPath) && normalizedPrev.contentHash) {
      const bucket = missingPreviousByHash.get(normalizedPrev.contentHash) ?? [];
      bucket.push(normalizedPrev);
      missingPreviousByHash.set(normalizedPrev.contentHash, bucket);
    }
  }

  const claimedPreviousKeys = new Set<string>();
  const results: AssetIdentityResolution[] = [];

  for (const file of normalizedCurrent) {
    const exactPathMatch = previousByPath.get(file.relativePath);
    if (exactPathMatch) {
      const key = exactPathMatch.workspaceAssetKey;
      results.push({
        identity: {
          workspaceAssetKey: key,
          relativePath: file.relativePath,
          contentHash: file.contentHash,
          fileSize: file.fileSize,
        },
        renamedFrom: null,
      });
      continue;
    }

    // Unambiguous rename: exactly one missing previous record has this hash,
    // and only one new (non-existing) current file claims it.
    let renamedFrom: KnownAssetRecord | null = null;
    if (file.contentHash) {
      const missingCandidates = (missingPreviousByHash.get(file.contentHash) ?? []).filter(
        (candidate) => !claimedPreviousKeys.has(candidate.workspaceAssetKey),
      );
      const newFilesWithSameHash = normalizedCurrent.filter(
        (candidate) => candidate.contentHash === file.contentHash && !previousByPath.has(candidate.relativePath),
      );
      if (missingCandidates.length === 1 && newFilesWithSameHash.length === 1) {
        renamedFrom = missingCandidates[0];
        claimedPreviousKeys.add(renamedFrom.workspaceAssetKey);
      }
    }

    const workspaceAssetKey = renamedFrom
      ? renamedFrom.workspaceAssetKey
      : buildWorkspaceAssetKey(file.relativePath, file.contentHash);

    results.push({
      identity: {
        workspaceAssetKey,
        relativePath: file.relativePath,
        contentHash: file.contentHash,
        fileSize: file.fileSize,
      },
      renamedFrom,
    });
  }

  return results;
}

interface InternalTagEntry {
  addOpIds: Set<string>;
  removedAddOpIds: Set<string>;
  removedAtClock: number;
  addedAtClock: number;
}

interface InternalAssetReducerState {
  assetKey: string;
  relativePath: string;
  contentHash: string | null;
  tags: Map<string, InternalTagEntry>;
  rating: { value: number | null; clock: number; opId: string } | null;
  favorite: { value: boolean; clock: number; opId: string } | null;
  shadow: { fields: Record<string, { value: unknown; clock: number; opId: string }> };
  /** Active frontier of review decisions not yet superseded by a descendant op. */
  reviewFrontier: Map<string, TeamReviewDecision>;
  supersededReviewOpIds: Set<string>;
  comments: Map<string, TeamComment>;
  commentResolutions: Map<string, { resolved: boolean; clock: number; opId: string; deviceId: string; authorName: string | null; createdAt: string }>;
  lastLamportClock: number;
}

function compareOps(a: TeamOpEvent, b: TeamOpEvent): number {
  if (a.lamportClock !== b.lamportClock) {
    return a.lamportClock - b.lamportClock;
  }
  return a.opId.localeCompare(b.opId);
}

function isNewerScalar(
  current: { clock: number; opId: string } | null | undefined,
  clock: number,
  opId: string,
): boolean {
  if (!current) return true;
  if (clock !== current.clock) return clock > current.clock;
  return opId.localeCompare(current.opId) > 0;
}

function createInternalState(op: TeamOpEvent): InternalAssetReducerState {
  return {
    assetKey: op.assetKey,
    relativePath: op.relativePath,
    contentHash: op.contentHash,
    tags: new Map(),
    rating: null,
    favorite: null,
    shadow: { fields: {} },
    reviewFrontier: new Map(),
    supersededReviewOpIds: new Set(),
    comments: new Map(),
    commentResolutions: new Map(),
    lastLamportClock: op.lamportClock,
  };
}

function mergeInternalStates(
  target: InternalAssetReducerState,
  source: InternalAssetReducerState,
): void {
  for (const [tag, entry] of source.tags.entries()) {
    const existing = target.tags.get(tag);
    if (!existing) {
      target.tags.set(tag, {
        addOpIds: new Set(entry.addOpIds),
        removedAddOpIds: new Set(entry.removedAddOpIds),
        removedAtClock: entry.removedAtClock,
        addedAtClock: entry.addedAtClock,
      });
    } else {
      entry.addOpIds.forEach((id) => existing.addOpIds.add(id));
      entry.removedAddOpIds.forEach((id) => existing.removedAddOpIds.add(id));
      existing.removedAtClock = Math.max(existing.removedAtClock, entry.removedAtClock);
      existing.addedAtClock = Math.max(existing.addedAtClock, entry.addedAtClock);
    }
  }
  if (source.rating && isNewerScalar(target.rating, source.rating.clock, source.rating.opId)) {
    target.rating = source.rating;
  }
  if (source.favorite && isNewerScalar(target.favorite, source.favorite.clock, source.favorite.opId)) {
    target.favorite = source.favorite;
  }
  for (const [field, entry] of Object.entries(source.shadow.fields)) {
    if (isNewerScalar(target.shadow.fields[field], entry.clock, entry.opId)) {
      target.shadow.fields[field] = entry;
    }
  }
  source.supersededReviewOpIds.forEach((id) => target.supersededReviewOpIds.add(id));
  for (const [id, decision] of source.reviewFrontier.entries()) {
    if (!target.supersededReviewOpIds.has(id)) {
      target.reviewFrontier.set(id, decision);
    }
  }
  for (const id of target.supersededReviewOpIds) {
    target.reviewFrontier.delete(id);
  }
  for (const [commentId, comment] of source.comments.entries()) {
    if (!target.comments.has(commentId)) {
      target.comments.set(commentId, comment);
    }
  }
  for (const [commentId, res] of source.commentResolutions.entries()) {
    const existing = target.commentResolutions.get(commentId);
    if (isNewerScalar(existing, res.clock, res.opId)) {
      target.commentResolutions.set(commentId, res);
    }
  }
  target.lastLamportClock = Math.max(target.lastLamportClock, source.lastLamportClock);
}

/**
 * Deterministic, order-independent reducer for Team Workspace operations.
 * - Deduplicates operations by `opId`.
 * - Resolves tags via OR-Set semantics.
 * - Detects concurrent review/approval conflicts using `baseOpId` instead of silent wall-clock LWW.
 */
export function reduceTeamOps(ops: TeamOpEvent[]): Map<string, TeamAssetState> {
  const uniqueOps = new Map<string, TeamOpEvent>();
  for (const op of ops) {
    if (!uniqueOps.has(op.opId)) {
      uniqueOps.set(op.opId, op);
    }
  }

  const sortedOps = Array.from(uniqueOps.values()).sort(compareOps);
  const aliasMap = new Map<string, string>();
  const states = new Map<string, InternalAssetReducerState>();

  const resolveKey = (key: string): string => {
    let current = key;
    const visited = new Set<string>();
    while (aliasMap.has(current) && !visited.has(current)) {
      visited.add(current);
      current = aliasMap.get(current)!;
    }
    return current;
  };

  for (const op of sortedOps) {
    if (op.type === 'asset_moved') {
      const oldResolved = resolveKey(op.previousAssetKey);
      const newResolved = resolveKey(op.assetKey);
      if (oldResolved !== newResolved) {
        aliasMap.set(oldResolved, newResolved);
        const oldState = states.get(oldResolved);
        const existingNew = states.get(newResolved);
        if (oldState && existingNew) {
          mergeInternalStates(existingNew, oldState);
          existingNew.relativePath = op.relativePath;
          if (op.contentHash) existingNew.contentHash = op.contentHash;
          states.delete(oldResolved);
        } else if (oldState) {
          oldState.assetKey = newResolved;
          oldState.relativePath = op.relativePath;
          if (op.contentHash) oldState.contentHash = op.contentHash;
          states.set(newResolved, oldState);
          states.delete(oldResolved);
        }
      }
      continue;
    }

    const canonicalKey = resolveKey(op.assetKey);
    let state = states.get(canonicalKey);
    if (!state) {
      state = createInternalState({ ...op, assetKey: canonicalKey });
      states.set(canonicalKey, state);
    }
    state.lastLamportClock = Math.max(state.lastLamportClock, op.lamportClock);
    if (op.relativePath) {
      state.relativePath = op.relativePath;
    }
    if (op.contentHash && !state.contentHash) {
      state.contentHash = op.contentHash;
    }

    switch (op.type) {
      case 'tags_add': {
        for (const rawTag of op.tags) {
          const tag = rawTag.trim().toLowerCase();
          if (!tag) continue;
          let entry = state.tags.get(tag);
          if (!entry) {
            entry = { addOpIds: new Set(), removedAddOpIds: new Set(), removedAtClock: -1, addedAtClock: -1 };
            state.tags.set(tag, entry);
          }
          entry.addOpIds.add(op.opId);
          entry.addedAtClock = Math.max(entry.addedAtClock, op.lamportClock);
        }
        break;
      }

      case 'tags_remove': {
        for (const rawTag of op.tags) {
          const tag = rawTag.trim().toLowerCase();
          if (!tag) continue;
          let entry = state.tags.get(tag);
          if (!entry) {
            entry = { addOpIds: new Set(), removedAddOpIds: new Set(), removedAtClock: -1, addedAtClock: -1 };
            state.tags.set(tag, entry);
          }
          if (op.observedAddOpIds && op.observedAddOpIds.length > 0) {
            for (const observedId of op.observedAddOpIds) {
              entry.removedAddOpIds.add(observedId);
            }
          } else {
            // Fallback when caller did not supply observed add opIds: tombstone all adds up to this clock.
            for (const existingId of entry.addOpIds) {
              entry.removedAddOpIds.add(existingId);
            }
          }
          entry.removedAtClock = Math.max(entry.removedAtClock, op.lamportClock);
        }
        break;
      }

      case 'set_rating': {
        if (isNewerScalar(state.rating, op.lamportClock, op.opId)) {
          state.rating = { value: op.rating, clock: op.lamportClock, opId: op.opId };
        }
        break;
      }

      case 'set_favorite': {
        if (isNewerScalar(state.favorite, op.lamportClock, op.opId)) {
          state.favorite = { value: op.isFavorite, clock: op.lamportClock, opId: op.opId };
        }
        break;
      }

      case 'set_shadow_patch': {
        for (const [field, value] of Object.entries(op.patch)) {
          if (isNewerScalar(state.shadow.fields[field], op.lamportClock, op.opId)) {
            state.shadow.fields[field] = { value, clock: op.lamportClock, opId: op.opId };
          }
        }
        break;
      }

      case 'set_review_status': {
        if (op.baseOpId) {
          state.supersededReviewOpIds.add(op.baseOpId);
          state.reviewFrontier.delete(op.baseOpId);
        }
        if (!state.supersededReviewOpIds.has(op.opId)) {
          state.reviewFrontier.set(op.opId, {
            opId: op.opId,
            status: op.status,
            deviceId: op.deviceId,
            authorName: op.authorName ?? null,
            lamportClock: op.lamportClock,
            createdAt: op.createdAt,
            baseOpId: op.baseOpId,
            note: op.note,
          });
        }
        break;
      }

      case 'resolve_review_conflict': {
        for (const resolvedId of op.resolvedOpIds) {
          state.supersededReviewOpIds.add(resolvedId);
          state.reviewFrontier.delete(resolvedId);
        }
        if (!state.supersededReviewOpIds.has(op.opId)) {
          state.reviewFrontier.set(op.opId, {
            opId: op.opId,
            status: op.status,
            deviceId: op.deviceId,
            authorName: op.authorName ?? null,
            lamportClock: op.lamportClock,
            createdAt: op.createdAt,
            baseOpId: op.resolvedOpIds[0] ?? null,
            note: op.note,
          });
        }
        break;
      }

      case 'add_comment': {
        if (!state.comments.has(op.commentId)) {
          state.comments.set(op.commentId, {
            commentId: op.commentId,
            opId: op.opId,
            deviceId: op.deviceId,
            authorName: op.authorName ?? null,
            text: op.text,
            pin: normalizeCommentPin(op.pin),
            createdAt: op.createdAt,
            lamportClock: op.lamportClock,
            resolved: false,
            resolvedByDeviceId: null,
            resolvedByName: null,
            resolvedAt: null,
          });
        }
        break;
      }

      case 'resolve_comment': {
        const existing = state.commentResolutions.get(op.commentId);
        if (isNewerScalar(existing, op.lamportClock, op.opId)) {
          state.commentResolutions.set(op.commentId, {
            resolved: op.resolved,
            clock: op.lamportClock,
            opId: op.opId,
            deviceId: op.deviceId,
            authorName: op.authorName ?? null,
            createdAt: op.createdAt,
          });
        }
        break;
      }
    }
  }

  const output = new Map<string, TeamAssetState>();

  for (const [assetKey, state] of states.entries()) {
    const activeTags: string[] = [];
    for (const [tag, entry] of state.tags.entries()) {
      const hasLiveAdd = Array.from(entry.addOpIds).some((id) => !entry.removedAddOpIds.has(id));
      if (hasLiveAdd) {
        activeTags.push(tag);
      }
    }
    activeTags.sort();

    // Finalize review frontier & detect concurrent conflicts.
    const frontierList = Array.from(state.reviewFrontier.values()).sort((a, b) =>
      a.lamportClock !== b.lamportClock
        ? b.lamportClock - a.lamportClock
        : b.opId.localeCompare(a.opId),
    );

    const distinctStatuses = new Set(frontierList.map((d) => d.status));
    let reviewStatus: TeamReviewStatus = 'none';
    let reviewDecision: TeamReviewDecision | null = null;
    let reviewConflict: TeamReviewConflict | null = null;

    if (frontierList.length === 1) {
      reviewDecision = frontierList[0];
      reviewStatus = reviewDecision.status;
    } else if (frontierList.length > 1) {
      reviewDecision = frontierList[0];
      reviewStatus = reviewDecision.status;
      if (distinctStatuses.size > 1) {
        reviewConflict = {
          baseOpId: frontierList[0].baseOpId,
          competingDecisions: frontierList,
        };
      }
    }

    const comments: TeamComment[] = Array.from(state.comments.values())
      .map((comment) => {
        const resolution = state.commentResolutions.get(comment.commentId);
        if (!resolution) return comment;
        return {
          ...comment,
          resolved: resolution.resolved,
          resolvedByDeviceId: resolution.resolved ? resolution.deviceId : null,
          resolvedByName: resolution.resolved ? resolution.authorName : null,
          resolvedAt: resolution.resolved ? resolution.createdAt : null,
        };
      })
      .sort((a, b) =>
        a.lamportClock !== b.lamportClock
          ? a.lamportClock - b.lamportClock
          : a.opId.localeCompare(b.opId),
      );

    const shadowEntries = Object.entries(state.shadow.fields);
    const shadowPatch = shadowEntries.length > 0
      ? Object.fromEntries(shadowEntries.map(([field, entry]) => [field, entry.value]))
      : null;

    output.set(assetKey, {
      assetKey,
      relativePath: state.relativePath,
      contentHash: state.contentHash,
      tags: activeTags,
      rating: state.rating ? state.rating.value : null,
      isFavorite: state.favorite ? state.favorite.value : false,
      reviewStatus,
      reviewDecision,
      reviewConflict,
      comments,
      shadowPatch,
      lastLamportClock: state.lastLamportClock,
    });
  }

  return output;
}

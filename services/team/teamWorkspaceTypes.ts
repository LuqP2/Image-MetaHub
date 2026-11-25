export const TEAM_WORKSPACE_DIR_NAME = '.imh-team';
export const TEAM_WORKSPACE_SCHEMA_VERSION = 1;

export type TeamReviewStatus = 'none' | 'in_review' | 'needs_changes' | 'approved' | 'rejected';

export interface TeamWorkspaceManifest {
  schemaVersion: number;
  workspaceId: string;
  name: string;
  createdAt: string;
  createdByDeviceId: string;
}

/**
 * Local collaborative display profile stored per device in `.imh-team/members/<deviceId>.json`.
 * Strictly decorative for attribution — never treated as an authenticated user or commercial license seat.
 */
export interface TeamMemberProfile {
  deviceId: string;
  displayName: string;
  initials: string;
  color: string;
  updatedAt: string;
}

export interface WorkspaceAssetIdentity {
  /** Canonical workspace-scoped key used to bind team operations to an asset. */
  workspaceAssetKey: string;
  /** POSIX-normalized path relative to the workspace root (no leading slash). */
  relativePath: string;
  /** Optional content fingerprint (SHA-256 hex) for rename survival and duplicate disambiguation. */
  contentHash: string | null;
  fileSize?: number | null;
}

export interface TeamOpBase {
  opId: string;
  workspaceId: string;
  deviceId: string;
  lamportClock: number;
  /** Wall-clock timestamp for human display only; never used as conflict authority. */
  createdAt: string;
  assetKey: string;
  relativePath: string;
  contentHash: string | null;
  authorName?: string;
}

export interface TeamTagsAddOp extends TeamOpBase {
  type: 'tags_add';
  tags: string[];
}

export interface TeamTagsRemoveOp extends TeamOpBase {
  type: 'tags_remove';
  tags: string[];
  /** Observed add opIds being removed (OR-Set semantics). */
  observedAddOpIds?: string[];
}

export interface TeamSetRatingOp extends TeamOpBase {
  type: 'set_rating';
  rating: number | null;
}

export interface TeamSetFavoriteOp extends TeamOpBase {
  type: 'set_favorite';
  isFavorite: boolean;
}

export interface TeamSetReviewStatusOp extends TeamOpBase {
  type: 'set_review_status';
  status: TeamReviewStatus;
  /** The opId of the review decision this device saw before making this change (null if unreviewed). */
  baseOpId: string | null;
  note?: string;
}

export interface TeamResolveReviewConflictOp extends TeamOpBase {
  type: 'resolve_review_conflict';
  status: TeamReviewStatus;
  /** Competing decision opIds explicitly superseded by this resolution. */
  resolvedOpIds: string[];
  note?: string;
}

export interface TeamCommentPin {
  /** Normalized horizontal coordinate in [0, 1] relative to image bounds. */
  x: number;
  /** Normalized vertical coordinate in [0, 1] relative to image bounds. */
  y: number;
}

export interface TeamAddCommentOp extends TeamOpBase {
  type: 'add_comment';
  commentId: string;
  text: string;
  pin?: TeamCommentPin | null;
}

export interface TeamResolveCommentOp extends TeamOpBase {
  type: 'resolve_comment';
  commentId: string;
  resolved: boolean;
}

export interface TeamSetShadowPatchOp extends TeamOpBase {
  type: 'set_shadow_patch';
  patch: Record<string, unknown>;
}

export interface TeamAssetMovedOp extends TeamOpBase {
  type: 'asset_moved';
  previousAssetKey: string;
  previousRelativePath: string;
}

export type TeamOpEvent =
  | TeamTagsAddOp
  | TeamTagsRemoveOp
  | TeamSetRatingOp
  | TeamSetFavoriteOp
  | TeamSetReviewStatusOp
  | TeamResolveReviewConflictOp
  | TeamAddCommentOp
  | TeamResolveCommentOp
  | TeamSetShadowPatchOp
  | TeamAssetMovedOp;

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type TeamOpInput = DistributiveOmit<
  TeamOpEvent,
  'opId' | 'workspaceId' | 'deviceId' | 'lamportClock' | 'createdAt'
>;

/**
 * Immutable write-once batch file stored in `.imh-team/ops/<deviceId>/<seq>-<shortHash>.json`.
 * Never modified after creation to stay safe on NAS/SMB, Dropbox, Google Drive, and Syncthing.
 */
export interface TeamOpBatchFile {
  schemaVersion: number;
  batchId: string;
  workspaceId: string;
  deviceId: string;
  sequence: number;
  createdAt: string;
  ops: TeamOpEvent[];
}

export interface TeamReviewDecision {
  opId: string;
  status: TeamReviewStatus;
  deviceId: string;
  authorName: string | null;
  lamportClock: number;
  createdAt: string;
  baseOpId: string | null;
  note?: string;
}

export interface TeamReviewConflict {
  baseOpId: string | null;
  competingDecisions: TeamReviewDecision[];
}

export interface TeamComment {
  commentId: string;
  opId: string;
  deviceId: string;
  authorName: string | null;
  text: string;
  pin: TeamCommentPin | null;
  createdAt: string;
  lamportClock: number;
  resolved: boolean;
  resolvedByDeviceId: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
}

export interface TeamAssetState {
  assetKey: string;
  relativePath: string;
  contentHash: string | null;
  tags: string[];
  rating: number | null;
  isFavorite: boolean;
  /** Defaults are not authoritative until the corresponding annotation op exists. */
  annotationFields?: { tags: boolean; rating: boolean; isFavorite: boolean };
  reviewStatus: TeamReviewStatus;
  reviewDecision: TeamReviewDecision | null;
  reviewConflict: TeamReviewConflict | null;
  comments: TeamComment[];
  shadowPatch: Record<string, unknown> | null;
  lastLamportClock: number;
}

export interface TeamWorkspaceSyncStatus {
  workspaceId: string;
  rootPath: string;
  name: string;
  state: 'idle' | 'syncing' | 'error';
  lastSyncedAt: string | null;
  appliedFileCount: number;
  appliedOpCount: number;
  pendingLocalOps: number;
  memberCount: number;
  error: string | null;
}

export interface TeamWorkspaceSummary {
  manifest: TeamWorkspaceManifest;
  rootPath: string;
  localProfile: TeamMemberProfile;
  members: TeamMemberProfile[];
  syncStatus: TeamWorkspaceSyncStatus;
}

export interface TeamSharedPrompt {
  id: string;
  workspaceId: string;
  title: string;
  positivePrompt: string;
  negativePrompt: string;
  tags: string[];
  category?: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedByDeviceId: string;
  updatedByName: string;
  sourceRelativePath?: string | null;
}

export interface TeamSharedPromptInput {
  id?: string;
  title: string;
  positivePrompt: string;
  negativePrompt?: string;
  tags?: string[];
  category?: string | null;
  sourceRelativePath?: string | null;
}

export interface TeamBoardSummary {
  boardId: string;
  workspaceId: string;
  name: string;
  revision: number;
  contentHash: string;
  updatedAt: string;
  updatedByDeviceId: string;
  updatedByName: string;
}

export interface TeamBoardEnvelope extends TeamBoardSummary {
  format: 'image-metahub-team-board';
  schemaVersion: number;
  document: Record<string, unknown>;
}

export type TeamBoardSaveResult =
  | { saved: true; conflict: false; envelope: TeamBoardEnvelope }
  | { saved: false; conflict: true; remote: TeamBoardEnvelope };

export interface TeamExpectedModelEntry {
  name: string;
  type: string;
  sha256?: string | null;
  civitaiUrl?: string | null;
  huggingFaceUrl?: string | null;
  notes?: string | null;
}

export interface TeamModelsManifest {
  schemaVersion: number;
  workspaceId: string;
  updatedAt: string;
  updatedByDeviceId: string;
  updatedByName: string;
  models: TeamExpectedModelEntry[];
}

export interface TeamModelsComparison {
  installed: TeamExpectedModelEntry[];
  missing: TeamExpectedModelEntry[];
}

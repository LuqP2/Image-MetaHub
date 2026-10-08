export type ModelKind = 'lora' | 'checkpoint' | 'diffusion' | 'vae' | 'textEncoder' | 'clipVision' | 'controlnet' | 'upscaler' | 'embedding' | 'other';
export type ModelSourceKind = 'auto' | ModelKind;

export interface ModelSource {
  id: string;
  name: string;
  path: string;
  kind: ModelSourceKind;
  recursive: boolean;
  identifyOnScan?: boolean;
  watchUpdates?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ModelLocation {
  id: string;
  sourceId: string;
  sourceKind: ModelKind;
  sourceName: string;
  relativePath: string;
  absolutePath: string;
  fileName: string;
  size: number;
  createdAt: number | null;
  modifiedAt: number | null;
  discoveredAt: number;
  lastSeenAt: number;
  fileMetadata?: ModelFileMetadata;
  metadataError?: string;
  identificationAttemptAt?: number;
  sha256?: string;
  hashFingerprint?: { size: number; modifiedAt: number | null };
  civitai?: CivitaiModelMetadata | { status: 'notFound'; fetchedAt: number; url: string };
  huggingFace?: HuggingFaceBinding;
}

export interface HuggingFaceBinding {
  trackedRevision?: string;
  watchedDirectory?: string;
  recursive?: boolean;
  monitoringEnabled?: boolean;
  repoId: string;
  filePath: string;
  linkedRevision: string;
  verification: 'manual' | 'sha256';
  verifiedLocalSha256?: string;
  linkedRemoteFingerprint: string;
  resolvedCommit: string;
  size: number;
  fetchedAt: number;
}
export interface HuggingFaceFile {
  path: string;
  size: number;
  fingerprint: string;
  lfsSha256?: string;
  gitOid?: string;
  xetHash?: string;
}
export interface HuggingFaceLookup {
  repoId: string;
  revision: string;
  resolvedCommit: string;
  files: HuggingFaceFile[];
  fetchedAt: number;
}
export interface HuggingFaceWatchConfig {
  trackedRevision: string;
  watchedDirectory: string;
  recursive: boolean;
  monitoringEnabled: boolean;
}
export interface HuggingFaceRemoteSnapshot {
  repoId: string;
  revision: string;
  watchedDirectory: string;
  recursive: boolean;
  resolvedCommit: string;
  files: HuggingFaceFile[];
  linkedFiles: Record<string, HuggingFaceFile | null>;
  fetchedAt: number;
}
export interface HuggingFaceEvent {
  id: string;
  source: 'huggingFace';
  kind: 'fileChanged' | 'newModelFile' | 'fileUnavailable';
  path: string;
  fingerprint: string;
  commit: string;
  detectedAt: number;
}
export interface HuggingFaceWatchRecord {
  id: string;
  repoId: string;
  filePath: string;
  trackedRevision: string;
  watchedDirectory: string;
  recursive: boolean;
  snapshot?: HuggingFaceRemoteSnapshot;
  events: HuggingFaceEvent[];
  seenEventIds: string[];
  ignoredEventIds: string[];
  notifiedEventIds: string[];
  lastSuccessAt?: number;
  lastAttemptAt?: number;
  retryAt?: number;
  error?: string;
}
export interface ModelCommandResult {
  success: boolean;
  error?: string;
  lookup?: HuggingFaceLookup;
}

export interface ModelFileMetadata {
  modelName?: string;
  modelType?: string;
  baseModel?: string;
  architecture?: string;
  description?: string;
  triggerWords?: string[];
  raw: Record<string, string>;
  embeddedPreview?: string;
}

export interface CivitaiModelMetadata {
  modelId: number;
  versionId: number;
  modelName: string;
  versionName: string;
  modelType?: string;
  baseModel?: string;
  description?: string;
  trainedWords: string[];
  url: string;
  coverImage?: string;
  fetchedAt: number;
  publishedAt?: string;
  createdAt?: string;
  binding?: 'hash' | 'manual';
}

export interface ModelLocalMetadata {
  /** Stable local identity. Uses sha256:<hash> when known, otherwise location:<catalog id>. */
  id: string;
  sha256?: string;
  locationId?: string;
  displayName?: string;
  notes?: string;
  tags: string[];
  triggerWords?: string[];
  defaultStrength?: number;
  favorite?: boolean;
  watchUpdates?: boolean;
  previewImage?: string;
  examples?: ModelExample[];
  updatedAt: number;
}

export interface ModelExample {
  id: string;
  origin: 'library' | 'imported' | 'civitai';
  imageId?: string;
  preview: string;
  caption: string;
  versionId?: number;
}

export interface RemoteModelVersion {
  id: number;
  name: string;
  baseModel?: string;
  publishedAt?: string;
  createdAt?: string;
  description: string;
  url: string;
}

export interface ModelWatchRecord {
  id: string;
  modelId: number;
  modelName: string;
  versions: RemoteModelVersion[];
  knownVersionIds: number[];
  novelVersionIds: number[];
  seenVersionIds: number[];
  ignoredVersionIds: number[];
  notifiedVersionIds: number[];
  lastSuccessAt?: number;
  lastAttemptAt?: number;
  retryAt?: number;
  chronologyUnknown?: boolean;
  error?: string;
}

export interface ModelManagerSnapshot {
  hfWatchState?: import('./huggingFaceWatchState.mjs').PackedHuggingFaceWatches;
  hfWatches?: Record<string, HuggingFaceWatchRecord>;
  storage?: ModelStorageOverview;
  sourceStatus?: Record<string, { checkedAt: number; error?: string }>;
  removal?: { locationIds: string[]; selected: boolean } | null;
  usage?: Record<string, ModelUsageSummary>;
  revision: number;
  sources: ModelSource[];
  catalog: ModelCatalog;
  localMetadata: Record<string, ModelLocalMetadata>;
  watches: Record<string, ModelWatchRecord>;
  intervalHours: number;
  loading: boolean;
  progress: { kind: 'scan' | 'headers' | 'identify' | 'updates' | 'duplicates' | 'removal' | 'huggingFace'; current: number; total: number; name: string } | null;
  message: string | null;
  notification: string | null;
  picker?: { locationId: string; cover: boolean } | null;
  libraryIds?: string[];
  showUpdates?: boolean;
  checkResult?: { locationIds: string[]; failedLocationIds: string[]; message: string };
}

export type ModelManagerCommand =
  | { type: 'configureHF'; locationId: string; config: HuggingFaceWatchConfig }
  | { type: 'hfEventAction'; watchId: string; eventIds: string[]; action: 'seen' | 'ignore' | 'restore' }
  | { type: 'lookupHF'; locationId: string; repoId: string; revision: string; filePath?: string }
  | { type: 'bindHF'; locationId: string; repoId: string; revision: string; filePath: string; fingerprint: string }
  | { type: 'unbindHF'; locationId: string }
  | { type: 'verifyHF'; locationId: string }
  | { type: 'remove'; locationId: string }
  | { type: 'viewLibrary'; locationId: string; mode: ModelUsageMode }
  | { type: 'seen'; modelId: number; versionIds: number[] }
  | { type: 'versionAction'; modelId: number; versionId: number; action: 'ignore' | 'restore' }
  | { type: 'identify' | 'hash' | 'check' | 'unbind' | 'cover'; locationId: string }
  | { type: 'bind'; locationId: string; url: string }
  | { type: 'saveLocal'; locationId: string; patch: Partial<ModelLocalMetadata> }
  | { type: 'importMedia'; locationId: string; cover: boolean }
  | { type: 'libraryMedia'; locationId: string; imageId: string; cover: boolean }
  | { type: 'chooseLibrary'; locationId: string; cover: boolean }
  | { type: 'openImage'; imageId: string }
  | { type: 'examples'; locationId: string }
  | { type: 'example'; locationId: string; exampleId: string; caption?: string; remove?: boolean }
  | { type: 'cancel' };

export interface ManagedModel {
  id: string;
  sha256?: string;
  primaryLocationId: string;
  locationIds: string[];
}

export interface ModelCatalog {
  version: 1;
  locations: ModelLocation[];
  managedModels?: ManagedModel[];
  updatedAt: number;
}

export interface ModelSourceScanResult {
  sourceId: string;
  locations: Omit<ModelLocation, 'id' | 'sourceKind' | 'sourceName' | 'discoveredAt' | 'lastSeenAt'>[];
  error?: string;
}

export interface ModelInspectorItem {
  usage?: ModelUsageSummary;
  location: ModelLocation;
  localMetadata?: ModelLocalMetadata;
}

export interface ModelInspectorSnapshot {
  revision: number;
  items: ModelInspectorItem[];
  selectedId: string | null;
  followSelection: boolean;
  isAlwaysOnTop: boolean;
}

export type ModelUsageMode = 'total' | 'confirmed' | 'ambiguous';
export interface ModelUsageSummary {
  status: 'loading' | 'partial' | 'ready' | 'unsupported';
  confirmedCount: number;
  nameMatchedCount: number;
  ambiguousCount: number;
  totalCount: number;
  lastUsedAt: number | null;
  dateBasis: 'libraryFileDate';
}
export interface ManagedModelDescriptor {
  identity: string;
  locationIds: string[];
  sha256?: string;
  names: { key: string; ambiguous: boolean; knownHashes: string[] }[];
  supported: boolean;
  mode: ModelUsageMode;
}

export interface ModelStorageFile {
  key: string;
  path: string;
  locationIds: string[];
  size: number;
  modifiedAt: number | null;
  sha256?: string;
  physicalId?: string;
  linkCount?: number;
  stale: boolean;
  error?: string;
}
export interface ModelStorageOverview {
  files: ModelStorageFile[];
  sources: { sourceId: string; totalBytes?: number; availableBytes?: number; error?: string }[];
  checkedAt: number;
}
export interface ModelRemovalPlan {
  planId: string;
  expiresAt: number;
  files: { path: string; locationIds: string[]; size: number }[];
  totalBytes: number;
  remainingCopies: { path: string; count: number }[];
}
export interface ModelRemovalResult {
  removedLocationIds: string[];
  failures: { path: string; locationIds: string[]; error: string }[];
  cancelled?: boolean;
}

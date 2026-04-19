import type {
  ImageMetadata as SharedImageMetadata,
  InvokeAIMetadata as SharedInvokeAIMetadata,
  Automatic1111Metadata as SharedAutomatic1111Metadata,
  ComfyUINode as SharedComfyUINode,
  ComfyUIWorkflow as SharedComfyUIWorkflow,
  ComfyUIPrompt as SharedComfyUIPrompt,
  ComfyUIMetadata as SharedComfyUIMetadata,
  SwarmUIMetadata as SharedSwarmUIMetadata,
  EasyDiffusionMetadata as SharedEasyDiffusionMetadata,
  EasyDiffusionJson as SharedEasyDiffusionJson,
  MidjourneyMetadata as SharedMidjourneyMetadata,
  NijiMetadata as SharedNijiMetadata,
  ForgeMetadata as SharedForgeMetadata,
  DalleMetadata as SharedDalleMetadata,
  DreamStudioMetadata as SharedDreamStudioMetadata,
  FireflyMetadata as SharedFireflyMetadata,
  DrawThingsMetadata as SharedDrawThingsMetadata,
  FooocusMetadata as SharedFooocusMetadata,
  SDNextMetadata as SharedSDNextMetadata,
  LoRAInfo as SharedLoRAInfo,
  BaseMetadata as SharedBaseMetadata,
  ThumbnailStatus as SharedThumbnailStatus,
  ImageRating as SharedImageRating,
} from './packages/metadata-engine/src/core/types';

import * as sharedCoreTypes from './packages/metadata-engine/src/core/types';

export interface ExportBatchProgress {
  exportId: string | null;
  mode: 'folder' | 'zip';
  total: number;
  processed: number;
  exportedCount: number;
  failedCount: number;
  stage: 'copying' | 'finalizing' | 'done';
}

export type ExportMetadataMode = 'preserve' | 'strip';

export type EmbeddedMetadataWritePayload = object;

export interface EmbeddedMetadataBackupStatus {
  success: boolean;
  hasBackup?: boolean;
  backupId?: string;
  createdAt?: number;
  originalPath?: string;
  size?: number;
  mtimeMs?: number;
  sha256?: string;
  error?: string;
}

export type IndexedImageTransferMode = 'copy' | 'move';

export interface IndexedImageTransferProgress {
  transferId: string | null;
  mode: IndexedImageTransferMode;
  total: number;
  processed: number;
  transferredCount: number;
  failedCount: number;
  stage: 'copying' | 'finalizing' | 'done';
  statusText?: string;
}

export interface IndexedImageTransferResultItem {
  sourceDirectoryPath: string;
  sourceRelativePath: string;
  destinationDirectoryPath: string;
  destinationRelativePath: string;
  destinationAbsolutePath: string;
  fileName: string;
  size?: number;
  lastModified?: number;
  type?: string;
}

export interface WatchedFileRemovalPayload {
  directoryId: string;
  files: Array<{ path: string; name: string; relativePath?: string }>;
  folders: Array<{ path: string; name: string; relativePath?: string }>;
}

export interface ElectronAPI {
  trashFile: (filename: string) => Promise<{ success: boolean; error?: string }>;
  renameFile: (oldName: string, newName: string) => Promise<{ success: boolean; error?: string }>;
  setCurrentDirectory: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
  updateAllowedPaths: (paths: string[]) => Promise<{ success: boolean; error?: string }>;
  showDirectoryDialog: () => Promise<{ success: boolean; path?: string; name?: string; canceled?: boolean; error?: string }>;
  showSaveDialog: (options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
  showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  openCacheLocation: (cachePath: string) => Promise<{ success: boolean; error?: string }>;
  listSubfolders: (folderPath: string) => Promise<{ success: boolean; subfolders?: { name: string; path: string; realPath?: string }[]; error?: string }>;
  listDirectoryFiles: (args: { dirPath: string; recursive?: boolean }) => Promise<{
    success: boolean;
    files?: { name: string; lastModified: number; size: number; type: string; birthtimeMs?: number; contentModifiedMs?: number }[];
    error?: string;
  }>;
  readFile: (filePath: string) => Promise<{ success: boolean; data?: Buffer; error?: string; errorType?: string; errorCode?: string }>;
  readFilesBatch: (filePaths: string[]) => Promise<{ success: boolean; files?: { success: boolean; data?: Buffer; path: string; error?: string; errorType?: string; errorCode?: string }[]; error?: string }>;
  readMediaMetadata: (args: { filePath: string }) => Promise<{ success: boolean; comment?: string; description?: string; title?: string; video?: VideoInfo | null; audio?: AudioInfo | null; error?: string }>;
  readVideoMetadata: (args: { filePath: string }) => Promise<{ success: boolean; comment?: string; description?: string; title?: string; video?: VideoInfo | null; audio?: AudioInfo | null; error?: string }>;
  getFileStats: (filePath: string) => Promise<{ success: boolean; stats?: any; error?: string }>;
  writeFile: (filePath: string, data: any) => Promise<{ success: boolean; error?: string }>;
  getEmbeddedMetadataBackupStatus: (args: { filePath: string }) => Promise<EmbeddedMetadataBackupStatus>;
  writeEmbeddedMetadata: (args: { filePath: string; payload: EmbeddedMetadataWritePayload; parameters?: string }) => Promise<{ success: boolean; format?: 'png' | 'jpeg' | 'webp'; backup?: EmbeddedMetadataBackupStatus; error?: string }>;
  restoreEmbeddedMetadataBackup: (args: { filePath: string }) => Promise<{ success: boolean; error?: string }>;
  exportBatchToFolder: (args: { files: { directoryPath: string; relativePath: string }[]; destDir: string; exportId?: string; metadataMode?: ExportMetadataMode }) => Promise<{ success: boolean; exportedCount: number; failedCount: number; error?: string }>;
  exportBatchToZip: (args: { files: { directoryPath: string; relativePath: string }[]; destZipPath: string; exportId?: string; metadataMode?: ExportMetadataMode }) => Promise<{ success: boolean; exportedCount: number; failedCount: number; error?: string }>;
  transferIndexedImages: (args: {
    files: { directoryPath: string; relativePath: string }[];
    destDir: string;
    mode: IndexedImageTransferMode;
    transferId?: string;
  }) => Promise<{
    success: boolean;
    transferred: IndexedImageTransferResultItem[];
    failedCount: number;
    error?: string;
  }>;
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  ensureDirectory: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
  getUserDataPath: () => Promise<string>;
  getSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<{ success: boolean; error?: string }>;
  launchGenerator: (payload: { command: string; workingDirectory?: string }) => Promise<{ success: boolean; error?: string; scriptPath?: string }>;
  openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
  getDefaultCachePath: () => Promise<{ success: boolean; path?: string; error?: string }>;
  getAppVersion: () => Promise<string>;
  joinPaths: (...paths: string[]) => Promise<{ success: boolean; path?: string; error?: string }>;
  joinPathsBatch: (args: { basePath: string; fileNames: string[] }) => Promise<{ success: boolean; paths?: string[]; error?: string }>;
  startFileDrag: (args: { directoryPath: string; relativePath: string }) => void;
  copyImageToClipboard: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  
  // --- Caching ---
  getCachedData: (cacheId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  getJsonCacheData: (cacheId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  getCacheChunk: (args: { cacheId: string; chunkIndex: number }) => Promise<{ success: boolean; data?: any; error?: string }>;
  getCacheSummary: (cacheId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  cacheData: (args: { cacheId: string; data: any }) => Promise<{ success: boolean; error?: string }>;
  writeJsonCacheData: (args: { cacheId: string; data: any }) => Promise<{ success: boolean; error?: string }>;
  prepareCacheWrite: (args: { cacheId: string }) => Promise<{ success: boolean; error?: string }>;
  writeCacheChunk: (args: { cacheId: string; chunkIndex: number; data: any }) => Promise<{ success: boolean; error?: string }>;
  finalizeCacheWrite: (args: { cacheId: string; record: any }) => Promise<{ success: boolean; error?: string }>;
  clearCacheData: (cacheId: string) => Promise<{ success: boolean; error?: string }>;
  getThumbnail: (thumbnailId: string) => Promise<{ success: boolean; data?: Buffer; error?: string }>;
  cacheThumbnail: (args: { thumbnailId: string; data: Uint8Array }) => Promise<{ success: boolean; error?: string; errorCode?: string }>;
  generateThumbnailFromPath: (args: { filePath: string; maxEdge?: number; quality?: number }) => Promise<{ success: boolean; data?: Buffer; error?: string }>;
  clearMetadataCache: () => Promise<{ success: boolean; error?: string }>;
  clearThumbnailCache: () => Promise<{ success: boolean; error?: string }>;
  deleteCacheFolder: () => Promise<{ success: boolean; needsRestart?: boolean; error?: string }>;
  restartApp: () => Promise<{ success: boolean; error?: string }>;

  onLoadDirectoryFromCLI: (callback: (dirPath: string) => void) => () => void;
  onMenuAddFolder: (callback: () => void) => () => void;
  onMenuOpenSettings: (callback: () => void) => () => void;
  onMenuToggleView: (callback: () => void) => () => void;
  onMenuShowChangelog: (callback: () => void) => () => void;
  testUpdateDialog?: () => Promise<{ success: boolean; response?: number; error?: string }>;
  getTheme: () => Promise<{ shouldUseDarkColors: boolean }>;
  onThemeUpdated: (callback: (theme: { shouldUseDarkColors: boolean }) => void) => () => void;
  toggleFullscreen: () => Promise<{ success: boolean; isFullscreen?: boolean; error?: string }>;
  onFullscreenChanged: (callback: (state: { isFullscreen: boolean }) => void) => () => void;
  onFullscreenStateCheck: (callback: (state: { isFullscreen: boolean }) => void) => () => void;
  onExportBatchProgress: (callback: (progress: ExportBatchProgress) => void) => () => void;
  onTransferIndexedImagesProgress: (callback: (progress: IndexedImageTransferProgress) => void) => () => void;

  // File watching
  startWatchingDirectory: (args: { directoryId: string; dirPath: string }) => Promise<{ success: boolean; error?: string }>;
  stopWatchingDirectory: (args: { directoryId: string }) => Promise<{ success: boolean }>;
  getWatcherStatus: (args: { directoryId: string }) => Promise<{ success: boolean; active: boolean }>;
  onNewImagesDetected: (callback: (data: { directoryId: string; files: Array<{ name: string; path: string; lastModified: number; contentModifiedMs?: number; size: number; type: string; forceReindex?: boolean }> }) => void) => () => void;
  onWatchedFilesRemoved: (callback: (data: WatchedFileRemovalPayload) => void) => () => void;
  onWatcherDebug: (callback: (data: { message: string }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export type InvokeAIMetadata = Omit<SharedInvokeAIMetadata, 'normalizedMetadata'> & {
  normalizedMetadata?: BaseMetadata;
};

export interface ShadowResource {
  id: string; // Unique ID for list management
  type: 'model' | 'lora' | 'embedding';
  name: string;
  weight?: number;
}

export interface ShadowMetadata {
  imageId: string; // Key, links to IndexedImage.id
  // Essentials
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  duration?: number;
  // Resources
  resources?: ShadowResource[];
  // Workflow
  notes?: string;
  updatedAt: number;
}

export type Automatic1111Metadata = Omit<SharedAutomatic1111Metadata, 'normalizedMetadata'> & {
  normalizedMetadata?: BaseMetadata;
};

export type ComfyUINode = SharedComfyUINode;

export type ComfyUIWorkflow = SharedComfyUIWorkflow;

export type ComfyUIPrompt = SharedComfyUIPrompt;

export type ComfyUIMetadata = Omit<SharedComfyUIMetadata, 'normalizedMetadata'> & {
  normalizedMetadata?: BaseMetadata;
};

export interface VideoMetadata {
  videometahub_data?: any;
  description?: string;
  comment?: string;
  title?: string;
  normalizedMetadata?: BaseMetadata;
  [key: string]: any;
}

export type SwarmUIMetadata = Omit<SharedSwarmUIMetadata, 'normalizedMetadata'> & {
  normalizedMetadata?: BaseMetadata;
};

export type EasyDiffusionMetadata = SharedEasyDiffusionMetadata;

export type EasyDiffusionJson = SharedEasyDiffusionJson;

export type MidjourneyMetadata = SharedMidjourneyMetadata;

export type NijiMetadata = SharedNijiMetadata;

export type ForgeMetadata = SharedForgeMetadata;

export type DalleMetadata = SharedDalleMetadata;

export type DreamStudioMetadata = SharedDreamStudioMetadata;

export type FireflyMetadata = SharedFireflyMetadata;

export type DrawThingsMetadata = Omit<SharedDrawThingsMetadata, 'normalizedMetadata'> & {
  normalizedMetadata?: BaseMetadata;
};

export type FooocusMetadata = SharedFooocusMetadata;

export type SDNextMetadata = SharedSDNextMetadata;

// Union type for all supported metadata formats
export type ImageMetadata =
  | InvokeAIMetadata
  | Automatic1111Metadata
  | ComfyUIMetadata
  | SwarmUIMetadata
  | EasyDiffusionMetadata
  | EasyDiffusionJson
  | MidjourneyMetadata
  | NijiMetadata
  | ForgeMetadata
  | DalleMetadata
  | DreamStudioMetadata
  | FireflyMetadata
  | DrawThingsMetadata
  | FooocusMetadata
  | SDNextMetadata
  | VideoMetadata;

// LoRA interface for detailed LoRA information
export type LoRAInfo = SharedLoRAInfo;

// Base normalized metadata interface for unified access
export interface VideoInfo {
  frame_rate?: number | null;
  frame_count?: number | null;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
  format?: string | null;
  codec?: string | null;
}

export interface AudioInfo {
  duration_seconds?: number | null;
  codec?: string | null;
  format?: string | null;
  sample_rate?: number | null;
  channels?: number | null;
  bit_rate?: number | null;
}

export interface MotionModelInfo {
  name?: string | null;
  hash?: string | null;
}

export type GenerationType = 'txt2img' | 'img2img' | 'inpaint' | 'outpaint';

export interface SourceImageReference {
  fileName?: string | null;
  relativePath?: string | null;
  absolutePath?: string | null;
  sha256?: string | null;
  width?: number | null;
  height?: number | null;
  nodeId?: string | null;
  nodeType?: string | null;
}

export interface ImageLineage {
  detection?: 'explicit' | 'inferred';
  sourceImage?: SourceImageReference | null;
  workflowSourceImage?: SourceImageReference | null;
  denoiseStrength?: number | null;
  maskBlur?: number | null;
  maskedContent?: string | null;
  resizeMode?: string | null;
}

export interface BaseMetadata extends SharedBaseMetadata {
  clip_skip?: number;
  media_type?: 'image' | 'video' | 'audio';
  video?: VideoInfo | null;
  audio?: AudioInfo | null;
  motion_model?: MotionModelInfo | null;
  generationType?: GenerationType;
  lineage?: ImageLineage | null;
  tags?: string[];
  notes?: string;
  analytics?: {
    vram_peak_mb?: number | null;
    gpu_device?: string | null;
    generation_time_ms?: number | null;
    steps_per_second?: number | null;
    comfyui_version?: string | null;
    torch_version?: string | null;
    python_version?: string | null;
    generation_time?: number | null;
  };
}

// Type guard functions
export const isInvokeAIMetadata = (metadata: ImageMetadata): metadata is InvokeAIMetadata =>
  sharedCoreTypes.isInvokeAIMetadata(metadata as SharedImageMetadata);

export const isSwarmUIMetadata = (metadata: ImageMetadata): metadata is SwarmUIMetadata =>
  sharedCoreTypes.isSwarmUIMetadata(metadata as SharedImageMetadata);

export const isEasyDiffusionMetadata = (metadata: ImageMetadata): metadata is EasyDiffusionMetadata =>
  sharedCoreTypes.isEasyDiffusionMetadata(metadata as SharedImageMetadata);

export const isEasyDiffusionJson = (metadata: ImageMetadata): metadata is EasyDiffusionJson =>
  sharedCoreTypes.isEasyDiffusionJson(metadata as SharedImageMetadata);

export const isMidjourneyMetadata = (metadata: ImageMetadata): metadata is MidjourneyMetadata =>
  sharedCoreTypes.isMidjourneyMetadata(metadata as SharedImageMetadata);

export const isNijiMetadata = (metadata: ImageMetadata): metadata is NijiMetadata =>
  sharedCoreTypes.isNijiMetadata(metadata as SharedImageMetadata);

export const isForgeMetadata = (metadata: ImageMetadata): metadata is ForgeMetadata =>
  sharedCoreTypes.isForgeMetadata(metadata as SharedImageMetadata);

export const isDalleMetadata = (metadata: ImageMetadata): metadata is DalleMetadata =>
  sharedCoreTypes.isDalleMetadata(metadata as SharedImageMetadata);

export const isFireflyMetadata = (metadata: ImageMetadata): metadata is FireflyMetadata =>
  sharedCoreTypes.isFireflyMetadata(metadata as SharedImageMetadata);

export const isDrawThingsMetadata = (metadata: ImageMetadata): metadata is DrawThingsMetadata =>
  sharedCoreTypes.isDrawThingsMetadata(metadata as SharedImageMetadata);

export const isDreamStudioMetadata = (metadata: ImageMetadata): metadata is DreamStudioMetadata =>
  sharedCoreTypes.isDreamStudioMetadata(metadata as SharedImageMetadata);

export const isAutomatic1111Metadata = (metadata: ImageMetadata): metadata is Automatic1111Metadata =>
  sharedCoreTypes.isAutomatic1111Metadata(metadata as SharedImageMetadata);

export const isComfyUIMetadata = (metadata: ImageMetadata): metadata is ComfyUIMetadata =>
  sharedCoreTypes.isComfyUIMetadata(metadata as SharedImageMetadata);

export type ThumbnailStatus = SharedThumbnailStatus;
export type ImageRating = SharedImageRating;

export interface NumericRangeFilter {
  min?: number | null;
  max?: number | null;
  maxExclusive?: boolean;
}

export interface DateRangeFilter {
  from?: string;
  to?: string;
}

export interface AdvancedFilters {
  dimension?: string;
  steps?: NumericRangeFilter;
  cfg?: NumericRangeFilter;
  date?: DateRangeFilter;
  generationModes?: Array<'txt2img' | 'img2img'>;
  mediaTypes?: Array<'image' | 'video' | 'audio'>;
  telemetryState?: 'present' | 'missing';
  hasVerifiedTelemetry?: boolean;
  generationTimeMs?: NumericRangeFilter;
  stepsPerSecond?: NumericRangeFilter;
  vramPeakMb?: NumericRangeFilter;
}

export interface SelectedFiltersUpdate {
  models?: string[];
  excludedModels?: string[];
  loras?: string[];
  excludedLoras?: string[];
  samplers?: string[];
  excludedSamplers?: string[];
  schedulers?: string[];
  excludedSchedulers?: string[];
  generators?: string[];
  excludedGenerators?: string[];
  gpuDevices?: string[];
  excludedGpuDevices?: string[];
}

export type AutomationRuleMatchMode = 'all' | 'any';
export type AutomationTextField = 'prompt' | 'negativePrompt' | 'filename' | 'metadata' | 'search';
export type AutomationTextOperator = 'contains' | 'not_contains' | 'equals' | 'not_equals';
export type AutomationConditionField =
  | AutomationTextField
  | 'model'
  | 'lora'
  | 'sampler'
  | 'scheduler'
  | 'generator'
  | 'gpu'
  | 'tag'
  | 'autoTag'
  | 'dimension'
  | 'favorite'
  | 'rating'
  | 'steps'
  | 'cfg'
  | 'telemetry'
  | 'verifiedTelemetry';
export type AutomationConditionOperator =
  | AutomationTextOperator
  | 'includes'
  | 'not_includes'
  | 'is'
  | 'is_not'
  | 'at_least'
  | 'at_most'
  | 'between';

export interface AutomationTextCondition {
  id: string;
  field: AutomationTextField;
  operator: AutomationTextOperator;
  value: string;
}

export interface AutomationConditionRow {
  id: string;
  field: AutomationConditionField;
  operator: AutomationConditionOperator;
  value: string;
  valueEnd?: string;
  groupMode?: AutomationRuleMatchMode;
}

export interface AutomationRuleFilterCriteria extends SelectedFiltersUpdate {
  searchQuery?: string;
  tags?: string[];
  excludedTags?: string[];
  tagMatchMode?: TagMatchMode;
  autoTags?: string[];
  excludedAutoTags?: string[];
  favoriteFilterMode?: InclusionFilterMode;
  ratings?: ImageRating[];
  advancedFilters?: AdvancedFilters;
}

export interface AutomationRuleCriteria {
  matchMode: AutomationRuleMatchMode;
  textConditions: AutomationTextCondition[];
  conditionRows?: AutomationConditionRow[];
  filters: AutomationRuleFilterCriteria;
}

export interface AutomationRuleAction {
  addTags: string[];
  addToCollectionIds: string[];
}

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  criteria: AutomationRuleCriteria;
  actions: AutomationRuleAction;
  runOnNewImages: boolean;
  createdAt: number;
  updatedAt: number;
  lastAppliedAt?: number | null;
  lastMatchCount?: number;
  lastChangeCount?: number;
}

export interface IndexedImage {
  id: string; // Unique ID, e.g., file path
  name: string;
  handle: FileSystemFileHandle;
  thumbnailHandle?: FileSystemFileHandle; // Handle to .webp thumbnail
  thumbnailUrl?: string; // Blob URL for thumbnail
  thumbnailStatus?: ThumbnailStatus;
  thumbnailError?: string | null;
  metadata: ImageMetadata;
  metadataString: string; // For faster searching
  lastModified: number; // File's last modified date
  contentModifiedMs?: number; // Real file content modification timestamp for cache diffing
  models: string[]; // Extracted models from metadata
  loras: (string | LoRAInfo)[]; // Extracted LoRAs from metadata
  sampler?: string; // Extracted sampler from metadata
  scheduler: string; // Extracted scheduler from metadata
  board?: string; // Extracted board name from metadata
  prompt?: string; // Extracted prompt from metadata
  negativePrompt?: string; // Extracted negative prompt from metadata
  cfgScale?: number; // Extracted CFG scale from metadata
  steps?: number; // Extracted steps from metadata
  seed?: number; // Extracted seed from metadata
  dimensions?: string; // Extracted dimensions (width x height) from metadata
  workflowNodes?: string[]; // Extracted ComfyUI workflow node types
  directoryName?: string; // Name of the selected directory for context
  directoryId?: string; // Unique ID for the parent directory
  enrichmentState?: 'catalog' | 'enriched';
  fileSize?: number;
  fileType?: string;

  // User Annotations (loaded from ImageAnnotations table)
  isFavorite?: boolean;          // Quick access to favorite status
  tags?: string[];               // Quick access to tags array
  rating?: ImageRating;          // Optional 1-5 user rating

  // Smart Clustering & Auto-Tagging (Phase 1)
  clusterId?: string;            // Cluster this image belongs to
  clusterPosition?: number;      // Position within cluster (0 = cover image)
  autoTags?: string[];           // Auto-generated tags from TF-IDF
  autoTagsGeneratedAt?: number;  // Timestamp of tag generation
}

/**
 * User annotations for an image (favorites, tags, notes)
 * Stored separately from image metadata in IndexedDB
 */
export interface ImageAnnotations {
  imageId: string;              // Links to IndexedImage.id (unique)
  isFavorite: boolean;           // Star/Favorite flag
  tags: string[];                // User-defined tags (lowercase normalized)
  rating?: ImageRating;          // Optional 1-5 user rating
  addedAt: number;               // Timestamp when first annotated
  updatedAt: number;             // Timestamp of last update
}

/**
 * Tag with usage statistics
 */
export interface TagInfo {
  name: string;                  // Tag name (lowercase)
  count: number;                 // Number of images with this tag
}

export type InclusionFilterMode = 'neutral' | 'include' | 'exclude';
export type TagMatchMode = 'any' | 'all';

export interface Directory {
  id: string; // A unique identifier for the directory (e.g., a UUID or a hash of the path)
  name: string;
  path: string;
  handle: FileSystemDirectoryHandle;
  visible?: boolean; // Whether images from this directory should be shown (default: true)
  autoWatch?: boolean; // Whether to automatically watch this directory for new images (default: false)
}

export interface FilterOptions {
  models: string[];
  loras: string[];
  samplers: string[];
  schedulers: string[];
  generators: string[];
  gpuDevices: string[];
  dimensions: string[];
  selectedModel: string;
  selectedLora: string;
  selectedSampler: string;
  selectedScheduler: string;
}

export interface Keymap {
  version: string;
  [scope: string]: {
    [action: string]: string;
  } | string;
}

// File System Access API - extended Window interface
declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }
}

// Image Comparison Types
export interface ComparisonState {
  images: IndexedImage[];
  isModalOpen: boolean;
}

export interface ZoomState {
  zoom: number;
  x: number;
  y: number;
}

export type ComparisonViewMode = 'side-by-side' | 'slider' | 'hover';
export type ComparisonLayoutMode = 'strip' | 'grid';

export interface ComparisonPaneProps {
  image: IndexedImage;
  directoryPath: string;
  syncEnabled: boolean;
  externalZoom?: ZoomState;
  onZoomChange?: (zoom: number, x: number, y: number) => void;
  className?: string;
  imageLabel?: string;
}

export interface ComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface ComparisonMetadataPanelProps {
  image: IndexedImage;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  viewMode?: 'standard' | 'diff';
  otherImageMetadata?: BaseMetadata | null;
  className?: string;
  compareLabel?: string;
}

// ===== Smart Clustering & Auto-Tagging Types =====

/**
 * Image cluster - groups images with similar prompts
 */
export interface ImageCluster {
  id: string;                      // Hash-based cluster ID
  promptHash: string;              // Hash of the base prompt
  basePrompt: string;              // Representative prompt text
  imageIds: string[];              // Array of image IDs in this cluster
  coverImageId: string;            // First image chronologically
  size: number;                    // Number of images in cluster
  similarityThreshold: number;     // Threshold used for clustering (0.85-0.90)
  createdAt: number;               // Timestamp of cluster creation
  updatedAt: number;               // Timestamp of last update
}

/**
 * Auto-generated tag from TF-IDF analysis
 */
export interface AutoTag {
  tag: string;                     // Tag name (e.g., "cyberpunk")
  tfidfScore: number;              // TF-IDF score
  frequency: number;               // Term frequency across corpus
  sourceType: 'prompt' | 'metadata';  // Origin of tag
}

export type LegacySmartCollectionType = 'model' | 'style' | 'subject' | 'custom';

/**
 * Query criteria for legacy smart collections.
 * Kept optional for backward-compatible loading of older records.
 */
export interface SmartCollectionQuery {
  models?: string[];
  autoTags?: string[];
  userTags?: string[];
  clusters?: string[];
  dateRange?: { from: number; to: number };
}

export type CollectionKind = 'manual' | 'tag_rule';

/**
 * Persisted collection record used by the Collections view.
 */
export interface SmartCollection {
  id: string;                      // Unique collection ID
  kind: CollectionKind;            // Manual or tag-driven collection
  name: string;                    // Display name
  description?: string;
  coverImageId?: string | null;    // Explicit cover image
  sortIndex: number;               // Manual ordering in the sidebar
  sourceTag?: string | null;       // Tag source for tag_rule collections
  autoUpdate?: boolean;            // Live tag membership toggle
  imageIds?: string[];             // Explicit membership for manual collections
  snapshotImageIds?: string[];     // Frozen membership for tag_rule collections
  excludedImageIds?: string[];     // User-removed images from live tag_rule collections
  imageCount: number;              // Cached count for list rendering
  thumbnailId?: string;            // Legacy alias for cover image
  createdAt: number;
  updatedAt: number;

  // Legacy fields kept optional for backward-compatible loading.
  type?: LegacySmartCollectionType;
  query?: SmartCollectionQuery;
}

/**
 * User preferences for a specific cluster (stored in IndexedDB)
 */
export interface ClusterPreference {
  clusterId: string;               // Primary key
  bestImageIds: string[];          // User-marked best images
  archivedImageIds: string[];      // Suggested for deletion
  isExpanded: boolean;             // UI state persistence
  notes?: string;                  // User notes about cluster
  updatedAt: number;
}

/**
 * UI state for stack view
 */
export interface StackViewState {
  expandedClusterId: string | null;  // Currently expanded stack
  hoverClusterId: string | null;     // Stack being hovered
  scrubPosition: number;             // 0-1 for hover preview
}

/**
 * TF-IDF model for auto-tagging
 */
export interface TFIDFModel {
  vocabulary: string[];                // All unique terms
  idfScores: Map<string, number>;      // Term → IDF score
  documentCount: number;               // Total documents processed
}

/**
 * Stack of images grouped by similar prompt
 */
export interface ImageStack {
  id: string;                      // Unique stack ID (e.g. "stack-" + coverImage.id)
  coverImage: IndexedImage;        // The representative image (first in group)
  images: IndexedImage[];          // All images in this stack
  count: number;                   // Total number of images in stack
}

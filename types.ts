export interface ElectronAPI {
  trashFile: (filename: string) => Promise<{ success: boolean; error?: string }>;
  renameFile: (oldName: string, newName: string) => Promise<{ success: boolean; error?: string }>;
  setCurrentDirectory: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
  updateAllowedPaths: (paths: string[]) => Promise<{ success: boolean; error?: string }>;
  showDirectoryDialog: () => Promise<{ success: boolean; path?: string; name?: string; canceled?: boolean; error?: string }>;
  showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  listSubfolders: (folderPath: string) => Promise<{ success: boolean; subfolders?: { name: string; path: string }[]; error?: string }>;
  listDirectoryFiles: (args: { dirPath: string; recursive?: boolean }) => Promise<{
    success: boolean;
    files?: { name: string; lastModified: number; size: number; type: string; birthtimeMs?: number }[];
    error?: string;
  }>;
  readFile: (filePath: string) => Promise<{ success: boolean; data?: Buffer; error?: string }>;
  readFilesBatch: (filePaths: string[]) => Promise<{ success: boolean; files?: { success: boolean; data?: Buffer; path: string; error?: string }[]; error?: string }>;
  getFileStats: (filePath: string) => Promise<{ success: boolean; stats?: any; error?: string }>;
  writeFile: (filePath: string, data: any) => Promise<{ success: boolean; error?: string }>;
  getSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<{ success: boolean; error?: string }>;
  getDefaultCachePath: () => Promise<{ success: boolean; path?: string; error?: string }>;
  getAppVersion: () => Promise<string>;
  joinPaths: (...paths: string[]) => Promise<{ success: boolean; path?: string; error?: string }>;
  
  // --- Caching ---
  getCachedData: (cacheId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  getCacheChunk: (args: { cacheId: string; chunkIndex: number }) => Promise<{ success: boolean; data?: any; error?: string }>;
  getCacheSummary: (cacheId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  cacheData: (args: { cacheId: string; data: any }) => Promise<{ success: boolean; error?: string }>;
  prepareCacheWrite: (args: { cacheId: string }) => Promise<{ success: boolean; error?: string }>;
  writeCacheChunk: (args: { cacheId: string; chunkIndex: number; data: any }) => Promise<{ success: boolean; error?: string }>;
  finalizeCacheWrite: (args: { cacheId: string; record: any }) => Promise<{ success: boolean; error?: string }>;
  clearCacheData: (cacheId: string) => Promise<{ success: boolean; error?: string }>;
  getThumbnail: (thumbnailId: string) => Promise<{ success: boolean; data?: Buffer; error?: string }>;
  cacheThumbnail: (args: { thumbnailId: string; data: Uint8Array }) => Promise<{ success: boolean; error?: string }>;
  clearMetadataCache: () => Promise<{ success: boolean; error?: string }>;
  clearThumbnailCache: () => Promise<{ success: boolean; error?: string }>;

  onLoadDirectoryFromCLI: (callback: (dirPath: string) => void) => () => void;
  onMenuAddFolder: (callback: () => void) => () => void;
  onMenuOpenSettings: (callback: () => void) => () => void;
  onMenuToggleView: (callback: () => void) => () => void;
  onMenuShowChangelog: (callback: () => void) => () => void;
  testUpdateDialog: () => Promise<{ success: boolean; response?: number; error?: string }>;
  getTheme: () => Promise<{ shouldUseDarkColors: boolean }>;
  onThemeUpdated: (callback: (theme: { shouldUseDarkColors: boolean }) => void) => () => void;
  toggleFullscreen: () => Promise<{ success: boolean; isFullscreen?: boolean; error?: string }>;
  onFullscreenChanged: (callback: (state: { isFullscreen: boolean }) => void) => () => void;
  onFullscreenStateCheck: (callback: (state: { isFullscreen: boolean }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export interface InvokeAIMetadata {
  // Core generation fields
  positive_prompt?: string;
  negative_prompt?: string;
  generation_mode?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfg_scale?: number;
  cfg_rescale_multiplier?: number;
  scheduler?: string;
  seamless_x?: boolean;
  seamless_y?: boolean;
  model?: string;
  vae?: string;
  rand_device?: string;

  // UI and organization fields
  board_id?: string;
  board_name?: string;
  ref_images?: any[];

  // App metadata
  app_version?: string;

  // Legacy field (might still be present in some versions)
  prompt?: string | { prompt: string }[];

  // Additional fields
  normalizedMetadata?: BaseMetadata;
  [key: string]: any;
}

export interface Automatic1111Metadata {
  parameters: string; // Formatted string containing all generation parameters
  // Additional fields that might be present
  normalizedMetadata?: BaseMetadata;
  [key: string]: any;
}

export interface ComfyUINode {
  id: number;
  type: string;
  title?: string;
  pos: [number, number];
  size?: { 0: number; 1: number };
  flags?: any;
  order?: number;
  mode?: number;
  inputs?: Record<string, any>;
  outputs?: any[];
  properties?: Record<string, any>;
  widgets_values?: any[];
  color?: string;
  bgcolor?: string;
}

export interface ComfyUIWorkflow {
  last_node_id: number;
  last_link_id: number;
  nodes: ComfyUINode[];
  links?: any[];
  groups?: any[];
  config?: any;
  extra?: any;
  version?: number;
}

export interface ComfyUIPrompt {
  [nodeId: string]: {
    inputs: Record<string, any>;
    class_type: string;
    _meta?: {
      title?: string;
    };
  };
}

export interface ComfyUIMetadata {
  workflow?: ComfyUIWorkflow | string;
  parameters?: string // Can be object or JSON string
  prompt?: ComfyUIPrompt | string; // Can be object or JSON string
  // Additional fields that might be present
  normalizedMetadata?: BaseMetadata;
  [key: string]: any;
}

export interface SwarmUIMetadata {
  sui_image_params?: {
    prompt?: string;
    negativeprompt?: string;
    model?: string;
    images?: number;
    seed?: number;
    steps?: number;
    cfgscale?: number;
    aspectratio?: string;
    width?: number;
    height?: number;
    sidelength?: number;
    sampler?: string;
    scheduler?: string;
    automaticvae?: boolean;
    loras?: string[];
    loraweights?: string[];
    swarm_version?: string;
    date?: string;
    generation_time?: string;
    [key: string]: any;
  };
  sui_extra_data?: any;
  // Additional fields that might be present
  normalizedMetadata?: BaseMetadata;
  [key: string]: any;
}

export interface EasyDiffusionMetadata {
  parameters: string; // Easy Diffusion uses same format as A1111: "Prompt: ...\nNegative prompt: ...\nSteps: ..."
  // Additional fields that might be present
  [key: string]: any;
}

export interface EasyDiffusionJson {
  prompt?: string;
  negative_prompt?: string;
  steps?: number;
  cfg_scale?: number;
  sampler?: string;
  seed?: number;
  model?: string;
  width?: number;
  height?: number;
  // Additional fields that might be present in Easy Diffusion JSON
  [key: string]: any;
}

export interface MidjourneyMetadata {
  parameters: string; // Midjourney uses format like: "prompt --v 5 --ar 16:9" or "Prompt: prompt text --v 5"
  // Additional fields that might be present
  [key: string]: any;
}

export interface NijiMetadata {
  parameters: string; // Niji Journey uses format like: "prompt --niji --v 5 --ar 16:9" or "Prompt: prompt text --niji 5"
  niji_version?: number; // Niji version (5, 6, etc.)
  // Additional fields that might be present
  [key: string]: any;
}

export interface ForgeMetadata {
  parameters: string; // Forge uses same format as A1111: "Prompt: ...\nNegative prompt: ...\nSteps: ..."
  // Additional fields that might be present
  [key: string]: any;
}

export interface DalleMetadata {
  // C2PA/EXIF embedded metadata for DALL-E 3 images
  c2pa_manifest?: any; // C2PA manifest data
  exif_data?: any; // EXIF metadata
  prompt?: string; // Original user prompt
  revised_prompt?: string; // DALL-E's revised/enhanced prompt
  model_version?: string; // DALL-E model version (e.g., "dall-e-3")
  generation_date?: string; // ISO date string of generation
  ai_tags?: string[]; // AI-generated content tags
  // Additional fields that might be present
  [key: string]: any;
}

export interface DreamStudioMetadata {
  parameters: string; // DreamStudio uses A1111-like format: "Prompt: ...\nNegative prompt: ...\nSteps: ..."
  // Additional fields that might be present
  [key: string]: any;
}

export interface FireflyMetadata {
  // C2PA/EXIF embedded metadata for Adobe Firefly images
  c2pa_manifest?: any; // C2PA manifest data with actions and content credentials
  exif_data?: any; // EXIF metadata
  prompt?: string; // Original user prompt
  edit_history?: any[]; // Array of edit actions from C2PA
  firefly_version?: string; // Adobe Firefly model version
  generation_params?: any; // Generation parameters (style, size, etc.)
  ai_generated?: boolean; // AI generated content flag
  content_credentials?: any; // Content Credentials data
  // Additional fields that might be present
  [key: string]: any;
}

export interface DrawThingsMetadata {
  parameters: string; // Draw Things uses SD-like format: "Prompt: ...\nNegative prompt: ...\nSteps: ..."
  userComment?: string; // JSON metadata from EXIF UserComment field
  // Additional fields that might be present
  normalizedMetadata?: BaseMetadata;
  [key: string]: any;
}

export interface FooocusMetadata {
  parameters: string; // Fooocus uses SD-like format with Flux backend support
  // Additional fields that might be present
  [key: string]: any;
}

export interface SDNextMetadata {
  parameters: string; // SD.Next uses A1111-like format with additional SD.Next specific fields
  // Additional fields that might be present
  [key: string]: any;
}

// Union type for all supported metadata formats
export type ImageMetadata = InvokeAIMetadata | Automatic1111Metadata | ComfyUIMetadata | SwarmUIMetadata | EasyDiffusionMetadata | EasyDiffusionJson | MidjourneyMetadata | NijiMetadata | ForgeMetadata | DalleMetadata | DreamStudioMetadata | FireflyMetadata | DrawThingsMetadata | FooocusMetadata | SDNextMetadata;

// Base normalized metadata interface for unified access
export interface BaseMetadata {
  prompt: string;
  negativePrompt?: string;
  model: string;
  models?: string[];
  width: number;
  height: number;
  seed?: number;
  steps: number;
  cfg_scale?: number;
  scheduler: string;
  sampler?: string;
  loras?: string[];
  generator?: string; // Name of the AI generator/parser used
  version?: string;
  module?: string;
  // Additional normalized fields
  [key: string]: any;
}

// Type guard functions
export function isInvokeAIMetadata(metadata: ImageMetadata): metadata is InvokeAIMetadata {
  // More permissive detection - check for common InvokeAI fields
  const hasInvokeAIFields = ('positive_prompt' in metadata) ||
                           ('negative_prompt' in metadata) ||
                           ('generation_mode' in metadata) ||
                           ('app_version' in metadata) ||
                           ('model_name' in metadata) ||
                           ('cfg_scale' in metadata) ||
                           ('scheduler' in metadata);

  // Also check for legacy prompt field with generation parameters
  const hasLegacyFields = ('prompt' in metadata) &&
                         (('model' in metadata) || ('width' in metadata) || ('height' in metadata) || ('steps' in metadata));

  // Check if it has InvokeAI-specific structure (not ComfyUI or A1111)
  const notComfyUI = !('workflow' in metadata) && !('prompt' in metadata && typeof metadata.prompt === 'object');
  const notA1111 = !('parameters' in metadata && typeof metadata.parameters === 'string');

  return (hasInvokeAIFields || hasLegacyFields) && notComfyUI && notA1111;
}

export function isSwarmUIMetadata(metadata: ImageMetadata): metadata is SwarmUIMetadata {
  // Check for direct SwarmUI metadata at root level
  if ('sui_image_params' in metadata && typeof metadata.sui_image_params === 'object') {
    return true;
  }

  // Check for SwarmUI metadata wrapped in parameters string (some SwarmUI images are saved this way)
  if ('parameters' in metadata && typeof metadata.parameters === 'string') {
    try {
      const parsedParams = JSON.parse(metadata.parameters);
      return 'sui_image_params' in parsedParams && typeof parsedParams.sui_image_params === 'object';
    } catch {
      // Not valid JSON, not SwarmUI
      return false;
    }
  }

  return false;
}

export function isEasyDiffusionMetadata(metadata: ImageMetadata): metadata is EasyDiffusionMetadata {
  return 'parameters' in metadata && 
         typeof metadata.parameters === 'string' && 
         metadata.parameters.includes('Prompt:') && 
         !('sui_image_params' in metadata) && 
         !metadata.parameters.includes('Model hash:'); // Distinguish from A1111
}

export function isEasyDiffusionJson(metadata: ImageMetadata): metadata is EasyDiffusionJson {
  return 'prompt' in metadata && typeof metadata.prompt === 'string' && !('parameters' in metadata);
}

export function isMidjourneyMetadata(metadata: ImageMetadata): metadata is MidjourneyMetadata {
  return 'parameters' in metadata && 
         typeof metadata.parameters === 'string' && 
         (metadata.parameters.includes('Midjourney') || 
          metadata.parameters.includes('--v') || 
          metadata.parameters.includes('--ar') ||
          metadata.parameters.includes('--q') ||
          metadata.parameters.includes('--s'));
}

export function isNijiMetadata(metadata: ImageMetadata): metadata is NijiMetadata {
  return 'parameters' in metadata && 
         typeof metadata.parameters === 'string' && 
         metadata.parameters.includes('--niji');
}

export function isForgeMetadata(metadata: ImageMetadata): metadata is ForgeMetadata {
  return 'parameters' in metadata && 
         typeof metadata.parameters === 'string' && 
         (metadata.parameters.includes('Forge') || 
          metadata.parameters.includes('Gradio') ||
          (metadata.parameters.includes('Steps:') && 
           metadata.parameters.includes('Sampler:') && 
           metadata.parameters.includes('Model hash:'))); // Similar to A1111 but with Forge/Gradio indicators
}

export function isDalleMetadata(metadata: ImageMetadata): metadata is DalleMetadata {
  // Check for C2PA manifest (primary indicator)
  if ('c2pa_manifest' in metadata) {
    return true;
  }

  // Check for OpenAI/DALL-E specific EXIF data
  if ('exif_data' in metadata && typeof metadata.exif_data === 'object') {
    const exif = metadata.exif_data as any;
    // Look for OpenAI/DALL-E indicators in EXIF
    if (exif['openai:dalle'] || exif['Software']?.includes('DALL-E') || exif['Software']?.includes('OpenAI')) {
      return true;
    }
  }

  // Check for DALL-E specific fields
  if ('prompt' in metadata && 'model_version' in metadata && 
      (metadata.model_version?.includes('dall-e') || metadata.model_version?.includes('DALL-E'))) {
    return true;
  }

  return false;
}

export function isFireflyMetadata(metadata: ImageMetadata): metadata is FireflyMetadata {
  // Check for C2PA manifest with Firefly indicators
  if ('c2pa_manifest' in metadata) {
    const manifest = metadata.c2pa_manifest as any;
    // Check for Adobe Firefly specific indicators
    if (manifest?.['adobe:firefly'] || 
        (typeof manifest === 'string' && manifest.includes('adobe:firefly'))) {
      return true;
    }
    // Check c2pa.actions for Firefly signatures
    if (manifest?.['c2pa.actions']) {
      const actions = JSON.stringify(manifest['c2pa.actions']);
      if (actions.includes('firefly') || actions.includes('adobe.com/firefly')) {
        return true;
      }
    }
  }

  // Check for Adobe Firefly specific EXIF data
  if ('exif_data' in metadata && typeof metadata.exif_data === 'object') {
    const exif = metadata.exif_data as any;
    if (exif['adobe:firefly'] || exif['Software']?.includes('Firefly') || exif['Software']?.includes('Adobe Firefly')) {
      return true;
    }
  }

  // Check for Firefly specific fields
  if ('firefly_version' in metadata || 'ai_generated' in metadata) {
    return true;
  }

  return false;
}

export function isDrawThingsMetadata(metadata: ImageMetadata): metadata is DrawThingsMetadata {
  return 'parameters' in metadata && 
         typeof metadata.parameters === 'string' && 
         (metadata.parameters.includes('Draw Things') || 
          metadata.parameters.includes('iPhone') || 
          metadata.parameters.includes('iPad') ||
          (metadata.parameters.includes('Prompt:') && 
           metadata.parameters.includes('Steps:') && 
           metadata.parameters.includes('Seed:') &&
           !metadata.parameters.includes('Model hash:') && // Exclude A1111
           !metadata.parameters.includes('Forge') && // Exclude Forge
           !metadata.parameters.includes('Gradio') && // Exclude Forge
           !metadata.parameters.includes('DreamStudio') && // Exclude DreamStudio
           !metadata.parameters.includes('Stability AI') && // Exclude DreamStudio
           !metadata.parameters.includes('--niji') && // Exclude Niji Journey
           !metadata.parameters.includes('Midjourney'))); // Exclude Midjourney
}

export function isDreamStudioMetadata(metadata: ImageMetadata): metadata is DreamStudioMetadata {
  return 'parameters' in metadata && 
         typeof metadata.parameters === 'string' && 
         (metadata.parameters.includes('DreamStudio') || 
          metadata.parameters.includes('Stability AI') ||
          (metadata.parameters.includes('Prompt:') && 
           metadata.parameters.includes('Steps:') && 
           !metadata.parameters.includes('Model hash:') && // Exclude A1111
           !metadata.parameters.includes('Forge') && // Exclude Forge
           !metadata.parameters.includes('Gradio'))); // Exclude Forge
}

export function isAutomatic1111Metadata(metadata: ImageMetadata): metadata is Automatic1111Metadata {
  if (!('parameters' in metadata) || typeof metadata.parameters !== 'string') {
    return false;
  }

  // Exclude SwarmUI metadata (even when wrapped in parameters string)
  if (metadata.parameters.includes('sui_image_params')) {
    return false;
  }

  return true;
}

export function isComfyUIMetadata(metadata: ImageMetadata): metadata is ComfyUIMetadata {
  // The presence of a 'workflow' property is the most reliable and unique indicator for ComfyUI.
  // This check is intentionally lenient, trusting the dedicated parser to handle the details.
  // An overly strict type guard was the cause of previous parsing failures.
  if ('workflow' in metadata && (typeof metadata.workflow === 'object' || typeof metadata.workflow === 'string')) {
    return true;
  }

  // As a fallback, check for the API-style 'prompt' object. This format, where keys are
  // node IDs, is also unique to ComfyUI and distinct from other formats.
  if ('prompt' in metadata && typeof metadata.prompt === 'object' && metadata.prompt !== null && !Array.isArray(metadata.prompt)) {
    // A minimal structural check to ensure it's not just a random object.
    // It should contain values that look like ComfyUI nodes.
    return Object.values(metadata.prompt).some(
      (node: any) => node && typeof node === 'object' && 'class_type' in node && 'inputs' in node
    );
  }

  return false;
}

export type ThumbnailStatus = 'pending' | 'loading' | 'ready' | 'error';

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
  models: string[]; // Extracted models from metadata
  loras: string[]; // Extracted LoRAs from metadata
  scheduler: string; // Extracted scheduler from metadata
  board?: string; // Extracted board name from metadata
  prompt?: string; // Extracted prompt from metadata
  negativePrompt?: string; // Extracted negative prompt from metadata
  cfgScale?: number; // Extracted CFG scale from metadata
  steps?: number; // Extracted steps from metadata
  seed?: number; // Extracted seed from metadata
  dimensions?: string; // Extracted dimensions (width x height) from metadata
  directoryName?: string; // Name of the selected directory for context
  directoryId?: string; // Unique ID for the parent directory
  enrichmentState?: 'catalog' | 'enriched';
  fileSize?: number;
  fileType?: string;
}

export interface Directory {
  id: string; // A unique identifier for the directory (e.g., a UUID or a hash of the path)
  name: string;
  path: string;
  handle: FileSystemDirectoryHandle;
  visible?: boolean; // Whether images from this directory should be shown (default: true)
}

export interface FilterOptions {
  models: string[];
  loras: string[];
  schedulers:string[];
  selectedModel: string;
  selectedLora: string;
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

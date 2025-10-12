export interface ElectronAPI {
  trashFile: (filename: string) => Promise<{ success: boolean; error?: string }>;
  renameFile: (oldName: string, newName: string) => Promise<{ success: boolean; error?: string }>;
  setCurrentDirectory: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
  updateAllowedPaths: (paths: string[]) => Promise<{ success: boolean; error?: string }>;
  showDirectoryDialog: () => Promise<{ success: boolean; path?: string; name?: string; canceled?: boolean; error?: string }>;
  showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  listDirectoryFiles: (dirPath: string) => Promise<{ success: boolean; files?: string[]; error?: string }>;
  readFile: (filePath: string) => Promise<{ success: boolean; data?: Buffer; error?: string }>;
  readFilesBatch: (filePaths: string[]) => Promise<{ success: boolean; files?: { success: boolean; data?: Buffer; path: string; error?: string }[]; error?: string }>;
  getFileStats: (filePath: string) => Promise<{ success: boolean; stats?: any; error?: string }>;
  writeFile: (filePath: string, data: any) => Promise<{ success: boolean; error?: string }>;
  getSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<{ success: boolean; error?: string }>;
  getDefaultCachePath: () => Promise<{ success: boolean; path?: string; error?: string }>;
  joinPaths: (...paths: string[]) => Promise<{ success: boolean; path?: string; error?: string }>;
  onLoadDirectoryFromCLI: (callback: (dirPath: string) => void) => () => void;
  testUpdateDialog: () => Promise<{ success: boolean; response?: number; error?: string }>;
  getTheme: () => Promise<{ shouldUseDarkColors: boolean }>;
  onThemeUpdated: (callback: (theme: { shouldUseDarkColors: boolean }) => void) => () => void;
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

export interface ForgeMetadata {
  parameters: string; // Forge uses same format as A1111: "Prompt: ...\nNegative prompt: ...\nSteps: ..."
  // Additional fields that might be present
  [key: string]: any;
}

// Union type for all supported metadata formats
export type ImageMetadata = InvokeAIMetadata | Automatic1111Metadata | ComfyUIMetadata | SwarmUIMetadata | EasyDiffusionMetadata | EasyDiffusionJson | MidjourneyMetadata | ForgeMetadata;

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
  return 'sui_image_params' in metadata && typeof metadata.sui_image_params === 'object';
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

export function isForgeMetadata(metadata: ImageMetadata): metadata is ForgeMetadata {
  return 'parameters' in metadata && 
         typeof metadata.parameters === 'string' && 
         (metadata.parameters.includes('Forge') || 
          metadata.parameters.includes('Gradio') ||
          (metadata.parameters.includes('Steps:') && 
           metadata.parameters.includes('Sampler:') && 
           metadata.parameters.includes('Model hash:'))); // Similar to A1111 but with Forge/Gradio indicators
}

export function isAutomatic1111Metadata(metadata: ImageMetadata): metadata is Automatic1111Metadata {
  return 'parameters' in metadata && typeof metadata.parameters === 'string' && !('sui_image_params' in metadata);
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

export interface IndexedImage {
  id: string; // Unique ID, e.g., file path
  name: string;
  handle: FileSystemFileHandle;
  thumbnailHandle?: FileSystemFileHandle; // Handle to .webp thumbnail
  thumbnailUrl?: string; // Blob URL for thumbnail
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
  schedulers: string[];
  selectedModel: string;
  selectedLora: string;
  selectedScheduler: string;
}

// File System Access API - extended Window interface
declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }
}

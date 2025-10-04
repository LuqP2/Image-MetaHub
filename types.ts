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

// Union type for all supported metadata formats
export type ImageMetadata = InvokeAIMetadata | Automatic1111Metadata | ComfyUIMetadata;

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

export function isAutomatic1111Metadata(metadata: ImageMetadata): metadata is Automatic1111Metadata {
  return 'parameters' in metadata && typeof metadata.parameters === 'string';
}

export function isComfyUIMetadata(metadata: ImageMetadata): metadata is ComfyUIMetadata {
  // Check for workflow or prompt fields (can be objects or strings)
  const hasWorkflow = 'workflow' in metadata && (typeof metadata.workflow === 'object' || typeof metadata.workflow === 'string');
  const hasPrompt = 'prompt' in metadata && (typeof metadata.prompt === 'object' || typeof metadata.prompt === 'string');

  // Must have at least one of workflow or prompt
  if (!hasWorkflow && !hasPrompt) {
    return false;
  }

  // Additional check: try to validate the content looks like ComfyUI format
  try {
    if (hasWorkflow && typeof metadata.workflow === 'string') {
      const parsed = JSON.parse(metadata.workflow);
      // Check if it looks like a ComfyUI workflow (has nodes array with nodes that have class_type)
      const hasValidStructure = parsed && typeof parsed === 'object' && parsed.nodes && Array.isArray(parsed.nodes) && parsed.nodes.some((node: any) =>
        node && typeof node === 'object' && (node.class_type || node.type)
      );
      // Debug logging removed for performance
      if (!hasValidStructure) {
        // Debug logging removed for performance
      }
      return hasValidStructure;
    }
    if (hasPrompt && typeof metadata.prompt === 'string') {
      const parsed = JSON.parse(metadata.prompt);
      // Check if it looks like a ComfyUI prompt (has nodes with class_type)
      const hasValidStructure = parsed && typeof parsed === 'object' && ((parsed.nodes && Array.isArray(parsed.nodes) && parsed.nodes.some((node: any) =>
        node && typeof node === 'object' && (node.class_type || node.type)
      )) || Object.values(parsed).some((node: any) =>
        node && typeof node === 'object' && (node.class_type || node.type)
      ));
      // Debug logging removed for performance
      if (!hasValidStructure) {
        // Debug logging removed for performance
      }
      return hasValidStructure;
    }
    if (hasWorkflow && typeof metadata.workflow === 'object') {
      // Check if object format looks like ComfyUI - check the nodes array
      const workflow = metadata.workflow as any;
      const hasValidStructure = workflow.nodes && Array.isArray(workflow.nodes) && workflow.nodes.some((node: any) =>
        node && typeof node === 'object' && (node.class_type || node.type)
      );
      // Debug logging removed for performance
      if (!hasValidStructure) {
        // Debug logging removed for performance
      }
      return hasValidStructure;
    }
    if (hasPrompt && typeof metadata.prompt === 'object') {
      // Check if object format looks like ComfyUI
      const hasValidStructure = Object.values(metadata.prompt).some((node: any) =>
        node && typeof node === 'object' && (node.class_type || node.type)
      );
      // Debug logging removed for performance
      return hasValidStructure;
    }
  } catch (error) {
    // If parsing fails, it's not valid ComfyUI format
    // Debug logging removed for performance
    return false;
  }

  // Debug logging removed for performance
  return true;
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

export interface InvokeAIMetadata {
  // Core generation fields
  positive_prompt?: string;
  negative_prompt?: string;
  generation_mode?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfgScale?: number;
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
  [key: string]: any;
}

export interface Automatic1111Metadata {
  parameters: string; // Formatted string containing all generation parameters
  // Additional fields that might be present
  [key: string]: any;
}

export interface ComfyUINode {
  id: number;
  type: string;
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
  workflow?: ComfyUIWorkflow | string; // Can be object or JSON string
  prompt?: ComfyUIPrompt | string; // Can be object or JSON string
  // Additional fields that might be present
  [key: string]: any;
}

// Union type for all supported metadata formats
export type ImageMetadata = InvokeAIMetadata | Automatic1111Metadata | ComfyUIMetadata;

// Base normalized metadata interface for unified access
export interface BaseMetadata {
  format?: 'invokeai' | 'automatic1111' | 'comfyui' | 'unknown';
  prompt: string;
  negativePrompt?: string;
  model: string;
  width: number;
  height: number;
  seed?: number;
  steps: number;
  cfgScale?: number;
  scheduler: string;
  sampler?: string;
  loras?: string[];
  // Additional normalized fields
  [key: string]: any;
}

// Type guard functions
export function isInvokeAIMetadata(metadata: ImageMetadata): metadata is InvokeAIMetadata {
  // Check for InvokeAI-specific fields
  return ('positive_prompt' in metadata && 'generation_mode' in metadata) ||
         ('positive_prompt' in metadata && 'app_version' in metadata) ||
         ('prompt' in metadata && ('model' in metadata || 'width' in metadata || 'height' in metadata));
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
      console.log('🔍 ComfyUI detection - workflow string parsed, hasValidStructure:', hasValidStructure);
      if (!hasValidStructure) {
        console.log('🔍 ComfyUI detection - parsed workflow.nodes exists:', !!(parsed && parsed.nodes));
        console.log('🔍 ComfyUI detection - parsed workflow.nodes isArray:', Array.isArray(parsed?.nodes));
        if (parsed?.nodes && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
          console.log('🔍 ComfyUI detection - first node keys:', Object.keys(parsed.nodes[0]));
          console.log('🔍 ComfyUI detection - first node sample:', JSON.stringify(parsed.nodes[0]).substring(0, 200));
        } else {
          console.log('🔍 ComfyUI detection - workflow content:', JSON.stringify(parsed).substring(0, 200) + '...');
        }
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
      console.log('🔍 ComfyUI detection - prompt string parsed, hasValidStructure:', hasValidStructure);
      if (!hasValidStructure) {
        console.log('🔍 ComfyUI detection - prompt content:', JSON.stringify(parsed).substring(0, 200) + '...');
      }
      return hasValidStructure;
    }
    if (hasWorkflow && typeof metadata.workflow === 'object') {
      // Check if object format looks like ComfyUI - check the nodes array
      const workflow = metadata.workflow as any;
      const hasValidStructure = workflow.nodes && Array.isArray(workflow.nodes) && workflow.nodes.some((node: any) =>
        node && typeof node === 'object' && (node.class_type || node.type)
      );
      console.log('🔍 ComfyUI detection - workflow object, hasValidStructure:', hasValidStructure);
      if (!hasValidStructure) {
        console.log('🔍 ComfyUI detection - workflow.nodes exists:', !!workflow.nodes);
        console.log('🔍 ComfyUI detection - workflow.nodes isArray:', Array.isArray(workflow.nodes));
        if (workflow.nodes && Array.isArray(workflow.nodes) && workflow.nodes.length > 0) {
          console.log('🔍 ComfyUI detection - first node keys:', Object.keys(workflow.nodes[0]));
          console.log('🔍 ComfyUI detection - first node sample:', JSON.stringify(workflow.nodes[0]).substring(0, 200));
        }
      }
      return hasValidStructure;
    }
    if (hasPrompt && typeof metadata.prompt === 'object') {
      // Check if object format looks like ComfyUI
      const hasValidStructure = Object.values(metadata.prompt).some((node: any) =>
        node && typeof node === 'object' && (node.class_type || node.type)
      );
      console.log('🔍 ComfyUI detection - prompt object, hasValidStructure:', hasValidStructure);
      return hasValidStructure;
    }
  } catch (error) {
    // If parsing fails, it's not valid ComfyUI format
    console.log('🔍 ComfyUI detection - parsing failed:', error);
    return false;
  }

  console.log('🔍 ComfyUI detection - reached end, returning true');
  return true;
}

export interface IndexedImage {
  id: string; // Unique ID, e.g., file path
  name: string;
  handle: FileSystemFileHandle;
  thumbnailHandle?: FileSystemFileHandle; // Handle to .webp thumbnail
  thumbnailUrl?: string; // Blob URL for thumbnail
  metadata: ImageMetadata;
  normalizedMetadata?: BaseMetadata; // Standardized metadata for consistent display
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
}

export interface FilterOptions {
  models: string[];
  loras: string[];
  schedulers: string[];
  selectedModel: string;
  selectedLora: string;
  selectedScheduler: string;
}

// Electron API types
declare global {
  interface Window {
    electronAPI?: {
      trashFile: (filename: string) => Promise<{ success: boolean; error?: string }>;
      renameFile: (oldName: string, newName: string) => Promise<{ success: boolean; error?: string }>;
      setCurrentDirectory: (dirPath: string) => Promise<{ success: boolean }>;
      showDirectoryDialog: () => Promise<{ success: boolean; path?: string; name?: string; canceled?: boolean; error?: string }>;
      showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
      listDirectoryFiles: (dirPath: string) => Promise<{ success: boolean; files?: {name: string; lastModified: number}[]; error?: string }>;
      readFile: (filePath: string) => Promise<{ success: boolean; data?: Buffer; error?: string }>;
    };
    // File System Access API
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }
}
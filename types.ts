
export interface InvokeAIMetadata {
  prompt: string | { prompt: string }[];
  model: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg_scale: number;
  scheduler: string;
  // Add other fields you expect from InvokeAI metadata
  [key: string]: any;
}

export interface IndexedImage {
  id: string; // Unique ID, e.g., file path
  name: string;
  handle: FileSystemFileHandle;
  thumbnailHandle?: FileSystemFileHandle; // Handle to .webp thumbnail
  thumbnailUrl?: string; // Blob URL for thumbnail
  metadata: InvokeAIMetadata;
  metadataString: string; // For faster searching
  lastModified: number; // File's last modified date
  models: string[]; // Extracted models from metadata
  loras: string[]; // Extracted LoRAs from metadata
}

export interface FilterOptions {
  models: string[];
  loras: string[];
  selectedModel: string;
  selectedLora: string;
}

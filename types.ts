
export interface InvokeAIMetadata {
  prompt: string | { prompt: string }[];
  model: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg_scale: number;
  scheduler: string;
  board_id?: string;
  board_name?: string;
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
  scheduler: string; // Extracted scheduler from metadata
  board?: string; // Extracted board name from metadata
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
    };
  }
}

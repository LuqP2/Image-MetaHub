export {};

declare global {
  interface Window {
    electronAPI: {
      onLoadDirectoryFromCLI: (callback: (path: string) => void) => () => void;
      onThemeUpdated: (callback: (theme: { shouldUseDarkColors: boolean }) => void) => () => void;
      onIndexingProgress: (callback: (progress: { current: number, total: number }) => void) => () => void;
      onIndexingBatchResult: (callback: (result: { batch: IndexedImage[] }) => void) => () => void;
      onIndexingError: (callback: (error: { error: string, directoryId: string }) => void) => () => void;
      onIndexingComplete: (callback: (result: { directoryId: string }) => void) => () => void;
      getTheme: () => Promise<{ shouldUseDarkColors: boolean }>;
      trashFile: (filePath: string) => Promise<void>;
      renameFile: (oldPath: string, newPath: string) => Promise<void>;
      setCurrentDirectory: (dirPath: string) => Promise<void>;
      updateAllowedPaths: (paths: string[]) => Promise<void>;
      showDirectoryDialog: () => Promise<string[] | undefined>;
      showItemInFolder: (filePath: string) => Promise<void>;
      listDirectoryFiles: (dirPath: string) => Promise<string[]>;
      readFile: (filePath: string) => Promise<Buffer>;
      readFilesBatch: (filePaths: string[]) => Promise<Buffer[]>;
      getFileStats: (filePath: string) => Promise<{ success: boolean; stats?: Record<string, unknown>; error?: string }>;
      writeFile: (filePath: string, data: Buffer) => Promise<void>;
      getSettings: () => Promise<Record<string, unknown>>;
      saveSettings: (settings: Record<string, unknown>) => Promise<void>;
      getDefaultCachePath: () => Promise<string>;
      joinPaths: (...paths: string[]) => Promise<string>;
      testUpdateDialog: () => Promise<void>;
    };
  }
}

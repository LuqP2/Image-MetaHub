const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // --- Listeners for main-to-renderer events ---
  onLoadDirectoryFromCLI: (callback) => {
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on('load-directory-from-cli', handler);
    // Return a cleanup function to remove the listener
    return () => {
      ipcRenderer.removeListener('load-directory-from-cli', handler);
    };
  },

  onThemeUpdated: (callback) => {
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on('theme-updated', handler);
    return () => {
      ipcRenderer.removeListener('theme-updated', handler);
    };
  },

  onIndexingProgress: (callback) => {
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on('indexing-progress', handler);
    return () => {
      ipcRenderer.removeListener('indexing-progress', handler);
    };
  },

  onIndexingBatchResult: (callback) => {
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on('indexing-batch-result', handler);
    return () => {
      ipcRenderer.removeListener('indexing-batch-result', handler);
    };
  },

  onIndexingError: (callback) => {
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on('indexing-error', handler);
    return () => {
      ipcRenderer.removeListener('indexing-error', handler);
    };
  },

  onIndexingComplete: (callback) => {
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on('indexing-complete', handler);
    return () => {
      ipcRenderer.removeListener('indexing-complete', handler);
    };
  },

  // Menu event listeners
  onMenuAddFolder: (callback) => {
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on('menu-add-folder', handler);
    return () => {
      ipcRenderer.removeListener('menu-add-folder', handler);
    };
  },

  onMenuOpenSettings: (callback) => {
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on('menu-open-settings', handler);
    return () => {
      ipcRenderer.removeListener('menu-open-settings', handler);
    };
  },

  onMenuToggleView: (callback) => {
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on('menu-toggle-view', handler);
    return () => {
      ipcRenderer.removeListener('menu-toggle-view', handler);
    };
  },

  onMenuShowChangelog: (callback) => {
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on('menu-show-changelog', handler);
    return () => {
      ipcRenderer.removeListener('menu-show-changelog', handler);
    };
  },

  // --- Invokable renderer-to-main functions ---
  getTheme: () => ipcRenderer.invoke('get-theme'),
  trashFile: (filePath) => ipcRenderer.invoke('trash-file', filePath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  setCurrentDirectory: (dirPath) => ipcRenderer.invoke('set-current-directory', dirPath),
  updateAllowedPaths: (paths) => ipcRenderer.invoke('update-allowed-paths', paths),
  showDirectoryDialog: () => ipcRenderer.invoke('show-directory-dialog'),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  listSubfolders: (folderPath) => ipcRenderer.invoke('list-subfolders', folderPath),
  listDirectoryFiles: (args) => ipcRenderer.invoke('list-directory-files', args),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readFilesBatch: (filePaths) => ipcRenderer.invoke('read-files-batch', filePaths),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getDefaultCachePath: () => ipcRenderer.invoke('get-default-cache-path'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  joinPaths: (...paths) => ipcRenderer.invoke('join-paths', ...paths),

  // --- Caching ---
  getCachedData: (cacheId) => ipcRenderer.invoke('get-cached-data', cacheId),
  getCacheSummary: (cacheId) => ipcRenderer.invoke('get-cache-summary', cacheId),
  cacheData: (args) => ipcRenderer.invoke('cache-data', args),
  prepareCacheWrite: (args) => ipcRenderer.invoke('prepare-cache-write', args),
  writeCacheChunk: (args) => ipcRenderer.invoke('write-cache-chunk', args),
  finalizeCacheWrite: (args) => ipcRenderer.invoke('finalize-cache-write', args),
  clearCacheData: (cacheId) => ipcRenderer.invoke('clear-cache-data', cacheId),
  getCacheChunk: (args) => ipcRenderer.invoke('get-cache-chunk', args),
  getThumbnail: (thumbnailId) => ipcRenderer.invoke('get-thumbnail', thumbnailId),
  cacheThumbnail: (args) => ipcRenderer.invoke('cache-thumbnail', args),
  clearMetadataCache: () => ipcRenderer.invoke('clear-metadata-cache'),
  clearThumbnailCache: () => ipcRenderer.invoke('clear-thumbnail-cache'),


  // TEST ONLY: Simulate update dialog
  testUpdateDialog: () => ipcRenderer.invoke('test-update-dialog')
});

// DEBUG: Log that preload script has loaded
console.log('🔌 Preload script loaded successfully');
console.log('🔍 electronAPI exposed:', typeof window !== 'undefined' ? 'window object available' : 'no window object');
console.log('🔍 Available electronAPI methods:', Object.keys(window.electronAPI || {}));
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

  onFullscreenChanged: (callback) => {
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on('fullscreen-changed', handler);
    return () => {
      ipcRenderer.removeListener('fullscreen-changed', handler);
    };
  },

  onFullscreenStateCheck: (callback) => {
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on('fullscreen-state-check', handler);
    return () => {
      ipcRenderer.removeListener('fullscreen-state-check', handler);
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
  openCacheLocation: (cachePath) => ipcRenderer.invoke('open-cache-location', cachePath),
  listSubfolders: (folderPath) => ipcRenderer.invoke('list-subfolders', folderPath),
  listDirectoryFiles: (args) => ipcRenderer.invoke('list-directory-files', args),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readFilesBatch: (filePaths) => ipcRenderer.invoke('read-files-batch', filePaths),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  ensureDirectory: (dirPath) => ipcRenderer.invoke('ensure-directory', dirPath),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getDefaultCachePath: () => ipcRenderer.invoke('get-default-cache-path'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  joinPaths: (...paths) => ipcRenderer.invoke('join-paths', ...paths),
  joinPathsBatch: (args) => ipcRenderer.invoke('join-paths-batch', args),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  startFileDrag: (args) => ipcRenderer.send('start-file-drag', args),

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
  deleteCacheFolder: () => ipcRenderer.invoke('delete-cache-folder'),
  restartApp: () => ipcRenderer.invoke('restart-app'),

  // File watching
  startWatchingDirectory: (args) => ipcRenderer.invoke('start-watching-directory', args),
  stopWatchingDirectory: (args) => ipcRenderer.invoke('stop-watching-directory', args),
  getWatcherStatus: (args) => ipcRenderer.invoke('get-watcher-status', args),
  onNewImagesDetected: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('new-images-detected', subscription);
    return () => ipcRenderer.removeListener('new-images-detected', subscription);
  },
  onWatcherDebug: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('watcher-debug', subscription);
    return () => ipcRenderer.removeListener('watcher-debug', subscription);
  },

  // TEST ONLY: Simulate update dialog
  testUpdateDialog: () => ipcRenderer.invoke('test-update-dialog')
});

// DEBUG: Log that preload script has loaded
console.log('🔌 Preload script loaded successfully');
console.log('🔍 electronAPI exposed:', typeof window !== 'undefined' ? 'window object available' : 'no window object');
console.log('🔍 Available electronAPI methods:', Object.keys(window.electronAPI || {}));

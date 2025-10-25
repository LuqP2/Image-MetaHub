console.log('PRELOAD: Script starting...');

const { contextBridge, ipcRenderer } = require('electron');

console.log('PRELOAD: Electron modules loaded');

try {
  console.log('PRELOAD: About to expose electronAPI');
  contextBridge.exposeInMainWorld('electronAPI', {
    test: () => 'hello from preload',
    getDirectoryId: (directoryPath) => ipcRenderer.invoke('get-directory-id', directoryPath),
    getImages: (options) => ipcRenderer.invoke('get-images', options),
    startIndexing: (directoryPath) => ipcRenderer.invoke('start-indexing', directoryPath),
    onIndexingComplete: (callback) => {
      const handler = (event, ...args) => callback(...args);
      ipcRenderer.on('indexing-complete', handler);
      return () => ipcRenderer.removeListener('indexing-complete', handler);
    },
    onIndexingProgress: (callback) => {
      const handler = (event, ...args) => callback(...args);
      ipcRenderer.on('indexing-progress', handler);
      return () => ipcRenderer.removeListener('indexing-progress', handler);
    },
    onIndexingBatchResult: (callback) => {
      const handler = (event, ...args) => callback(...args);
      ipcRenderer.on('indexing-batch-result', handler);
      return () => ipcRenderer.removeListener('indexing-batch-result', handler);
    },
    onIndexingError: (callback) => {
      const handler = (event, ...args) => callback(...args);
      ipcRenderer.on('indexing-error', handler);
      return () => ipcRenderer.removeListener('indexing-error', handler);
    },
    onUpdateAvailable: (callback) => {
      const handler = (event, ...args) => callback(...args);
      ipcRenderer.on('update-available', handler);
      return () => ipcRenderer.removeListener('update-available', handler);
    },
    onUpdateProgress: (callback) => {
      const handler = (event, ...args) => callback(...args);
      ipcRenderer.on('update-progress', handler);
      return () => ipcRenderer.removeListener('update-progress', handler);
    },
    onUpdateDownloaded: (callback) => {
      const handler = (event, ...args) => callback(...args);
      ipcRenderer.on('update-downloaded', handler);
      return () => ipcRenderer.removeListener('update-downloaded', handler);
    },
    onThemeUpdated: (callback) => {
      const handler = (event, ...args) => callback(...args);
      ipcRenderer.on('theme-updated', handler);
      return () => ipcRenderer.removeListener('theme-updated', handler);
    },
    onLoadDirectoryFromCLI: (callback) => {
      const handler = (event, ...args) => callback(...args);
      ipcRenderer.on('load-directory-from-cli', handler);
      return () => ipcRenderer.removeListener('load-directory-from-cli', handler);
    },
    onMenuAddFolder: (callback) => {
      const handler = (event, ...args) => callback(...args);
      ipcRenderer.on('menu-add-folder', handler);
      return () => ipcRenderer.removeListener('menu-add-folder', handler);
    },
    onMenuOpenSettings: (callback) => {
      const handler = (event, ...args) => callback(...args);
      ipcRenderer.on('menu-open-settings', handler);
      return () => ipcRenderer.removeListener('menu-open-settings', handler);
    },
    onMenuToggleView: (callback) => {
      const handler = (event, ...args) => callback(...args);
      ipcRenderer.on('menu-toggle-view', handler);
      return () => ipcRenderer.removeListener('menu-toggle-view', handler);
    },
    onMenuShowChangelog: (callback) => {
      const handler = (event, ...args) => callback(...args);
      ipcRenderer.on('menu-show-changelog', handler);
      return () => ipcRenderer.removeListener('menu-show-changelog', handler);
    },
    showDirectoryDialog: () => ipcRenderer.invoke('show-directory-dialog'),
    writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
    getTheme: () => ipcRenderer.invoke('get-theme'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    saveSettings: (newSettings) => ipcRenderer.invoke('save-settings', newSettings),
    updateAllowedPaths: (paths) => ipcRenderer.invoke('update-allowed-paths', paths),
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
    joinPaths: (...paths) => ipcRenderer.invoke('join-paths', ...paths)
  });
  console.log('PRELOAD: electronAPI exposed successfully');
} catch (error) {
  console.error('PRELOAD: Error exposing electronAPI:', error);
  console.error('PRELOAD: Error stack:', error.stack);
}

console.log('PRELOAD: Script finished');

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

  // --- Invokable renderer-to-main functions ---
  trashFile: (filename) => ipcRenderer.invoke('trash-file', filename),
  renameFile: (oldName, newName) => ipcRenderer.invoke('rename-file', oldName, newName),
  setCurrentDirectory: (dirPath) => ipcRenderer.invoke('set-current-directory', dirPath),
  showDirectoryDialog: () => ipcRenderer.invoke('show-directory-dialog'),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  listDirectoryFiles: (dirPath) => ipcRenderer.invoke('list-directory-files', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readFilesBatch: (filePaths) => ipcRenderer.invoke('read-files-batch', filePaths),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getDefaultCachePath: () => ipcRenderer.invoke('get-default-cache-path')
});

// DEBUG: Log that preload script has loaded
console.log('🔌 Preload script loaded successfully');
console.log('🔍 electronAPI exposed:', typeof window !== 'undefined' ? 'window object available' : 'no window object');
console.log('🔍 Available electronAPI methods:', Object.keys(window.electronAPI || {}));
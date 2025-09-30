const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  trashFile: (filename) => ipcRenderer.invoke('trash-file', filename),
  renameFile: (oldName, newName) => ipcRenderer.invoke('rename-file', oldName, newName),
  setCurrentDirectory: (dirPath) => ipcRenderer.invoke('set-current-directory', dirPath),
  showDirectoryDialog: () => ipcRenderer.invoke('show-directory-dialog'),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  listDirectoryFiles: (dirPath) => ipcRenderer.invoke('list-directory-files', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath)
});

// DEBUG: Log that preload script has loaded
console.log('🔌 Preload script loaded successfully');
console.log('🔍 electronAPI exposed:', typeof window !== 'undefined' ? 'window object available' : 'no window object');
console.log('🔍 Available electronAPI methods:', Object.keys(window.electronAPI || {}));
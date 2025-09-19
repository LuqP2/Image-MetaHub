const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  trashFile: (filename) => ipcRenderer.invoke('trash-file', filename),
  renameFile: (oldName, newName) => ipcRenderer.invoke('rename-file', oldName, newName),
  setCurrentDirectory: (dirPath) => ipcRenderer.invoke('set-current-directory', dirPath),
  showDirectoryDialog: () => ipcRenderer.invoke('show-directory-dialog'),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath)
});
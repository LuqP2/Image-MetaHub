const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs').promises;

// Simple development check
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;

// Configure auto-updater
// Remove checkForUpdatesAndNotify to avoid duplicate dialogs
// autoUpdater.checkForUpdatesAndNotify();

// Check for updates manually
setTimeout(() => {
  if (!isDev) {
    autoUpdater.checkForUpdates();
  }
}, 3000); // Wait 3 seconds after app start

// Auto-updater events
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for update...');
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
  if (mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Update Available',
      message: `A new version (${info.version}) is available.`,
      detail: 'Would you like to download and install it now?',
      buttons: ['Download Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        // User chose to download
        console.log('User accepted update download');
        // The download will start automatically
      } else {
        // User chose "Later"
        console.log('User postponed update');
      }
    });
  }
});

autoUpdater.on('update-not-available', (info) => {
  console.log('Update not available');
});

autoUpdater.on('error', (err) => {
  console.log('Error in auto-updater:', err);
  dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: 'Update Error',
    message: 'Failed to check for updates.',
    detail: err.message || 'Please try again later.',
    buttons: ['OK']
  });
});

autoUpdater.on('download-progress', (progressObj) => {
  let log_message = `Download speed: ${progressObj.bytesPerSecond}`;
  log_message = log_message + ` - Downloaded ${progressObj.percent}%`;
  log_message = log_message + ` (${progressObj.transferred}/${progressObj.total})`;
  console.log(log_message);

  // Optional: Send progress to renderer process for UI feedback
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('update-progress', progressObj);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded:', info.version);
  if (mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Update Ready',
      message: `Update downloaded successfully!`,
      detail: `Version ${info.version} is ready to install. The application will restart to apply the update.`,
      buttons: ['Install Now', 'Install on Next Start'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        // Install now
        console.log('User chose to install update now');
        autoUpdater.quitAndInstall();
      } else {
        // Install on next start
        console.log('User chose to install update on next start');
      }
    }).catch((error) => {
      console.error('Error showing update dialog:', error);
      // Fallback: just install the update
      autoUpdater.quitAndInstall();
    });
  } else {
    console.log('Main window not available, installing update automatically');
    autoUpdater.quitAndInstall();
  }
});

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'default',
    show: false // Don't show until ready
  });

  // Load the app
  let startUrl;
  if (isDev) {
    startUrl = 'http://localhost:5173';
  } else {
    // In production, files are directly in the app directory
    startUrl = `file://${path.join(__dirname, 'dist', 'index.html')}`;
  }
  
  console.log('Loading URL:', startUrl);
  console.log('Is Dev:', isDev);
  console.log('App path:', __dirname);
  
  mainWindow.loadURL(startUrl);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Check for updates in production
    if (!isDev) {
      setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify();
      }, 3000); // Wait 3 seconds after app opens
    }
  });

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App event handlers
app.whenReady().then(() => {
  createWindow();
  
  // Setup IPC handlers for file operations
  setupFileOperationHandlers();
});

// Setup IPC handlers for file operations
// Store current directory path
let currentDirectoryPath = '';

function setupFileOperationHandlers() {
  // Handle setting current directory
  ipcMain.handle('set-current-directory', async (event, dirPath) => {
    currentDirectoryPath = dirPath;
    console.log('Current directory set to:', dirPath);
    return { success: true };
  });

  // Handle directory selection for Electron
  ipcMain.handle('show-directory-dialog', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
      });
      
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      
      const selectedPath = result.filePaths[0];
      currentDirectoryPath = selectedPath;
      
      return { 
        success: true, 
        path: selectedPath,
        name: path.basename(selectedPath)
      };
    } catch (error) {
      console.error('Error showing directory dialog:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle file deletion (move to trash)
  ipcMain.handle('trash-file', async (event, filename) => {
    try {
      if (!currentDirectoryPath) {
        return { success: false, error: 'No directory selected' };
      }

      const filePath = path.join(currentDirectoryPath, filename);
      console.log('Attempting to trash file:', filePath);
      
      const success = await shell.trashItem(filePath);
      return { success: true };
    } catch (error) {
      console.error('Error trashing file:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle file renaming
  ipcMain.handle('rename-file', async (event, oldName, newName) => {
    try {
      if (!currentDirectoryPath) {
        return { success: false, error: 'No directory selected' };
      }

      const oldPath = path.join(currentDirectoryPath, oldName);
      const newPath = path.join(currentDirectoryPath, newName);
      
      console.log('Attempting to rename file:', oldPath, 'to', newPath);
      
      await fs.rename(oldPath, newPath);
      return { success: true };
    } catch (error) {
      console.error('Error renaming file:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle show item in folder
  ipcMain.handle('show-item-in-folder', async (event, filePath) => {
    try {
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (error) {
      console.error('Error showing item in folder:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle manual update check
  ipcMain.handle('check-for-updates', async () => {
    try {
      console.log('Manual update check requested');
      const result = await autoUpdater.checkForUpdates();
      return { success: true, updateInfo: result.updateInfo };
    } catch (error) {
      console.error('Error checking for updates:', error);
      return { success: false, error: error.message };
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
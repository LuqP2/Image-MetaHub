const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs').promises;

// Simple development check
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;
let skippedVersions = new Set(); // Store versions user wants to skip

// Configure auto-updater
autoUpdater.autoDownload = false; // CRITICAL: Disable automatic downloads

// Configure for macOS specifically
if (process.platform === 'darwin') {
  autoUpdater.forceDevUpdateConfig = true; // Allow updates in development
}

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
  // console.log('Checking for update...');
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);

  // Check if user previously skipped this version
  if (skippedVersions.has(info.version)) {
    console.log('User previously skipped version', info.version, '- not showing dialog');
    return;
  }

  if (mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Update Available',
      message: `A new version (${info.version}) is available.`,
      detail: 'Would you like to download this update?',
      buttons: ['Download Now', 'Download Later', 'Skip this version'],
      defaultId: 0,
      cancelId: 2
    }).then((result) => {
      if (result.response === 0) {
        // User chose to download - START DOWNLOAD NOW
        console.log('User accepted update download - starting download...');
        autoUpdater.downloadUpdate();
      } else if (result.response === 1) {
        // User chose "Download Later"
        console.log('User postponed download - will ask again later');
        // Ensure no download starts automatically
      } else {
        // User chose "Skip this version"
        console.log('User skipped version', info.version);
        skippedVersions.add(info.version);
        // Ensure no download starts automatically
      }
    }).catch((error) => {
      console.error('Error showing update dialog:', error);
      // If dialog fails, don't download automatically - respect user choice
      console.log('Dialog failed - not downloading update');
    });
  } else {
    console.log('Main window not available - not downloading update');
    // Don't download if we can't ask for permission
  }
});

autoUpdater.on('update-not-available', (info) => {
  // console.log('Update not available');
});

autoUpdater.on('error', (err) => {
  console.log('Error in auto-updater:', err);
  
  // Special handling for macOS
  if (process.platform === 'darwin') {
    console.log('macOS auto-updater error - this may be due to code signing requirements');
  }
  
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
      title: 'Update Downloaded',
      message: `Update ${info.version} downloaded successfully!`,
      detail: 'The update is ready to install. When would you like to apply it?',
      buttons: ['Install Now', 'Install on Next Start', 'Cancel'],
      defaultId: 0,
      cancelId: 2
    }).then((result) => {
      if (result.response === 0) {
        // Install now
        console.log('User chose to install update now');
        autoUpdater.quitAndInstall();
      } else if (result.response === 1) {
        // Install on next start - don't restart now
        console.log('User chose to install update on next start');
        // The update will be installed automatically on next app launch
        // No need to call quitAndInstall() here
      } else {
        // Cancel - user changed their mind
        console.log('User cancelled update installation');
        // Update remains downloaded but not installed
        // User can still install it later if they change their mind
      }
    }).catch((error) => {
      console.error('Error showing installation dialog:', error);
      // If dialog fails, don't force install - respect user choice
      console.log('Installation dialog failed - update will install on next start');
    });
  } else {
    console.log('Main window not available - update will install on next start');
    // Don't force restart if window is not available
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
  
  // console.log('Loading URL:', startUrl);
  // console.log('Is Dev:', isDev);
  // console.log('App path:', __dirname);
  
  mainWindow.loadURL(startUrl);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Check for updates in production (REMOVED checkForUpdatesAndNotify to prevent auto-download)
    // Update check is handled in the setTimeout above with checkForUpdates()
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
    // console.log('Current directory set to:', dirPath);
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
      console.log('📂 Attempting to show item in folder:', filePath);

      // Verify the file exists before trying to show it
      const fs = require('fs').promises;
      try {
        await fs.access(filePath);
        console.log('✅ File exists:', filePath);
      } catch (accessError) {
        console.error('❌ File does not exist:', filePath, accessError);
        return { success: false, error: `File does not exist: ${filePath}` };
      }

      shell.showItemInFolder(filePath);
      console.log('✅ shell.showItemInFolder called for:', filePath);

      return { success: true };
    } catch (error) {
      console.error('❌ Error showing item in folder:', error);
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

  // Handle listing directory files
  ipcMain.handle('list-directory-files', async (event, dirPath) => {
    try {
      if (!dirPath) {
        return { success: false, error: 'No directory path provided' };
      }

      const files = await fs.readdir(dirPath, { withFileTypes: true });
      // Filter for PNG files only and get their stats
      const pngFiles = [];

      for (const file of files) {
        if (file.isFile() && file.name.toLowerCase().endsWith('.png')) {
          const filePath = path.join(dirPath, file.name);
          const stats = await fs.stat(filePath);
          pngFiles.push({
            name: file.name,
            lastModified: stats.mtime.getTime() // Convert to timestamp
          });
        }
      }

      // console.log('Listed files in directory:', dirPath); // Commented out to reduce console noise
      // console.log('Found PNG files:', pngFiles.length); // Commented out to reduce console noise

      console.log('📂 Electron listDirectoryFiles called for:', dirPath);
      console.log('📋 Found PNG files:', pngFiles.length);

      return { success: true, files: pngFiles };
    } catch (error) {
      console.error('Error listing directory files:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle reading file content
  ipcMain.handle('read-file', async (event, filePath) => {
    try {
      if (!filePath) {
        return { success: false, error: 'No file path provided' };
      }

      const data = await fs.readFile(filePath);
      // console.log('Read file:', filePath, 'Size:', data.length); // Commented out to reduce console noise

      return { success: true, data: data };
    } catch (error) {
      // Only log errors that aren't "file not found" to avoid spam when cache is stale
      if (!error.message?.includes('ENOENT') && !error.message?.includes('no such file')) {
        console.error('Error reading file:', error);
      }
      return { success: false, error: error.message };
    }
  });

  // Handle getting skipped versions
  ipcMain.handle('get-skipped-versions', () => {
    return { success: true, skippedVersions: Array.from(skippedVersions) };
  });

  // Handle clearing skipped versions
  ipcMain.handle('clear-skipped-versions', () => {
    const count = skippedVersions.size;
    skippedVersions.clear();
    console.log('Cleared', count, 'skipped versions');
    return { success: true, clearedCount: count };
  });

  // Handle skipping a specific version
  ipcMain.handle('skip-version', (event, version) => {
    if (version) {
      skippedVersions.add(version);
      console.log('Manually skipped version:', version);
      return { success: true };
    }
    return { success: false, error: 'Version not provided' };
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
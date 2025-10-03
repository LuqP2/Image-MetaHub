import electron from 'electron';
const { app, BrowserWindow, shell, dialog, ipcMain } = electron;
// console.log('📦 Loaded electron module');

import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
// console.log('📦 Loaded electron-updater module, autoUpdater available:', !!autoUpdater);

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple development check
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;
let skippedVersions = new Set();

// --- Settings Management ---
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

async function readSettings() {
  try {
    const data = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist or is invalid, return empty object
    return {};
  }
}

async function saveSettings(settings) {
  try {
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}
// --- End Settings Management ---

// Configure auto-updater
if (autoUpdater) {
  autoUpdater.autoDownload = false; // CRITICAL: Disable automatic downloads

  // Configure for macOS specifically
  if (process.platform === 'darwin') {
    autoUpdater.forceDevUpdateConfig = true; // Allow updates in development
  }

  // Remove checkForUpdatesAndNotify to avoid duplicate dialogs
  // autoUpdater.checkForUpdatesAndNotify();

  // Check for updates manually, respecting user settings
  setTimeout(async () => {
    if (isDev) return;

    const settings = await readSettings();
    // Default to true if the setting is not present
    const shouldCheckForUpdates = settings.autoUpdate !== false;

    if (shouldCheckForUpdates) {
      console.log('Checking for updates...');
      autoUpdater.checkForUpdates();
    } else {
      console.log('Auto-update is disabled by user settings.');
    }
  }, 3000); // Wait 3 seconds after app start
} else {
  console.log('⚠️ Auto-updater not available, skipping update configuration');
}

// Auto-updater events
if (autoUpdater) {
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
} else {
  console.log('⚠️ Auto-updater not available, skipping event handlers');
}

function createWindow(startupDirectory = null) {
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

    // If a startup directory was provided via CLI, send it to the renderer
    if (startupDirectory) {
      console.log('Sending startup directory to renderer:', startupDirectory);
      mainWindow.webContents.send('load-directory-from-cli', startupDirectory);
    }
    
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
app.whenReady().then(async () => {
  let startupDirectory = null;

  // Check for a directory path provided as a command-line argument
  // In dev, args start at index 2 (`electron . /path`); in packaged app, at index 1 (`app.exe /path`)
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const potentialPath = args.find(arg => !arg.startsWith('--')); // Find first non-flag argument

  if (potentialPath) {
    const fullPath = path.resolve(potentialPath);
    try {
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        startupDirectory = fullPath;
        console.log('Startup directory specified:', startupDirectory);
      } else {
        console.warn(`Provided startup path is not a directory: ${fullPath}`);
      }
    } catch (error) {
      console.warn(`Error checking startup path "${fullPath}": ${error.message}`);
    }
  }

  createWindow(startupDirectory);
  
  // Setup IPC handlers for file operations
  setupFileOperationHandlers();
});

// Setup IPC handlers for file operations
// Store current directory path
let currentDirectoryPath = '';

// Helper function for recursive file search
async function getFilesRecursively(directory, baseDirectory) {
    const files = [];
    try {
        const entries = await fs.readdir(directory, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                files.push(...await getFilesRecursively(fullPath, baseDirectory));
            } else if (entry.isFile()) {
                const lowerName = entry.name.toLowerCase();
                if (lowerName.endsWith('.png') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
                    const stats = await fs.stat(fullPath);
                    files.push({
                        name: path.relative(baseDirectory, fullPath).replace(/\\/g, '/'),
                        lastModified: stats.birthtimeMs
                    });
                }
            }
        }
    } catch (error) {
        // Ignore errors from directories we can't read, e.g. permissions
        console.warn(`Could not read directory ${directory}: ${error.message}`);
    }
    return files;
}

function setupFileOperationHandlers() {
  // --- Settings IPC ---
  ipcMain.handle('get-settings', async () => {
    const settings = await readSettings();
    return settings;
  });

  ipcMain.handle('save-settings', async (event, newSettings) => {
    const currentSettings = await readSettings();
    const mergedSettings = { ...currentSettings, ...newSettings };
    await saveSettings(mergedSettings);
  });

  ipcMain.handle('get-default-cache-path', () => {
    // Define a specific subfolder for the cache
    return path.join(app.getPath('userData'), 'ImageMetaHubCache');
  });
  // --- End Settings IPC ---

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
      // NOTE: Don't update currentDirectoryPath here - this is for export destination selection
      // currentDirectoryPath should remain as the source directory
      
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

      // --- SECURITY CHECK ---
      const safeBasePath = path.normalize(currentDirectoryPath);
      const filePath = path.resolve(safeBasePath, filename);

      if (!filePath.startsWith(safeBasePath)) {
        console.error('SECURITY VIOLATION: Attempted to trash file outside of the allowed directory.');
        return { success: false, error: 'Access denied: Cannot trash files outside of the selected directory.' };
      }
      // --- END SECURITY CHECK ---

      console.log('Attempting to trash file:', filePath);
      
      await shell.trashItem(filePath);
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

      // --- SECURITY CHECK ---
      const safeBasePath = path.normalize(currentDirectoryPath);
      const oldPath = path.resolve(safeBasePath, oldName);
      const newPath = path.resolve(safeBasePath, newName);

      if (!oldPath.startsWith(safeBasePath) || !newPath.startsWith(safeBasePath)) {
        console.error('SECURITY VIOLATION: Attempted to rename file outside of the allowed directory.');
        return { success: false, error: 'Access denied: Cannot rename files outside of the selected directory.' };
      }
      // --- END SECURITY CHECK ---
      
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
      // --- SECURITY CHECK ---
      if (!currentDirectoryPath) {
        return { success: false, error: 'No directory selected' };
      }
      const safeBasePath = path.normalize(currentDirectoryPath);
      const normalizedFilePath = path.normalize(filePath);

      if (!normalizedFilePath.startsWith(safeBasePath)) {
        console.error('SECURITY VIOLATION: Attempted to show item outside of the allowed directory.');
        return { success: false, error: 'Access denied: Cannot show items outside of the selected directory.' };
      }
      // --- END SECURITY CHECK ---

      console.log('📂 Attempting to show item in folder:', normalizedFilePath);

      // Verify the file exists before trying to show it
      const { promises: fs } = await import('fs');
      try {
        await fs.access(normalizedFilePath);
        console.log('✅ File exists:', normalizedFilePath);
      } catch (accessError) {
        console.error('❌ File does not exist:', normalizedFilePath, accessError);
        return { success: false, error: `File does not exist: ${normalizedFilePath}` };
      }

      shell.showItemInFolder(normalizedFilePath);
      console.log('✅ shell.showItemInFolder called for:', normalizedFilePath);

      return { success: true };
    } catch (error) {
      console.error('❌ Error showing item in folder:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle manual update check
  ipcMain.handle('check-for-updates', async () => {
    if (!autoUpdater) {
      return { success: false, error: 'Auto-updater not available' };
    }
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
  ipcMain.handle('list-directory-files', async (event, { dirPath, recursive = false }) => {
    try {
      if (!dirPath) {
        return { success: false, error: 'No directory path provided' };
      }

      let imageFiles = [];

      if (recursive) {
        imageFiles = await getFilesRecursively(dirPath, dirPath);
      } else {
        const files = await fs.readdir(dirPath, { withFileTypes: true });

        for (const file of files) {
          if (file.isFile()) {
            const name = file.name.toLowerCase();
            if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) {
              const filePath = path.join(dirPath, file.name);
              const stats = await fs.stat(filePath);
              imageFiles.push({
                name: file.name, // name is already relative for top-level
                lastModified: stats.birthtimeMs
              });
            }
          }
        }
      }

      return { success: true, files: imageFiles };
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

      // --- SECURITY CHECK ---
      if (!currentDirectoryPath) {
        // This case should ideally not be hit if the app flow is correct, but as a safeguard:
        return { success: false, error: 'No directory selected' };
      }
      const safeBasePath = path.normalize(currentDirectoryPath);
      const normalizedFilePath = path.normalize(filePath);

      if (!normalizedFilePath.startsWith(safeBasePath)) {
        console.error('SECURITY VIOLATION: Attempted to read file outside of the allowed directory.');
        return { success: false, error: 'Access denied: Cannot read files outside of the selected directory.' };
      }
      // --- END SECURITY CHECK ---

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

  // Handle reading multiple files in a batch
  ipcMain.handle('read-files-batch', async (event, filePaths) => {
    try {
      if (!Array.isArray(filePaths) || filePaths.length === 0) {
        return { success: false, error: 'No file paths provided' };
      }

      if (!currentDirectoryPath) {
        return { success: false, error: 'No directory selected' };
      }

      const safeBasePath = path.normalize(currentDirectoryPath);

      // --- SECURITY CHECK ---
      for (const filePath of filePaths) {
        const normalizedFilePath = path.normalize(filePath);
        if (!normalizedFilePath.startsWith(safeBasePath)) {
          console.error('SECURITY VIOLATION: Attempted to read file outside of the allowed directory:', filePath);
          return { success: false, error: 'Access denied: Cannot read files outside of the selected directory.' };
        }
      }
      // --- END SECURITY CHECK ---

      const promises = filePaths.map(filePath => fs.readFile(filePath));
      const results = await Promise.allSettled(promises);

      const data = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return { success: true, data: result.value, path: filePaths[index] };
        } else {
          if (!result.reason.message?.includes('ENOENT')) {
            console.error('Error reading file in batch:', filePaths[index], result.reason);
          }
          return { success: false, error: result.reason.message, path: filePaths[index] };
        }
      });

      return { success: true, files: data };
    } catch (error) {
      console.error('Error in read-files-batch handler:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle getting file statistics (creation date, etc.)
  ipcMain.handle('get-file-stats', async (event, filePath) => {
    try {
      if (!filePath) {
        return { success: false, error: 'No file path provided' };
      }

      // --- SECURITY CHECK ---
      if (!currentDirectoryPath) {
        return { success: false, error: 'No directory selected' };
      }
      const safeBasePath = path.normalize(currentDirectoryPath);
      const normalizedFilePath = path.normalize(filePath);

      if (!normalizedFilePath.startsWith(safeBasePath)) {
        console.error('SECURITY VIOLATION: Attempted to get stats for file outside of the allowed directory.');
        return { success: false, error: 'Access denied: Cannot get stats for files outside of the selected directory.' };
      }
      // --- END SECURITY CHECK ---

      const stats = await fs.stat(filePath);
      return {
        success: true,
        stats: {
          size: stats.size,
          birthtime: stats.birthtime,
          birthtimeMs: stats.birthtimeMs,
          mtime: stats.mtime,
          mtimeMs: stats.mtimeMs,
          ctime: stats.ctime,
          ctimeMs: stats.ctimeMs
        }
      };
    } catch (error) {
      console.error('Error getting file stats:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle writing file content
  ipcMain.handle('write-file', async (event, filePath, data) => {
    try {
      if (!filePath) {
        return { success: false, error: 'No file path provided' };
      }

      if (!data) {
        return { success: false, error: 'No data provided' };
      }

      // --- SECURITY CHECK ---
      // For write operations, we need to be more careful about where files can be written
      // We'll allow writing to any directory the user has selected via the directory dialog
      // This is more permissive than read operations but still controlled
      const normalizedFilePath = path.normalize(filePath);
      const fileDir = path.dirname(normalizedFilePath);

      // Check if the target directory is within the current directory or a user-selected export directory
      // For now, we'll allow writing to any directory (since users explicitly choose export locations)
      // But we should add additional validation in the future if needed

      console.log('Writing file to:', normalizedFilePath, 'Size:', data.length);

      await fs.writeFile(normalizedFilePath, data);
      return { success: true };
    } catch (error) {
      console.error('Error writing file:', error);
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
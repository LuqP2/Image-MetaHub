import electron from 'electron';
const { app, BrowserWindow, shell, dialog, ipcMain, nativeTheme, Menu, clipboard, nativeImage } = electron;
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

// --- Application Menu ---
function createApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-add-folder');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-open-settings');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Grid/List View',
          accelerator: 'CmdOrCtrl+L',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-toggle-view');
            }
          }
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin' ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: `What's New (v${app.getVersion()})`,
          accelerator: 'F1',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-show-changelog');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Check for Updates...',
          click: async () => {
            if (autoUpdater) {
              try {
                console.log('Manually checking for updates...');
                await autoUpdater.checkForUpdates();
              } catch (error) {
                console.error('Error checking for updates:', error);
                if (mainWindow) {
                  dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    title: 'Update Check',
                    message: 'Failed to check for updates.',
                    detail: error.message || 'Please try again later.',
                    buttons: ['OK']
                  });
                }
              }
            } else {
              if (mainWindow) {
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: 'Update Check',
                  message: 'Auto-updater is not available in development mode.',
                  buttons: ['OK']
                });
              }
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Documentation',
          click: async () => {
            await shell.openExternal('https://github.com/LuqP2/Image-MetaHub#readme');
          }
        },
        {
          label: 'Report Bug',
          click: async () => {
            await shell.openExternal('https://github.com/LuqP2/Image-MetaHub/issues/new');
          }
        },
        {
          label: 'View on GitHub',
          click: async () => {
            await shell.openExternal('https://github.com/LuqP2/Image-MetaHub');
          }
        },
        { type: 'separator' },
        {
          label: `About Image MetaHub`,
          click: () => {
            if (mainWindow) {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'About Image MetaHub',
                message: `Image MetaHub v${app.getVersion()}`,
                detail: 'A powerful tool for browsing and managing AI-generated images with metadata support for InvokeAI, ComfyUI, A1111, and more.\n\n© 2025 LuqP2',
                buttons: ['OK']
              });
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
// --- End Application Menu ---

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
    if (mainWindow) {
      // Instead of showing a dialog, send an event to the renderer process
      mainWindow.webContents.send('update-available', info);
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
      // Notify the renderer that the update is ready
      mainWindow.webContents.send('update-downloaded', info);
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

  // Create application menu
  createApplicationMenu();

  // Set window title to include version (keeps it accurate across builds)
  try {
    const appVersion = app.getVersion();
    mainWindow.setTitle(`Image MetaHub v${appVersion}`);
  } catch (e) {
    // Fallback if app.getVersion is not available
    mainWindow.setTitle('Image MetaHub v0.9.4');
  }

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

  // Listen for fullscreen changes and notify renderer
  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('fullscreen-changed', false);
  });

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
  // Listen for theme changes and notify renderer
  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('theme-updated', {
        shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
      });
    }
  });

  let startupDirectory = null;

  // Check for a directory path provided as a command-line argument
  // In dev, args start at index 2 (`electron . /path`); in packaged app, at index 1 (`app.exe /path`)
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  
  // Support both --dir flag and direct path
  let potentialPath = null;
  const dirFlagIndex = args.indexOf('--dir');
  
  if (dirFlagIndex !== -1 && args[dirFlagIndex + 1]) {
    // Use --dir flag value
    potentialPath = args[dirFlagIndex + 1];
  } else {
    // Fall back to first non-flag argument
    potentialPath = args.find(arg => !arg.startsWith('--'));
  }

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

  // Setup IPC handlers for file operations BEFORE creating window
  setupFileOperationHandlers();
  
  createWindow(startupDirectory);
});

// Setup IPC handlers for file operations
// Store allowed directory paths for security
const allowedDirectoryPaths = new Set();

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
  // Security helper to check if a file path is within one of the allowed directories
  const isPathAllowed = (filePath) => {
    if (allowedDirectoryPaths.size === 0) return false;
    const normalizedFilePath = path.normalize(filePath);
    return Array.from(allowedDirectoryPaths).some(allowedPath => normalizedFilePath.startsWith(allowedPath));
  };

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
    try {
      // Define a specific subfolder for the cache
      const cachePath = path.join(app.getPath('userData'), 'ImageMetaHubCache');
      return { success: true, path: cachePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Handle starting the update download
  ipcMain.handle('start-update-download', async () => {
    if (autoUpdater) {
      try {
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (error) {
        console.error('Error starting update download:', error);
        return { success: false, error: error.message };
      }
    }
    return { success: false, error: 'Auto-updater not available' };
  });

  // Handle installing the update
  ipcMain.handle('install-update', () => {
    if (autoUpdater) {
      autoUpdater.quitAndInstall();
    }
  });

  ipcMain.handle('get-theme', () => {
    return {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors
    };
  });

  ipcMain.handle('toggle-fullscreen', () => {
    if (mainWindow) {
      const isFullScreen = mainWindow.isFullScreen();
      mainWindow.setFullScreen(!isFullScreen);
    }
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // Handle copying image to clipboard
  ipcMain.handle('copy-image-to-clipboard', async (event, imageData) => {
    try {
      // imageData should be a base64 string or buffer
      if (!imageData) {
        return { success: false, error: 'No image data provided' };
      }

      // If it's a base64 string, convert to buffer
      let buffer;
      if (typeof imageData === 'string' && imageData.startsWith('data:image/')) {
        // Remove data URL prefix and convert to buffer
        const base64Data = imageData.split(',')[1];
        buffer = Buffer.from(base64Data, 'base64');
      } else if (Buffer.isBuffer(imageData)) {
        buffer = imageData;
      } else {
        return { success: false, error: 'Invalid image data format' };
      }

      // Create NativeImage from buffer
      const image = nativeImage.createFromBuffer(buffer);
      if (image.isEmpty()) {
        return { success: false, error: 'Failed to create image from buffer' };
      }

      // Write to clipboard as image
      clipboard.writeImage(image);
      return { success: true };
    } catch (error) {
      console.error('Error copying image to clipboard:', error);
      return { success: false, error: error.message };
    }
  });

  // --- End Settings IPC ---

  // Handle updating the set of allowed directories for file operations
  ipcMain.handle('update-allowed-paths', (event, paths) => {
    try {
      if (!Array.isArray(paths)) {
        return { success: false, error: 'Invalid paths provided. Must be an array.' };
      }
      allowedDirectoryPaths.clear();
      for (const p of paths) {
        const normalized = path.normalize(p);
        allowedDirectoryPaths.add(normalized);
        console.log('[Main] Added allowed directory:', normalized);
      }
      console.log('[Main] Total allowed directories:', allowedDirectoryPaths.size);
      return { success: true };
    } catch (error) {
      console.error('Error updating allowed paths:', error);
      return { success: false, error: error.message };
    }
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
  ipcMain.handle('trash-file', async (event, filePath) => {
    try {
      if (!isPathAllowed(filePath)) {
        console.error('SECURITY VIOLATION: Attempted to trash file outside of allowed directories.');
        return { success: false, error: 'Access denied: Cannot trash files outside of the allowed directories.' };
      }

      console.log('Attempting to trash file:', filePath);
      await shell.trashItem(filePath);
      return { success: true };
    } catch (error) {
      console.error('Error trashing file:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle file renaming
  ipcMain.handle('rename-file', async (event, oldPath, newPath) => {
    try {
      if (!isPathAllowed(oldPath) || !isPathAllowed(newPath)) {
        console.error('SECURITY VIOLATION: Attempted to rename file outside of allowed directories.');
        return { success: false, error: 'Access denied: Cannot rename files outside of the allowed directories.' };
      }
      
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
      if (!isPathAllowed(filePath)) {
        console.error('SECURITY VIOLATION: Attempted to show item outside of allowed directories.');
        return { success: false, error: 'Access denied: Cannot show items outside of the allowed directories.' };
      }

      const normalizedFilePath = path.normalize(filePath);
      console.log('📂 Attempting to show item in folder:', normalizedFilePath);

      // Verify the file exists before trying to show it
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

  ipcMain.handle('list-subfolders', async (event, folderPath) => {
    try {
      if (!isPathAllowed(folderPath)) {
        console.error('SECURITY VIOLATION: Attempted to list subfolders outside of allowed directories.');
        return { success: false, error: 'Access denied: Cannot list subfolders outside of the allowed directories.' };
      }

      const normalizedPath = path.normalize(folderPath);
      console.log('📂 Listing subfolders for:', normalizedPath);

      // Verify the folder exists
      try {
        const stats = await fs.stat(normalizedPath);
        if (!stats.isDirectory()) {
          console.error('❌ Path is not a directory:', normalizedPath);
          return { success: false, error: 'Path is not a directory' };
        }
      } catch (accessError) {
        console.error('❌ Folder does not exist:', normalizedPath, accessError);
        return { success: false, error: `Folder does not exist: ${normalizedPath}` };
      }

      // Read directory and filter to only directories
      const entries = await fs.readdir(normalizedPath, { withFileTypes: true });
      const subfolders = entries
        .filter(entry => entry.isDirectory())
        .map(entry => ({
          name: entry.name,
          path: path.join(normalizedPath, entry.name)
        }));

      console.log(`✅ Found ${subfolders.length} subfolders in ${normalizedPath}`);
      return { success: true, subfolders };
    } catch (error) {
      console.error('❌ Error listing subfolders:', error);
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

  // TEST ONLY: Simulate update available dialog
  ipcMain.handle('test-update-dialog', async () => {
    if (!mainWindow) {
      return { success: false, error: 'Main window not available' };
    }
    
    // Simulate update info
    const mockUpdateInfo = {
  version: '0.9.4',
      releaseNotes: `## [0.9.4] - Critical Linux Fix

### Added
- Multiple Directory Support: Add and manage multiple image directories simultaneously
- New Settings Modal: Configure cache location and automatic update preferences
- Resizable Image Grid: Adjustable thumbnail sizes for better display on high-resolution screens
- Command-Line Directory Support: Specify startup directory via command-line arguments

### Fixed
- Cross-platform path construction issues resolved
- Improved file operations reliability
- Fixed cached image loading problems`
    };

    // Extract and format changelog
    let changelogText = 'No release notes available.';
    
    if (mockUpdateInfo.releaseNotes) {
      changelogText = mockUpdateInfo.releaseNotes
        .replace(/#{1,6}\s/g, '') // Remove markdown headers
        .replace(/\*\*/g, '') // Remove bold markers
        .replace(/\*/g, '•') // Convert asterisks to bullets
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .trim();
    }

    // Limit changelog length
    if (changelogText.length > 500) {
      changelogText = changelogText.substring(0, 497) + '...';
    }

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '🎉 Update Available (TEST)',
      message: `Version ${mockUpdateInfo.version} is ready to download!`,
      detail: `What's new:\n\n${changelogText}\n\nWould you like to download this update now?`,
      buttons: ['Download Now', 'Download Later', 'Skip this version'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });

    return { success: true, response: result.response };
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

      if (!isPathAllowed(filePath)) {
        console.error('SECURITY VIOLATION: Attempted to read file outside of allowed directories.');
        console.error('  [read-file] Requested path:', filePath);
        console.error('  [read-file] Normalized path:', path.normalize(filePath));
        console.error('  [read-file] Allowed directories:', Array.from(allowedDirectoryPaths));
        return { success: false, error: 'Access denied: Cannot read files outside of the allowed directories.' };
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

  // Handle reading multiple files in a batch
  ipcMain.handle('read-files-batch', async (event, filePaths) => {
    try {
      if (!Array.isArray(filePaths) || filePaths.length === 0) {
        return { success: false, error: 'No file paths provided' };
      }

      // --- SECURITY CHECK ---
      for (const filePath of filePaths) {
        if (!isPathAllowed(filePath)) {
          console.error('SECURITY VIOLATION: Attempted to read file outside of allowed directories.');
          console.error('  Requested path:', filePath);
          console.error('  Normalized path:', path.normalize(filePath));
          console.error('  Allowed directories:', Array.from(allowedDirectoryPaths));
          return { success: false, error: 'Access denied: Cannot read files outside of the allowed directories.' };
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
      if (!isPathAllowed(filePath)) {
        console.error('SECURITY VIOLATION: Attempted to get stats for file outside of allowed directories.');
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

  // Handle path joining
  ipcMain.handle('join-paths', async (event, ...paths) => {
    try {
      if (!paths || paths.length === 0) {
        return { success: false, error: 'No paths provided to join' };
      }
      // Use path.resolve to ensure we get an absolute path
      const joinedPath = path.resolve(...paths);
      return { success: true, path: joinedPath };
    } catch (error) {
      console.error('Error joining paths:', error);
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
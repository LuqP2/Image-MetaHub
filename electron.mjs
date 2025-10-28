import electron from 'electron';
const { app, BrowserWindow, shell, dialog, ipcMain, nativeTheme, Menu } = electron;
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

    // Check if user previously skipped this version
    if (skippedVersions.has(info.version)) {
      console.log('User previously skipped version', info.version, '- not showing dialog');
      return;
    }

    if (mainWindow) {
      // Extract and format changelog from release notes
      let changelogText = 'No release notes available.';
      
      if (info.releaseNotes) {
        if (typeof info.releaseNotes === 'string') {
          // Clean up markdown formatting for dialog display
          changelogText = info.releaseNotes
            .replace(/#{1,6}\s/g, '') // Remove markdown headers
            .replace(/\*\*/g, '') // Remove bold markers
            .replace(/\*/g, '•') // Convert asterisks to bullets
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .trim();
        } else if (Array.isArray(info.releaseNotes)) {
          changelogText = info.releaseNotes
            .map(note => note.note || '')
            .join('\n')
            .trim();
        }
      }

      // Limit changelog length for dialog (show main highlights only)
      if (changelogText.length > 400) {
        changelogText = changelogText.substring(0, 397) + '...';
      }

      // If still "No release notes available", try to extract from other fields
      if (changelogText === 'No release notes available.' && info.releaseName) {
        changelogText = `Release: ${info.releaseName}`;
      }

      // Add link to full changelog
      const changelogUrl = `https://github.com/LuqP2/image-metahub/releases/tag/v${info.version}`;
      const fullMessage = `What's new:\n\n${changelogText}\n\nView full changelog: ${changelogUrl}\n\nWould you like to download this update now?`;

      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '🎉 Update Available',
        message: `Version ${info.version} is ready to download!`,
        detail: fullMessage,
        buttons: ['Download Now', 'Download Later', 'Skip this version'],
        defaultId: 0,
        cancelId: 2,
        noLink: true
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

  // Create application menu
  createApplicationMenu();

  // Set window title to include version (keeps it accurate across builds)
  try {
    const appVersion = app.getVersion();
    mainWindow.setTitle(`Image MetaHub v${appVersion}`);
  } catch (e) {
    // Fallback if app.getVersion is not available
    mainWindow.setTitle('Image MetaHub v0.9.5-rc');
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
                    const fileType = lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg';
                    files.push({
                        name: path.relative(baseDirectory, fullPath).replace(/\\/g, '/'),
                        lastModified: stats.birthtimeMs,
                        size: stats.size,
                        type: fileType
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

  ipcMain.handle('get-theme', () => {
    return {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors
    };
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });
  // --- End Settings IPC ---

  // --- Cache IPC Handlers ---
  const getCacheFilePath = (cacheId) => {
    const safeCacheId = cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(app.getPath('userData'), `${safeCacheId}.json`);
  };

  ipcMain.handle('get-cached-data', async (event, cacheId) => {
    const filePath = getCacheFilePath(cacheId);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return { success: true, data: JSON.parse(data) };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { success: true, data: null }; // File not found is not an error
      }
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-cache-summary', async (event, cacheId) => {
    const filePath = getCacheFilePath(cacheId);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return { success: true, data: JSON.parse(data) };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { success: true, data: null };
      }
      return { success: false, error: error.message };
    }
  });

  const CHUNK_SIZE = 5000; // Store 5000 images per chunk file

  ipcMain.handle('cache-data', async (event, { cacheId, data }) => {
    const safeCacheId = cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const { metadata, ...cacheRecord } = data;
    const cacheDir = path.join(app.getPath('userData'), 'json_cache');
    await fs.mkdir(cacheDir, { recursive: true });

    // Write chunk files
    const chunkCount = Math.ceil(metadata.length / CHUNK_SIZE);
    for (let i = 0; i < chunkCount; i++) {
      const chunk = metadata.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const chunkPath = path.join(cacheDir, `${safeCacheId}_${i}.json`);
      await fs.writeFile(chunkPath, JSON.stringify(chunk));
    }

    // Write main cache record (without metadata)
    const mainCachePath = getCacheFilePath(cacheId);
    cacheRecord.chunkCount = chunkCount;
    await fs.writeFile(mainCachePath, JSON.stringify(cacheRecord, null, 2));

    return { success: true };
  });

  ipcMain.handle('prepare-cache-write', async (event, { cacheId }) => {
    try {
      const safeCacheId = cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');
      const cacheDir = path.join(app.getPath('userData'), 'json_cache');
      await fs.mkdir(cacheDir, { recursive: true });

      try {
        const files = await fs.readdir(cacheDir);
        await Promise.all(
          files
            .filter(file => file.startsWith(`${safeCacheId}_`))
            .map(file => fs.unlink(path.join(cacheDir, file)).catch(err => {
              if (err.code !== 'ENOENT') throw err;
            }))
        );
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('write-cache-chunk', async (event, { cacheId, chunkIndex, data }) => {
    try {
      const safeCacheId = cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');
      const cacheDir = path.join(app.getPath('userData'), 'json_cache');
      await fs.mkdir(cacheDir, { recursive: true });
      const chunkPath = path.join(cacheDir, `${safeCacheId}_${chunkIndex}.json`);
      await fs.writeFile(chunkPath, JSON.stringify(data));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('finalize-cache-write', async (event, { cacheId, record }) => {
    try {
      const mainCachePath = getCacheFilePath(cacheId);
      await fs.writeFile(mainCachePath, JSON.stringify(record, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-cache-chunk', async (event, { cacheId, chunkIndex }) => {
    const safeCacheId = cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const cacheDir = path.join(app.getPath('userData'), 'json_cache');
    const chunkPath = path.join(cacheDir, `${safeCacheId}_${chunkIndex}.json`);
    try {
      const data = await fs.readFile(chunkPath, 'utf-8');
      return { success: true, data: JSON.parse(data) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clear-cache-data', async (event, cacheId) => {
    const safeCacheId = cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const cacheDir = path.join(app.getPath('userData'), 'json_cache');
    const mainCachePath = getCacheFilePath(cacheId);

    try {
        // Delete main cache file
        await fs.unlink(mainCachePath).catch(err => {
            if (err.code !== 'ENOENT') throw err;
        });

        // Delete chunk files
        const files = await fs.readdir(cacheDir);
        for (const file of files) {
            if (file.startsWith(`${safeCacheId}_`)) {
                await fs.unlink(path.join(cacheDir, file));
            }
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
  });


  // --- Thumbnail Cache IPC Handlers ---
  const getThumbnailCachePath = async (thumbnailId) => {
    const safeId = thumbnailId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const cacheDir = path.join(app.getPath('userData'), 'thumbnails');
    await fs.mkdir(cacheDir, { recursive: true });
    return path.join(cacheDir, `${safeId}.webp`);
  };

  ipcMain.handle('get-thumbnail', async (event, thumbnailId) => {
    const filePath = await getThumbnailCachePath(thumbnailId);
    try {
      const data = await fs.readFile(filePath);
      return { success: true, data };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { success: true, data: null }; // Not an error
      }
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('cache-thumbnail', async (event, { thumbnailId, data }) => {
    const filePath = await getThumbnailCachePath(thumbnailId);
    try {
      await fs.writeFile(filePath, data);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clear-metadata-cache', async () => {
    try {
      const cacheDir = path.join(app.getPath('userData'), 'json_cache');
      if (fs.existsSync(cacheDir)) {
        await fs.promises.rm(cacheDir, { recursive: true, force: true });
        await fs.promises.mkdir(cacheDir, { recursive: true });
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clear-thumbnail-cache', async () => {
    try {
      const cacheDir = path.join(app.getPath('userData'), 'thumbnails');
      if (fs.existsSync(cacheDir)) {
        await fs.promises.rm(cacheDir, { recursive: true, force: true });
        await fs.promises.mkdir(cacheDir, { recursive: true });
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  // --- End Thumbnail Cache IPC Handlers ---
  // --- End Cache IPC Handlers ---


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
  version: '0.9.5-rc',
      releaseNotes: `## [0.9.5-rc] - Release Candidate

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
              const fileType = name.endsWith('.png') ? 'image/png' : 'image/jpeg';
              imageFiles.push({
                name: file.name, // name is already relative for top-level
                lastModified: stats.birthtimeMs,
                size: stats.size,
                type: fileType
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
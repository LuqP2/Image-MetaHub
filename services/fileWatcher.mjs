import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';

// Active watchers: directoryId -> watcher instance
const activeWatchers = new Map();

// Pending files for batching (directoryId -> Map(filePath -> { forceReindex }))
const pendingFiles = new Map();
const pendingRemovals = new Map();
const processingTimeouts = new Map();
const removalTimeouts = new Map();

const WATCHER_READY_TIMEOUT_MS = 10000;

const shouldUsePolling = (dirPath) => {
  if (process.env.IMH_FORCE_POLLING === 'true') {
    return true;
  }
  return dirPath.startsWith('\\\\');
};

const isPermissionError = (error) => {
  const code = error?.code;
  return code === 'EPERM' || code === 'EACCES';
};

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mkv', '.mov', '.avi'];

const isMediaFile = (filePath) => IMAGE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());

const toRelativePath = (rootPath, targetPath) => {
  const relativePath = path.relative(rootPath, targetPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return path.basename(targetPath);
  }
  return relativePath.replace(/\\/g, '/');
};

const sendWatcherDebug = (mainWindow, message) => {
  console.log(message);
  sendToRenderer(mainWindow, 'watcher-debug', { message });
};

const sendToRenderer = (mainWindow, channel, payload) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  const contents = mainWindow.webContents;
  if (!contents || contents.isDestroyed()) {
    return false;
  }

  try {
    contents.send(channel, payload);
    return true;
  } catch {
    return false;
  }
};

/**
 * Start watching a directory.
 */
export function startWatching(directoryId, dirPath, mainWindow) {
  if (activeWatchers.has(directoryId)) {
    return { success: true };
  }

  try {
    sendWatcherDebug(mainWindow, `[FileWatcher] startWatching called - ID: ${directoryId}, Path: ${dirPath}`);
    sendWatcherDebug(mainWindow, `[FileWatcher] Creating new watcher for ${directoryId} with depth: 99`);

    const usePolling = shouldUsePolling(dirPath);
    if (usePolling) {
      const driveMatch = /^[a-zA-Z]:/.exec(dirPath);
      const driveLabel = driveMatch ? driveMatch[0].toLowerCase() : 'network';
      sendWatcherDebug(mainWindow, `[FileWatcher] Using polling for ${directoryId} (${driveLabel})`);
    }

    const watcher = chokidar.watch(dirPath, {
      ignored: [
        '**/.thumbnails/**',
        '**/thumbnails/**',
        '**/.cache/**',
        '**/node_modules/**',
        '**/.git/**',
      ],
      persistent: true,
      ignoreInitial: true,
      ignorePermissionErrors: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      },
      depth: 99,
      ...(usePolling ? { usePolling: true, interval: 1000, binaryInterval: 1000 } : {})
    });

    const readyTimeout = setTimeout(() => {
      sendWatcherDebug(mainWindow, `[FileWatcher] Watcher timeout - assuming active for ${directoryId}`);
    }, WATCHER_READY_TIMEOUT_MS);

    sendWatcherDebug(mainWindow, `[FileWatcher] Watcher created for ${directoryId} - waiting for ready event...`);

    watcher.on('ready', () => {
      clearTimeout(readyTimeout);
      sendWatcherDebug(mainWindow, `[FileWatcher] Watcher ready for ${directoryId} - monitoring: ${dirPath}`);
    });

    const enqueueImage = (imagePath, forceReindex = false) => {
      sendWatcherDebug(mainWindow, `[FileWatcher] File detected: ${imagePath}`);
      if (!pendingFiles.has(directoryId)) {
        pendingFiles.set(directoryId, new Map());
      }
      sendWatcherDebug(mainWindow, `[FileWatcher] Adding image to batch: ${imagePath}`);
      const pendingMap = pendingFiles.get(directoryId);
      const existing = pendingMap.get(imagePath);
      pendingMap.set(imagePath, { forceReindex: Boolean(existing?.forceReindex || forceReindex) });

      if (processingTimeouts.has(directoryId)) {
        clearTimeout(processingTimeouts.get(directoryId));
      }

      processingTimeouts.set(directoryId, setTimeout(() => {
        processBatch(directoryId, dirPath, mainWindow);
      }, 500));
    };

    watcher.on('add', (filePath) => {
      const ext = path.extname(filePath).toLowerCase();

      if (ext === '.json') {
        const basePath = filePath.slice(0, -ext.length);
        const matches = IMAGE_EXTENSIONS
          .map((imageExt) => `${basePath}${imageExt}`)
          .filter((candidate) => fs.existsSync(candidate));
        if (matches.length === 0) {
          return;
        }
        matches.forEach((match) => enqueueImage(match, true));
        return;
      }

      if (!IMAGE_EXTENSIONS.includes(ext)) {
        return;
      }

      enqueueImage(filePath, false);
    });

    watcher.on('change', (filePath) => {
      if (!isMediaFile(filePath) && path.extname(filePath).toLowerCase() !== '.json') {
        return;
      }

      if (path.extname(filePath).toLowerCase() === '.json') {
        const basePath = filePath.slice(0, -path.extname(filePath).length);
        IMAGE_EXTENSIONS
          .map((imageExt) => `${basePath}${imageExt}`)
          .filter((candidate) => fs.existsSync(candidate))
          .forEach((match) => enqueueImage(match, true));
        return;
      }

      enqueueImage(filePath, true);
    });

    const enqueueRemoval = (removedPath, kind) => {
      sendWatcherDebug(mainWindow, `[FileWatcher] ${kind === 'folder' ? 'Folder' : 'File'} removed: ${removedPath}`);
      if (!pendingRemovals.has(directoryId)) {
        pendingRemovals.set(directoryId, { files: new Map(), folders: new Map() });
      }

      const relativePath = toRelativePath(dirPath, removedPath);
      const targetMap = kind === 'folder'
        ? pendingRemovals.get(directoryId).folders
        : pendingRemovals.get(directoryId).files;

      targetMap.set(removedPath, {
        name: path.basename(removedPath),
        path: removedPath,
        relativePath,
      });

      if (removalTimeouts.has(directoryId)) {
        clearTimeout(removalTimeouts.get(directoryId));
      }

      removalTimeouts.set(directoryId, setTimeout(() => {
        processRemovalBatch(directoryId, mainWindow);
      }, 500));
    };

    watcher.on('unlink', (filePath) => {
      if (!isMediaFile(filePath)) {
        return;
      }
      enqueueRemoval(filePath, 'file');
    });

    watcher.on('unlinkDir', (folderPath) => {
      enqueueRemoval(folderPath, 'folder');
    });

    watcher.on('error', (error) => {
      if (isPermissionError(error)) {
        sendWatcherDebug(mainWindow, `[FileWatcher] Watcher permission error for ${directoryId}: ${error.message || error}`);
        return;
      }

      console.error(`Watcher error for ${directoryId}:`, error);
      sendWatcherDebug(mainWindow, `[FileWatcher] Watcher error for ${directoryId}: ${error.message || error}`);

      const errorMessage = error instanceof Error ? error.message : String(error);
      sendToRenderer(mainWindow, 'watcher-error', {
        directoryId,
        error: errorMessage
      });

      stopWatching(directoryId);
    });

    activeWatchers.set(directoryId, watcher);
    sendWatcherDebug(mainWindow, `[FileWatcher] Watcher successfully created and stored for ${directoryId}`);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Stop watching a directory.
 */
export function stopWatching(directoryId) {
  const watcher = activeWatchers.get(directoryId);

  if (watcher) {
    watcher.close();
    activeWatchers.delete(directoryId);

    if (processingTimeouts.has(directoryId)) {
      clearTimeout(processingTimeouts.get(directoryId));
      processingTimeouts.delete(directoryId);
    }
    if (removalTimeouts.has(directoryId)) {
      clearTimeout(removalTimeouts.get(directoryId));
      removalTimeouts.delete(directoryId);
    }
    pendingFiles.delete(directoryId);
    pendingRemovals.delete(directoryId);
  }

  return { success: true };
}

/**
 * Stop all watchers (called on app quit).
 */
export function stopAllWatchers() {
  for (const [directoryId] of activeWatchers) {
    stopWatching(directoryId);
  }
}

/**
 * Get watcher status.
 */
export function getWatcherStatus(directoryId) {
  return { active: activeWatchers.has(directoryId) };
}

/**
 * Process a batch of detected files.
 */
function processBatch(directoryId, dirPath, mainWindow) {
  const files = pendingFiles.get(directoryId);

  if (!files || files.size === 0) return;

  sendWatcherDebug(mainWindow, `[FileWatcher] Processing batch for ${directoryId}, ${files.size} files`);

  const filePaths = Array.from(files.keys());

  const fileInfos = filePaths.map(filePath => {
    try {
      const stats = fs.statSync(filePath);
      const pendingInfo = files.get(filePath) || {};
      return {
        name: path.basename(filePath),
        path: filePath,
        lastModified: stats.birthtimeMs ?? stats.mtimeMs,
        contentModifiedMs: stats.mtimeMs,
        size: stats.size,
        type: path.extname(filePath).slice(1),
        forceReindex: pendingInfo.forceReindex === true
      };
    } catch (err) {
      console.error(`Error getting stats for ${filePath}:`, err);
      return null;
    }
  }).filter(Boolean);

  if (fileInfos.length > 0) {
    sendWatcherDebug(mainWindow, `[FileWatcher] Sending ${fileInfos.length} files to renderer for directory ${directoryId}`);
    sendToRenderer(mainWindow, 'new-images-detected', {
      directoryId,
      files: fileInfos
    });
  }

  pendingFiles.delete(directoryId);
  processingTimeouts.delete(directoryId);
}

function processRemovalBatch(directoryId, mainWindow) {
  const removals = pendingRemovals.get(directoryId);

  if (!removals || (removals.files.size === 0 && removals.folders.size === 0)) return;

  const files = Array.from(removals.files.values());
  const folders = Array.from(removals.folders.values());
  sendWatcherDebug(mainWindow, `[FileWatcher] Processing removal batch for ${directoryId}, ${files.length} files, ${folders.length} folders`);

  sendToRenderer(mainWindow, 'watched-files-removed', {
    directoryId,
    files,
    folders,
  });

  pendingRemovals.delete(directoryId);
  removalTimeouts.delete(directoryId);
}

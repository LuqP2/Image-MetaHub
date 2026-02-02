import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import { BrowserWindow } from 'electron';
import fs from 'fs';

// Active watchers: directoryId -> watcher instance
const activeWatchers = new Map<string, FSWatcher>();

// Pending files for batching
const pendingFiles = new Map<string, Set<string>>();
const processingTimeouts = new Map<string, NodeJS.Timeout>();

const WATCHER_READY_TIMEOUT_MS = 10000;

const shouldUsePolling = (dirPath: string): boolean => {
  if (process.env.IMH_FORCE_POLLING === 'true') {
    return true;
  }
  return dirPath.startsWith('\\\\');
};

const isPermissionError = (error: any): boolean => {
  const code = error?.code;
  return code === 'EPERM' || code === 'EACCES';
};

const sendWatcherDebug = (mainWindow: BrowserWindow, message: string): void => {
  console.log(message);
  if (!mainWindow?.isDestroyed()) {
    mainWindow.webContents.send('watcher-debug', { message });
  }
};

/**
 * Start watching a directory.
 */
export function startWatching(
  directoryId: string,
  dirPath: string,
  mainWindow: BrowserWindow
): { success: boolean; error?: string } {
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

    watcher.on('add', (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm', '.mkv', '.mov', '.avi'].includes(ext)) {
        return;
      }

      sendWatcherDebug(mainWindow, `[FileWatcher] File detected: ${filePath}`);
      if (!pendingFiles.has(directoryId)) {
        pendingFiles.set(directoryId, new Set());
      }
      sendWatcherDebug(mainWindow, `[FileWatcher] Adding image to batch: ${filePath}`);
      pendingFiles.get(directoryId)!.add(filePath);

      if (processingTimeouts.has(directoryId)) {
        clearTimeout(processingTimeouts.get(directoryId)!);
      }

      processingTimeouts.set(directoryId, setTimeout(() => {
        processBatch(directoryId, dirPath, mainWindow);
      }, 500));
    });

    watcher.on('error', (error) => {
      if (isPermissionError(error)) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        sendWatcherDebug(mainWindow, `[FileWatcher] Watcher permission error for ${directoryId}: ${errorMsg}`);
        return;
      }

      console.error(`Watcher error for ${directoryId}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      sendWatcherDebug(mainWindow, `[FileWatcher] Watcher error for ${directoryId}: ${errorMessage}`);
      mainWindow.webContents.send('watcher-error', {
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
export function stopWatching(directoryId: string): { success: boolean } {
  const watcher = activeWatchers.get(directoryId);

  if (watcher) {
    watcher.close();
    activeWatchers.delete(directoryId);

    if (processingTimeouts.has(directoryId)) {
      clearTimeout(processingTimeouts.get(directoryId)!);
      processingTimeouts.delete(directoryId);
    }
    pendingFiles.delete(directoryId);
  }

  return { success: true };
}

/**
 * Stop all watchers (called on app quit).
 */
export function stopAllWatchers(): void {
  for (const [directoryId] of activeWatchers) {
    stopWatching(directoryId);
  }
}

/**
 * Get watcher status.
 */
export function getWatcherStatus(directoryId: string): { active: boolean } {
  return { active: activeWatchers.has(directoryId) };
}

/**
 * Process a batch of detected files.
 */
function processBatch(
  directoryId: string,
  dirPath: string,
  mainWindow: BrowserWindow
): void {
  const files = pendingFiles.get(directoryId);

  if (!files || files.size === 0) return;

  sendWatcherDebug(mainWindow, `[FileWatcher] Processing batch for ${directoryId}, ${files.size} files`);

  const filePaths = Array.from(files);

  const fileInfos = filePaths.map(filePath => {
    try {
      const stats = fs.statSync(filePath);
      return {
        name: path.basename(filePath),
        path: filePath,
        lastModified: stats.birthtimeMs ?? stats.mtimeMs,
        size: stats.size,
        type: path.extname(filePath).slice(1)
      };
    } catch (err) {
      console.error(`Error getting stats for ${filePath}:`, err);
      return null;
    }
  }).filter(Boolean);

  if (fileInfos.length > 0) {
    sendWatcherDebug(mainWindow, `[FileWatcher] Sending ${fileInfos.length} files to renderer for directory ${directoryId}`);
    mainWindow.webContents.send('new-images-detected', {
      directoryId,
      files: fileInfos
    });
  }

  pendingFiles.delete(directoryId);
  processingTimeouts.delete(directoryId);
}

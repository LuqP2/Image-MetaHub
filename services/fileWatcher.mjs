import { createLibraryWatcher } from './libraryWatcherBackend.mjs';
import path from 'path';
import fs from 'fs';
import { SUPPORTED_MEDIA_EXTENSIONS, inferMimeTypeFromName } from '../utils/mediaTypes.js';
import { normalizeBirthtimeMs, resolveFileSortDate } from '../utils/fileTimestamps.js';
import { isRelativePathInsideRoot, pathApiForPlatform } from '../utils/pathContainment.mjs';

// Active watchers: directoryId -> watcher instance
const activeWatchers = new Map();

// Pending files for batching (directoryId -> Map(filePath -> { forceReindex }))
const pendingFiles = new Map();
const pendingRemovals = new Map();
const processingTimeouts = new Map();
const removalTimeouts = new Map();
const sidecarDirectoryReads = new Map();

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

const isTransientVanishError = (error) => {
  const code = error?.code;
  const syscall = typeof error?.syscall === 'string' ? error.syscall.toLowerCase() : '';
  const message = (error?.message || String(error || '')).toLowerCase();

  if (code === 'ENOENT') {
    return true;
  }

  if (syscall === 'lstat' || message.includes('lstat')) {
    return code === 'UNKNOWN' || code === 'ENOENT' || message.includes('no such file') || message.includes('unknown error');
  }

  return false;
};

const isMediaFile = (filePath) => SUPPORTED_MEDIA_EXTENSIONS.includes(path.extname(filePath).toLowerCase());

const IMAGE_METAHUB_SIDECAR_SUFFIX = '.imagemetahub.json';

export const sidecarMatchesMediaFile = (sidecarFileName, mediaFileName) => {
  const mediaExt = path.extname(mediaFileName);
  if (!SUPPORTED_MEDIA_EXTENSIONS.includes(mediaExt.toLowerCase())) {
    return false;
  }

  if (sidecarFileName.toLowerCase().endsWith(IMAGE_METAHUB_SIDECAR_SUFFIX)) {
    return mediaFileName === sidecarFileName.slice(0, -IMAGE_METAHUB_SIDECAR_SUFFIX.length);
  }

  const sidecarExt = path.extname(sidecarFileName);
  const sidecarBaseName = path.basename(sidecarFileName, sidecarExt);
  return mediaFileName.slice(0, -mediaExt.length) === sidecarBaseName;
};

export const findMediaFilesForSidecar = async (sidecarPath) => {
  const sidecarFileName = path.basename(sidecarPath);
  const sidecarDir = path.dirname(sidecarPath);

  try {
    let read = sidecarDirectoryReads.get(sidecarDir);
    if (!read) {
      read = fs.promises.readdir(sidecarDir, { withFileTypes: true })
        .finally(() => sidecarDirectoryReads.delete(sidecarDir));
      sidecarDirectoryReads.set(sidecarDir, read);
    }
    return (await read)
      .filter((entry) => entry.isFile() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter((fileName) => sidecarMatchesMediaFile(sidecarFileName, fileName))
      .map((fileName) => path.join(sidecarDir, fileName));
  } catch {
    return [];
  }
};

export const toRelativePath = (rootPath, targetPath, platform = process.platform) => {
  const pathApi = pathApiForPlatform(platform);
  const relativePath = pathApi.relative(rootPath, targetPath);
  if (relativePath === '') {
    return '';
  }
  if (!isRelativePathInsideRoot(relativePath, platform)) {
    return pathApi.basename(targetPath);
  }
  return relativePath.replace(/\\/g, '/');
};

export const toProvenanceFileInfo = (fileInfo) => ({
  ...fileInfo,
  type: inferMimeTypeFromName(fileInfo.path || fileInfo.name, null),
});

// Nothing in the renderer subscribes to the 'watcher-debug' channel (checked:
// no electronAPI.onWatcherDebug call anywhere in the app), so sending it was
// a pure-waste IPC round-trip + structured clone on every watcher event
// (multiple per added/removed file). Keep the main-process console.log only.
const sendWatcherDebug = (_mainWindow, message) => {
  console.log(message);
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
export function startWatching(directoryId, dirPath, mainWindow, observers = {}) {
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

    const watcher = createLibraryWatcher(dirPath, {
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
      isRelevantFile: filePath => isMediaFile(filePath) || path.extname(filePath).toLowerCase() === '.json',
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

    let initialScan = watcher.options.backend !== 'windows-recursive';
    watcher.on('ready', () => {
      initialScan = false;
      clearTimeout(readyTimeout);
      sendWatcherDebug(mainWindow, `[FileWatcher] Watcher ready for ${directoryId} - monitoring: ${dirPath}`);
      observers.onReady?.({ useFsEvents: watcher.options.useFsEvents === true, usePolling: watcher.options.usePolling === true });
    });

    let batchChain = Promise.resolve();
    const enqueueMedia = (mediaPath, forceReindex = false, provenanceBytesChanged = true) => {
      if (!pendingFiles.has(directoryId)) {
        pendingFiles.set(directoryId, new Map());
      }
      const pendingMap = pendingFiles.get(directoryId);
      const existing = pendingMap.get(mediaPath);
      pendingMap.set(mediaPath, {
        forceReindex: Boolean(existing?.forceReindex || forceReindex),
        provenanceBytesChanged: Boolean(existing?.provenanceBytesChanged || provenanceBytesChanged),
        initialScan: (existing?.initialScan ?? true) && initialScan && provenanceBytesChanged,
      });

      if (processingTimeouts.has(directoryId)) {
        clearTimeout(processingTimeouts.get(directoryId));
      }

      processingTimeouts.set(directoryId, setTimeout(() => {
        batchChain = batchChain.then(() => processBatch(directoryId, dirPath, mainWindow, watcher, observers))
          .catch(error => console.error('[FileWatcher] Batch failed:', error));
      }, 500));
    };

    const enqueueSidecar = (filePath) => {
      void findMediaFilesForSidecar(filePath).then(matches => {
        if (activeWatchers.get(directoryId) !== watcher) return;
        matches.forEach(match => enqueueMedia(match, true, false));
      });
    };

    watcher.on('add', (filePath) => {
      const ext = path.extname(filePath).toLowerCase();

      if (ext === '.json') {
        enqueueSidecar(filePath);
        return;
      }

      if (!SUPPORTED_MEDIA_EXTENSIONS.includes(ext)) {
        return;
      }

      enqueueMedia(filePath, false);
    });

    watcher.on('change', (filePath) => {
      const ext = path.extname(filePath).toLowerCase();

      if (ext === '.json') {
        enqueueSidecar(filePath);
        return;
      }

      if (!SUPPORTED_MEDIA_EXTENSIONS.includes(ext)) {
        return;
      }

      enqueueMedia(filePath, true);
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
        processRemovalBatch(directoryId, dirPath, mainWindow, observers);
      }, 500));
    };

    watcher.on('unlink', (filePath) => {
      if (path.extname(filePath).toLowerCase() === '.json') {
        enqueueSidecar(filePath);
        return;
      }
      if (!isMediaFile(filePath)) {
        return;
      }
      enqueueRemoval(filePath, 'file');
    });

    watcher.on('unlinkDir', (folderPath) => {
      enqueueRemoval(folderPath, 'folder');
    });

    watcher.on('error', (error) => {
      if (watcher.options.backend === 'windows-recursive' && pendingRemovals.has(directoryId)) {
        clearTimeout(removalTimeouts.get(directoryId));
        processRemovalBatch(directoryId, dirPath, mainWindow, observers);
      }
      if (isPermissionError(error)) {
        sendWatcherDebug(mainWindow, `[FileWatcher] Watcher permission error for ${directoryId}: ${error.message || error}`);
        return;
      }

      if (isTransientVanishError(error)) {
        sendWatcherDebug(mainWindow, `[FileWatcher] Ignoring transient watcher vanish error for ${directoryId}: ${error.message || error}`);
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
async function processBatch(directoryId, dirPath, mainWindow, watcher, observers = {}) {
  if (activeWatchers.get(directoryId) !== watcher) return;
  const files = pendingFiles.get(directoryId);

  if (!files || files.size === 0) return;
  pendingFiles.delete(directoryId);
  processingTimeouts.delete(directoryId);

  sendWatcherDebug(mainWindow, `[FileWatcher] Processing batch for ${directoryId}, ${files.size} files`);

  const filePaths = Array.from(files.keys());

  const fileInfos = [];
  // Bound concurrent stat requests so watcher batches leave room for other IPC.
  for (let offset = 0; offset < filePaths.length; offset += 4) {
    if (activeWatchers.get(directoryId) !== watcher) return;
    const results = await Promise.all(filePaths.slice(offset, offset + 4).map(async filePath => {
    try {
      const stats = await fs.promises.stat(filePath);
      const pendingInfo = files.get(filePath) || {};
      return {
        name: path.basename(filePath),
        path: filePath,
        lastModified: resolveFileSortDate(normalizeBirthtimeMs(stats.birthtimeMs), stats.mtimeMs),
        contentModifiedMs: stats.mtimeMs,
        size: stats.size,
        type: path.extname(filePath).slice(1),
        forceReindex: pendingInfo.forceReindex === true,
        provenanceBytesChanged: pendingInfo.provenanceBytesChanged !== false,
          initialScan: pendingInfo.initialScan === true,
        relativePath: toRelativePath(dirPath, filePath),
      };
    } catch (err) {
      if (isTransientVanishError(err)) {
        sendWatcherDebug(mainWindow, `[FileWatcher] Skipping vanished file during batch processing: ${filePath}`);
        return null;
      }
      console.error(`Error getting stats for ${filePath}:`, err);
      return null;
    }
    }));
    fileInfos.push(...results.filter(Boolean));
  }

  if (fileInfos.length > 0 && activeWatchers.get(directoryId) === watcher) {
    sendWatcherDebug(mainWindow, `[FileWatcher] Sending ${fileInfos.length} files to renderer for directory ${directoryId}`);
    sendToRenderer(mainWindow, 'new-images-detected', {
      directoryId,
      files: fileInfos
    });
    const provenanceFileInfos = fileInfos.map(toProvenanceFileInfo);
    void Promise.resolve(observers.onFilesObserved?.({ rootPath: dirPath, files: provenanceFileInfos }))
      .catch((error) => console.warn('[FileWatcher] Provenance observation failed:', error));
  }

}

function processRemovalBatch(directoryId, dirPath, mainWindow, observers = {}) {
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
  void Promise.resolve(observers.onPathsRemoved?.({ rootPath: dirPath, files, folders }))
    .catch((error) => console.warn('[FileWatcher] Provenance removal observation failed:', error));

  pendingRemovals.delete(directoryId);
  removalTimeouts.delete(directoryId);
}

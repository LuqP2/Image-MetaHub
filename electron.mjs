import electron from 'electron';
const { app, BrowserWindow, shell, dialog, ipcMain, nativeTheme, Menu, nativeImage, screen, protocol, WebContentsView } = electron;
// console.log('📦 Loaded electron module');

import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
// console.log('📦 Loaded electron-updater module, autoUpdater available:', !!autoUpdater);

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import fsSync from 'fs';
import crypto from 'crypto';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as fileWatcher from './services/fileWatcher.mjs';
import archiver from 'archiver';
import {
  buildLauncherScriptContent,
  normalizeLauncherCommand,
  normalizeLauncherWorkingDirectory,
  resolveLauncherWorkingDirectory,
} from './utils/generatorLauncher.mjs';
import {
  inferMimeTypeFromName,
  isSupportedMediaFileName,
} from './utils/mediaTypes.js';
import {
  isComfyUIViewUrlAllowed,
  normalizeComfyUIViewUrl,
} from './utils/comfyUIViewSecurity.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple development check
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const gpuMitigationEnabled = process.env.IMH_DISABLE_GPU === '1' || process.env.IMH_DISABLE_GPU === 'true';
const mediaSafeModeEnabled = process.platform === 'darwin' && (process.env.IMH_MEDIA_SAFE_MODE === '1' || process.env.IMH_MEDIA_SAFE_MODE === 'true');
const audioDiagnosticModeEnabled = process.platform === 'darwin' && (process.env.IMH_AUDIO_DIAGNOSTIC_MODE === '1' || process.env.IMH_AUDIO_DIAGNOSTIC_MODE === 'true');
const enabledMediaCommandLineSwitches = [];
const disabledChromiumFeatures = new Set();

if (gpuMitigationEnabled || mediaSafeModeEnabled) {
  app.disableHardwareAcceleration();
  enabledMediaCommandLineSwitches.push('disable-hardware-acceleration');
  console.warn(`[GPU] Hardware acceleration disabled via ${mediaSafeModeEnabled ? 'IMH_MEDIA_SAFE_MODE' : 'IMH_DISABLE_GPU'}.`);
}

if (mediaSafeModeEnabled) {
  app.commandLine.appendSwitch('disable-accelerated-video-decode');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  enabledMediaCommandLineSwitches.push('disable-accelerated-video-decode', 'disable-gpu-compositing');
  disabledChromiumFeatures.add('AudioServiceSandbox');
  console.warn('[Media] macOS media safe mode enabled via IMH_MEDIA_SAFE_MODE.');
}

if (audioDiagnosticModeEnabled) {
  disabledChromiumFeatures.add('AudioServiceSandbox');
  disabledChromiumFeatures.add('AudioServiceOutOfProcess');
  console.warn('[Media] macOS audio diagnostic mode enabled via IMH_AUDIO_DIAGNOSTIC_MODE.');
}

if (disabledChromiumFeatures.size > 0) {
  const disableFeaturesValue = Array.from(disabledChromiumFeatures).join(',');
  app.commandLine.appendSwitch('disable-features', disableFeaturesValue);
  enabledMediaCommandLineSwitches.push(`disable-features=${disableFeaturesValue}`);
}

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

// Parser version - increment when parser logic changes
// This ensures cache is invalidated when parsing rules change
const PARSER_VERSION = 7; // v7: Add audio media indexing and metadata

const logMainPerf = (event, details = {}) => {
  console.log('[main:perf]', { event, ...details });
};

const elapsedMs = (start) => Number((Date.now() - start).toFixed(2));
const isSlowMainOp = (start, thresholdMs = 500) => Date.now() - start >= thresholdMs;

// Get platform-specific icon
function getIconPath() {
  if (process.platform === 'win32') {
    return path.join(__dirname, 'public', 'icon.ico');
  } else {
    // macOS and Linux prefer PNG
    return path.join(__dirname, 'public', 'logo1.png');
  }
}

const execFileAsync = promisify(execFile);
const DEFAULT_WINDOW_WIDTH = 1400;
const DEFAULT_WINDOW_HEIGHT = 900;
const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 600;
const FILE_STAT_CONCURRENCY = 64;
const MEDIA_PROTOCOL_SCHEME = 'imh-media';
const THUMBNAIL_PROTOCOL_SCHEME = 'imh-thumb';
const THUMBNAIL_CACHE_VERSION = 2;
const THUMBNAIL_MANIFEST_VERSION = 1;
const THUMBNAIL_MANIFEST_FILE = 'thumbnail-manifest-v1.json';
const THUMBNAIL_ALLOWED_EXTENSIONS = new Set(['webp', 'png', 'jpg', 'jpeg']);

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
  {
    scheme: THUMBNAIL_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

const getMimeTypeFromName = (name) => inferMimeTypeFromName(name);

const getSafeFileDetails = async (filePath) => {
  const fileName = path.basename(String(filePath || ''));
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = getMimeTypeFromName(fileName) || null;
  let fileSize = null;

  try {
    const stats = await fs.stat(filePath);
    fileSize = stats.isFile() ? stats.size : null;
  } catch {
    fileSize = null;
  }

  return { fileName, extension, mimeType, fileSize };
};

const redactDiagnosticText = (value, maxLength = 500) => {
  if (typeof value !== 'string') return null;

  return value
    .replace(/[a-zA-Z][a-zA-Z\d+.-]*:\/\/\S+/g, '[redacted-url]')
    .replace(/(?:[A-Za-z]:[\\/]|\/)(?:[^\s"'<>|?*]+[\\/])*[^\s"'<>|?*]*/g, '[redacted-path]')
    .slice(0, maxLength);
};

const getMediaProtocolErrorType = (error) => {
  if (!error) return 'UNKNOWN_ERROR';
  if (error.code === 'ENOENT' || error.message?.includes('no such file')) return 'FILE_NOT_FOUND';
  if (error.code === 'EACCES' || error.code === 'EPERM') return 'PERMISSION_ERROR';
  return 'UNKNOWN_ERROR';
};

const buildMediaProtocolUrl = (filePath) => {
  const normalizedFilePath = path.resolve(filePath);
  return `${MEDIA_PROTOCOL_SCHEME}://local/?path=${encodeURIComponent(normalizedFilePath)}`;
};

const normalizeThumbnailExtension = (extension) => {
  const normalized = String(extension || 'webp').replace(/^\./, '').toLowerCase();
  return THUMBNAIL_ALLOWED_EXTENSIONS.has(normalized) ? normalized : 'webp';
};

const getThumbnailSafeId = (thumbnailId) => {
  const id = String(thumbnailId || '');
  const MAX_FILENAME_LENGTH = 160;

  if (id.length > MAX_FILENAME_LENGTH) {
    return crypto.createHash('md5').update(id).digest('hex');
  }

  return id.replace(/[^a-zA-Z0-9-_]/g, '_');
};

const getThumbnailFileName = (thumbnailId, extension = 'webp') => {
  return `${getThumbnailSafeId(thumbnailId)}.${normalizeThumbnailExtension(extension)}`;
};

const buildThumbnailProtocolUrl = (thumbnailId, extension = 'webp') => {
  const params = new URLSearchParams({
    id: String(thumbnailId || ''),
    ext: normalizeThumbnailExtension(extension),
  });
  return `${THUMBNAIL_PROTOCOL_SCHEME}://local/?${params.toString()}`;
};

const registerMediaProtocol = () => {
  protocol.registerFileProtocol(MEDIA_PROTOCOL_SCHEME, async (request, callback) => {
    let safeDetails = { fileName: null, extension: null, mimeType: null, fileSize: null };
    try {
      const requestUrl = new URL(request.url);
      const requestedPath = requestUrl.searchParams.get('path');
      if (!requestedPath) {
        logProcessEvent({
          kind: 'imh-media-protocol',
          status: 'failed',
          errorType: 'MISSING_PATH',
        });
        callback({ error: -6 });
        return;
      }

      const normalizedFilePath = path.resolve(requestedPath);
      safeDetails = await getSafeFileDetails(normalizedFilePath);
      if (!isPathAllowed(normalizedFilePath)) {
        console.error('SECURITY VIOLATION: Attempted to load media outside of allowed directories.');
        console.error('  [imh-media] Requested path:', requestedPath);
        console.error('  [imh-media] Normalized path:', normalizedFilePath);
        console.error('  [imh-media] Allowed directories:', Array.from(allowedDirectoryPaths));
        logProcessEvent({
          kind: 'imh-media-protocol',
          status: 'failed',
          errorType: 'PERMISSION_DENIED',
          ...safeDetails,
        });
        callback({ error: -10 });
        return;
      }

      await fs.access(normalizedFilePath);
      logProcessEvent({
        kind: 'imh-media-protocol',
        status: 'served',
        ...safeDetails,
      });
      callback({ path: normalizedFilePath });
    } catch (error) {
      console.error('Error serving media protocol request:', error);
      logProcessEvent({
        kind: 'imh-media-protocol',
        status: 'failed',
        errorType: getMediaProtocolErrorType(error),
        errorCode: error?.code ?? null,
        errorMessage: redactDiagnosticText(error?.message),
        ...safeDetails,
      });
      callback({ error: -2 });
    }
  });
};

const registerThumbnailProtocol = () => {
  protocol.registerFileProtocol(THUMBNAIL_PROTOCOL_SCHEME, async (request, callback) => {
    try {
      const requestUrl = new URL(request.url);
      const thumbnailId = requestUrl.searchParams.get('id');
      const extension = normalizeThumbnailExtension(requestUrl.searchParams.get('ext'));

      if (!thumbnailId) {
        callback({ error: -6 });
        return;
      }

      const rootPath = await getCacheRootPath();
      const cacheDir = await getThumbnailCacheDir(rootPath);
      const filePath = path.resolve(cacheDir, getThumbnailFileName(thumbnailId, extension));

      if (!isSameOrChildPath(normalizeAllowedPath(filePath), normalizeAllowedPath(cacheDir))) {
        console.error('SECURITY VIOLATION: Attempted to load thumbnail outside of cache directory.');
        console.error('  [imh-thumb] Requested id:', thumbnailId);
        console.error('  [imh-thumb] Resolved path:', filePath);
        console.error('  [imh-thumb] Cache dir:', cacheDir);
        callback({ error: -10 });
        return;
      }

      await fs.access(filePath);
      callback({ path: filePath });
    } catch (error) {
      console.error('Error serving thumbnail protocol request:', request.url, error);
      callback({ error: -2 });
    }
  });
};

const parseFrameRate = (value) => {
  if (typeof value !== 'string' || !value.includes('/')) {
    return null;
  }
  const [num, den] = value.split('/').map((part) => Number(part));
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return null;
  }
  return num / den;
};

const buildVideoInfoFromProbe = (stream, format) => {
  const frameRate = parseFrameRate(stream?.r_frame_rate) ?? parseFrameRate(stream?.avg_frame_rate);
  const frameCount = typeof stream?.nb_frames === 'string' ? Number(stream.nb_frames) : stream?.nb_frames;
  const durationValue = typeof format?.duration === 'string' ? Number(format.duration) : format?.duration;

  return {
    frame_rate: Number.isFinite(frameRate) ? frameRate : null,
    frame_count: Number.isFinite(frameCount) ? frameCount : null,
    duration_seconds: Number.isFinite(durationValue) ? durationValue : null,
    width: typeof stream?.width === 'number' ? stream.width : null,
    height: typeof stream?.height === 'number' ? stream.height : null,
    codec: stream?.codec_name || null,
    format: format?.format_name || null,
  };
};

const normalizeProbeNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const buildAudioInfoFromProbe = (stream, format) => {
  const durationValue = normalizeProbeNumber(stream?.duration) ?? normalizeProbeNumber(format?.duration);

  return {
    duration_seconds: durationValue,
    codec: stream?.codec_name || null,
    format: format?.format_name || null,
    sample_rate: normalizeProbeNumber(stream?.sample_rate),
    channels: normalizeProbeNumber(stream?.channels),
    bit_rate: normalizeProbeNumber(stream?.bit_rate) ?? normalizeProbeNumber(format?.bit_rate),
  };
};

async function readMediaMetadataWithFfprobe(filePath) {
  const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    filePath,
  ], { encoding: 'utf8' });

  const output = typeof stdout === 'string' ? stdout : stdout.toString('utf8');
  const payload = JSON.parse(output);
  const format = payload?.format ?? {};
  const tags = format.tags ?? {};
  const streams = Array.isArray(payload?.streams) ? payload.streams : [];
  const videoStream = streams.find((stream) => stream?.codec_type === 'video') ?? null;
  const audioStream = streams.find((stream) => stream?.codec_type === 'audio') ?? null;

  return {
    comment: tags.comment,
    description: tags.description,
    title: tags.title,
    video: videoStream ? buildVideoInfoFromProbe(videoStream, format) : buildVideoInfoFromProbe({}, format),
    audio: audioStream ? buildAudioInfoFromProbe(audioStream, format) : null,
  };
}

let mainWindow;
let comfyUIView = null;
let comfyUIViewConfiguredUrl = '';
let comfyUIViewState = {
  url: '',
  title: '',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  visible: false,
  lastLoadFailed: false,
};
let skippedVersions = new Set();
let isManualUpdateCheck = false;

function buildUpdateNotificationPayload(info = {}) {
  const version = info.version || app.getVersion();
  const releaseNotes = Array.isArray(info.releaseNotes)
    ? info.releaseNotes.map((note) => ({
        version: note.version,
        note: String(note.note || '').trim(),
      })).filter((note) => note.note)
    : typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : undefined;

  return {
    version,
    releaseName: info.releaseName,
    releaseNotes,
    releaseDate: info.releaseDate,
    changelogUrl: `https://github.com/LuqP2/Image-MetaHub/releases/tag/v${version}`,
  };
}


// --- Zoom Management ---
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

function getSafeWebContents() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.webContents;
  }
  return null;
}

function setZoomFactor(factor) {
  const contents = getSafeWebContents();
  if (!contents) return;

  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor));
  contents.setZoomFactor(clamped);
  syncComfyUIViewZoomFactor(clamped);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('zoom-factor-changed', clamped);
  }
}

function resetZoom() {
  setZoomFactor(1);
}

function adjustZoom(delta) {
  const contents = getSafeWebContents();
  if (!contents) return;

  const currentZoom = contents.getZoomFactor();
  setZoomFactor(currentZoom + delta);
}

const zoomMenuItems = [
  {
    label: 'Reset Zoom',
    accelerator: 'CmdOrCtrl+0',
    click: resetZoom
  },
  {
    label: 'Zoom In',
    accelerator: 'CmdOrCtrl+=',
    click: () => adjustZoom(ZOOM_STEP)
  },
  {
    label: 'Zoom In (+)',
    accelerator: 'CmdOrCtrl+Plus',
    visible: false,
    click: () => adjustZoom(ZOOM_STEP)
  },
  {
    label: 'Zoom In (Numpad)',
    accelerator: 'CmdOrCtrl+numadd',
    visible: false,
    click: () => adjustZoom(ZOOM_STEP)
  },
  {
    label: 'Zoom Out',
    accelerator: 'CmdOrCtrl+-',
    click: () => adjustZoom(-ZOOM_STEP)
  },
  {
    label: 'Zoom Out (Numpad)',
    accelerator: 'CmdOrCtrl+numsub',
    visible: false,
    click: () => adjustZoom(-ZOOM_STEP)
  }
];

// --- Settings Management ---
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const settingsTempPath = `${settingsPath}.tmp`;
const settingsBackupPath = `${settingsPath}.bak`;
let cachedSettings = null;
let settingsWriteQueue = Promise.resolve();

const SETTINGS_WRITE_RETRY_DELAYS_MS = [0, 50, 150];
const CACHE_CHUNK_REPLACE_RETRY_DELAYS_MS = [0, 75, 200, 500, 1000];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readSettingsFile(filePath) {
  const data = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(data);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid settings payload in ${path.basename(filePath)}`);
  }

  return parsed;
}

async function writeFileAndSync(filePath, data) {
  const handle = await fs.open(filePath, 'w');
  try {
    await handle.writeFile(data, 'utf-8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function replaceFileWithRetry(sourcePath, destinationPath) {
  let lastError = null;

  for (const delayMs of SETTINGS_WRITE_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await delay(delayMs);
    }

    try {
      await fs.rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      lastError = error;

      if (error?.code === 'ENOENT') {
        throw error;
      }
    }
  }

  throw lastError;
}

async function unlinkCacheChunkWithRetry(filePath) {
  let lastError = null;

  for (const delayMs of CACHE_CHUNK_REPLACE_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await delay(delayMs);
    }

    try {
      await fs.unlink(filePath);
      return;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }

      lastError = error;
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') {
        throw error;
      }
    }
  }

  throw lastError;
}

async function renameCacheChunkWithRetry(sourcePath, destinationPath) {
  let lastError = null;

  for (const delayMs of CACHE_CHUNK_REPLACE_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await delay(delayMs);
    }

    try {
      await fs.rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      lastError = error;
      if (error?.code === 'ENOENT') {
        throw error;
      }
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') {
        throw error;
      }
    }
  }

  throw lastError;
}

async function readSettings() {
  // Use cache if available and fresh (optional TTL could be added, but invalidated on save is enough for this app)
  if (cachedSettings) return cachedSettings;

  try {
    cachedSettings = await readSettingsFile(settingsPath);
    return cachedSettings;
  } catch (error) {
    const primaryError = error;

    for (const recoveryPath of [settingsTempPath, settingsBackupPath]) {
      try {
        const recoveredSettings = await readSettingsFile(recoveryPath);
        await replaceFileWithRetry(recoveryPath, settingsPath);
        cachedSettings = recoveredSettings;
        console.warn(`Recovered settings from ${path.basename(recoveryPath)} after primary settings read failed.`);
        return cachedSettings;
      } catch (recoveryError) {
        if (recoveryError?.code !== 'ENOENT') {
          console.warn(`Failed to recover settings from ${path.basename(recoveryPath)}:`, recoveryError);
        }
      }
    }

    if (primaryError?.code !== 'ENOENT') {
      console.warn('Failed to read settings, using defaults:', primaryError);
    }

    // If file doesn't exist or is invalid, return empty object
    return {};
  }
}

async function saveSettings(settings) {
  const serializedSettings = JSON.stringify(settings, null, 2);

  try {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });

    try {
      await fs.copyFile(settingsPath, settingsBackupPath);
    } catch (backupError) {
      if (backupError?.code !== 'ENOENT') {
        console.warn('Failed to refresh settings backup before save:', backupError);
      }
    }

    await fs.rm(settingsTempPath, { force: true });
    await writeFileAndSync(settingsTempPath, serializedSettings);
    await replaceFileWithRetry(settingsTempPath, settingsPath);

    const verifiedSettings = await readSettingsFile(settingsPath);
    if (JSON.stringify(verifiedSettings) !== JSON.stringify(settings)) {
      throw new Error('Settings verification failed after write.');
    }

    await fs.copyFile(settingsPath, settingsBackupPath);
    cachedSettings = settings; // Update cache
    return { success: true };
  } catch (error) {
    cachedSettings = null;
    console.error('Error saving settings:', error);
    try {
      await fs.rm(settingsTempPath, { force: true });
    } catch (cleanupError) {
      console.warn('Failed to clean up temporary settings file:', cleanupError);
    }
    throw error;
  }
}

function queueSettingsUpdate(updater) {
  const applyUpdate = async () => {
    const currentSettings = await readSettings();
    const nextSettings = await updater(currentSettings ?? {});
    await saveSettings(nextSettings);
    return nextSettings;
  };

  const queuedUpdate = settingsWriteQueue.then(applyUpdate, applyUpdate);
  settingsWriteQueue = queuedUpdate.then(
    () => undefined,
    () => undefined,
  );

  return queuedUpdate;
}

function mergeSettingsUpdate(currentSettings, newSettings) {
  const currentAppVersion = app.getVersion();
  const nextSettings = {
    ...currentSettings,
    ...newSettings,
  };

  if (
    currentSettings?.lastViewedVersion === currentAppVersion &&
    newSettings?.lastViewedVersion !== currentAppVersion
  ) {
    nextSettings.lastViewedVersion = currentAppVersion;
  }

  return nextSettings;
}


async function getCacheRootPath() {
  const settings = await readSettings();
  if (settings && typeof settings.cachePath === 'string' && settings.cachePath.trim().length > 0) {
    return settings.cachePath;
  }
  return app.getPath('userData');
}

async function getThumbnailCacheDir(rootPath = null) {
  const resolvedRoot = rootPath || await getCacheRootPath();
  const cacheDir = path.join(resolvedRoot, 'thumbnails');
  await fs.mkdir(cacheDir, { recursive: true });
  return cacheDir;
}

async function getThumbnailCachePath(thumbnailId, extension = 'webp', rootPath = null) {
  const cacheDir = await getThumbnailCacheDir(rootPath);
  return path.join(cacheDir, getThumbnailFileName(thumbnailId, extension));
}

function getThumbnailManifestPath(rootPath) {
  return path.join(rootPath, 'thumbnails', THUMBNAIL_MANIFEST_FILE);
}

const thumbnailManifestStates = new Map();

function createEmptyThumbnailManifest() {
  return {
    version: THUMBNAIL_MANIFEST_VERSION,
    entries: {},
  };
}

async function loadThumbnailManifest(rootPath) {
  const existing = thumbnailManifestStates.get(rootPath);
  if (existing?.loaded) {
    return existing;
  }

  // Wait for loading if already in progress (race condition prevention)
  if (existing?.loadingPromise) {
    await existing.loadingPromise;
    return existing;
  }

  const state = existing || {
    loaded: false,
    manifest: createEmptyThumbnailManifest(),
    writeTimer: null,
    writePromise: Promise.resolve(),
    loadingPromise: null,
  };

  // Create shared loading promise and store state in Map BEFORE I/O
  state.loadingPromise = (async () => {
    try {
      const manifestPath = getThumbnailManifestPath(rootPath);
      const raw = await fs.readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(raw);
      state.manifest = {
        version: THUMBNAIL_MANIFEST_VERSION,
        entries: parsed && typeof parsed.entries === 'object' && parsed.entries
          ? parsed.entries
          : {},
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[ThumbnailManifest] Failed to read thumbnail manifest, starting fresh:', error.message);
      }
      state.manifest = createEmptyThumbnailManifest();
    }

    state.loaded = true;
    state.loadingPromise = null;
  })();

  thumbnailManifestStates.set(rootPath, state);
  await state.loadingPromise;
  return state;
}

function scheduleThumbnailManifestWrite(rootPath, state) {
  if (state.writeTimer) {
    clearTimeout(state.writeTimer);
  }

  state.writeTimer = setTimeout(() => {
    state.writeTimer = null;
    state.writePromise = state.writePromise
      .catch(() => undefined)
      .then(async () => {
        try {
          if (thumbnailManifestStates.get(rootPath) !== state) {
            return;
          }
          const cacheDir = await getThumbnailCacheDir(rootPath);
          const manifestPath = path.join(cacheDir, THUMBNAIL_MANIFEST_FILE);
          if (thumbnailManifestStates.get(rootPath) !== state) {
            return;
          }
          await fs.writeFile(manifestPath, JSON.stringify(state.manifest, null, 2), 'utf8');
        } catch (error) {
          console.warn('[ThumbnailManifest] Failed to write thumbnail manifest:', error.message);
        }
      });
  }, 250);
}

function clearThumbnailManifestState(rootPath) {
  const state = thumbnailManifestStates.get(rootPath);
  if (state?.writeTimer) {
    clearTimeout(state.writeTimer);
    state.writeTimer = null;
  }
  thumbnailManifestStates.delete(rootPath);
}

async function upsertThumbnailManifestEntry(rootPath, entry) {
  const state = await loadThumbnailManifest(rootPath);
  state.manifest.entries[entry.thumbnailId] = {
    ...state.manifest.entries[entry.thumbnailId],
    ...entry,
    manifestVersion: THUMBNAIL_MANIFEST_VERSION,
  };
  scheduleThumbnailManifestWrite(rootPath, state);
}

async function removeThumbnailManifestEntry(rootPath, thumbnailId) {
  const state = await loadThumbnailManifest(rootPath);
  if (!state.manifest.entries[thumbnailId]) {
    return;
  }
  delete state.manifest.entries[thumbnailId];
  scheduleThumbnailManifestWrite(rootPath, state);
}

function buildThumbnailManifestEntry(candidate, thumbnailId, extension, filePath, generatedAt = Date.now()) {
  return {
    imageId: candidate.imageId || candidate.id || null,
    originalRelativePath: candidate.originalRelativePath || candidate.name || null,
    lastModified: Number.isFinite(candidate.lastModified) ? candidate.lastModified : null,
    contentModifiedMs: Number.isFinite(candidate.contentModifiedMs) ? candidate.contentModifiedMs : null,
    fileSize: Number.isFinite(candidate.fileSize) ? candidate.fileSize : null,
    thumbnailId,
    thumbnailKey: thumbnailId,
    fileName: path.basename(filePath),
    extension: normalizeThumbnailExtension(extension),
    generatedAt,
    algorithmVersion: candidate.algorithmVersion || `v${THUMBNAIL_CACHE_VERSION}`,
  };
}

function isManifestEntryCompatible(entry, candidate) {
  if (!entry) {
    return false;
  }

  if (
    Number.isFinite(candidate.lastModified) &&
    Number.isFinite(entry.lastModified) &&
    entry.lastModified !== candidate.lastModified
  ) {
    return false;
  }

  if (
    Number.isFinite(candidate.fileSize) &&
    Number.isFinite(entry.fileSize) &&
    entry.fileSize !== candidate.fileSize
  ) {
    return false;
  }

  return true;
}

async function findCachedThumbnail(rootPath, candidate) {
  if (!candidate?.thumbnailId) {
    return null;
  }

  const state = await loadThumbnailManifest(rootPath);
  
  // Check versioned thumbnail ID first
  let manifestEntry = state.manifest.entries[candidate.thumbnailId];
  if (isManifestEntryCompatible(manifestEntry, candidate)) {
    const extension = manifestEntry.extension || 'webp';
    const filePath = await getThumbnailCachePath(manifestEntry.thumbnailId, extension, rootPath);
    try {
      await fs.access(filePath);
      return {
        thumbnailId: manifestEntry.thumbnailId,
        url: buildThumbnailProtocolUrl(manifestEntry.thumbnailId, extension),
        extension,
        source: 'manifest',
        legacy: false,
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      await removeThumbnailManifestEntry(rootPath, manifestEntry.thumbnailId);
    }
  }

  // Check legacy thumbnail ID in manifest (avoids filesystem scan for users with old cache)
  if (candidate.legacyThumbnailId) {
    manifestEntry = state.manifest.entries[candidate.legacyThumbnailId];
    if (isManifestEntryCompatible(manifestEntry, candidate)) {
      const extension = manifestEntry.extension || 'webp';
      const filePath = await getThumbnailCachePath(manifestEntry.thumbnailId, extension, rootPath);
      try {
        await fs.access(filePath);
        return {
          thumbnailId: manifestEntry.thumbnailId,
          url: buildThumbnailProtocolUrl(manifestEntry.thumbnailId, extension),
          extension,
          source: 'manifest',
          legacy: true,
        };
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        await removeThumbnailManifestEntry(rootPath, manifestEntry.thumbnailId);
      }
    }
  }

  const idsToCheck = [
    { thumbnailId: candidate.thumbnailId, legacy: false },
    ...(candidate.legacyThumbnailId ? [{ thumbnailId: candidate.legacyThumbnailId, legacy: true }] : []),
  ];

  for (const { thumbnailId, legacy } of idsToCheck) {
    for (const extension of ['webp', 'png', 'jpg', 'jpeg']) {
      const filePath = await getThumbnailCachePath(thumbnailId, extension, rootPath);
      try {
        await fs.access(filePath);
        await upsertThumbnailManifestEntry(
          rootPath,
          buildThumbnailManifestEntry(candidate, thumbnailId, extension, filePath)
        );
        return {
          thumbnailId,
          url: buildThumbnailProtocolUrl(thumbnailId, extension),
          extension,
          source: 'filesystem',
          legacy,
        };
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }

  return null;
}

function getDiagnosticsLogPaths() {
  const paths = [];

  try {
    paths.push(path.join(app.getPath('userData'), 'logs', 'process-events.log'));
  } catch (error) {
    console.error('Failed to resolve userData diagnostics log path:', error);
  }

  try {
    paths.push(path.join(app.getPath('logs'), 'process-events.log'));
  } catch (error) {
    console.error('Failed to resolve app logs diagnostics path:', error);
  }

  return [...new Set(paths)];
}

function logProcessEvent(details = {}) {
  try {
    const payload = {
      timestamp: new Date().toISOString(),
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      memoryUsage: process.memoryUsage(),
      ...details,
    };
    const line = `${JSON.stringify(payload)}\n`;

    for (const logPath of getDiagnosticsLogPaths()) {
      fsSync.mkdirSync(path.dirname(logPath), { recursive: true });
      fsSync.appendFileSync(logPath, line, 'utf8');
    }

    const legacyCrashLogPath = path.join(app.getPath('userData'), 'renderer-crashes.log');
    fsSync.appendFileSync(legacyCrashLogPath, line, 'utf8');
  } catch (error) {
    console.error('Failed to write process diagnostics log:', error);
  }
}

const audioServiceCrashSummary = new Map();
let audioServiceCrashTotal = 0;

function logAudioServiceCrashSummary(details = {}) {
  const reason = details?.reason ?? 'unknown';
  const exitCode = details?.exitCode ?? 'unknown';
  const key = `${reason}:${exitCode}`;
  const count = (audioServiceCrashSummary.get(key) ?? 0) + 1;
  audioServiceCrashSummary.set(key, count);
  audioServiceCrashTotal += 1;

  logProcessEvent({
    kind: 'audio-service-crash-summary',
    serviceName: 'audio.mojom.AudioService',
    reason,
    exitCode,
    count,
    totalCount: audioServiceCrashTotal,
  });
}

function registerProcessDiagnostics() {
  logProcessEvent({
    kind: 'app-startup',
    logs: getDiagnosticsLogPaths(),
    gpuMitigationEnabled,
    mediaSafeModeEnabled,
    audioDiagnosticModeEnabled,
    mediaCommandLineSwitches: enabledMediaCommandLineSwitches,
    gpuFeatureStatus: app.getGPUFeatureStatus?.() ?? null,
  });

  app.on('child-process-gone', (_event, details) => {
    console.error('Child process gone:', details);
    logProcessEvent({
      kind: 'child-process-gone',
      type: details?.type ?? null,
      reason: details?.reason ?? null,
      exitCode: details?.exitCode ?? null,
      serviceName: details?.serviceName ?? null,
      name: details?.name ?? null,
    });

    if (details?.serviceName === 'audio.mojom.AudioService') {
      logAudioServiceCrashSummary(details);
    }
  });

  app.on('gpu-process-crashed', (_event, killed) => {
    console.error('GPU process crashed:', { killed });
    logProcessEvent({
      kind: 'gpu-process-crashed',
      killed: Boolean(killed),
    });
  });

  app.on('render-process-gone', (_event, webContents, details) => {
    console.error('App render process gone:', details);
    logProcessEvent({
      kind: 'app-render-process-gone',
      reason: details?.reason ?? null,
      exitCode: details?.exitCode ?? null,
      url: webContents?.getURL?.() ?? null,
    });
  });
}

function sanitizeMediaPlaybackDiagnostics(payload = {}) {
  const safeFileName = payload.fileName ? path.basename(String(payload.fileName)) : null;
  const srcScheme = typeof payload.srcScheme === 'string' ? payload.srcScheme.slice(0, 32) : null;
  const eventName = typeof payload.eventName === 'string' ? payload.eventName.slice(0, 48) : null;
  const safeErrorMessage = redactDiagnosticText(payload.errorMessage);

  return {
    kind: 'media-playback-event',
    mediaKind: payload.mediaKind === 'audio' || payload.mediaKind === 'video' ? payload.mediaKind : 'unknown',
    surface: typeof payload.surface === 'string' ? payload.surface.slice(0, 80) : null,
    eventName,
    fileName: safeFileName,
    srcScheme,
    currentTime: Number.isFinite(payload.currentTime) ? payload.currentTime : null,
    readyState: Number.isFinite(payload.readyState) ? payload.readyState : null,
    networkState: Number.isFinite(payload.networkState) ? payload.networkState : null,
    errorCode: Number.isFinite(payload.errorCode) ? payload.errorCode : null,
    errorMessage: safeErrorMessage,
  };
}

function attachWindowProcessDiagnostics(window) {
  const webContents = window?.webContents;
  if (!webContents) {
    return;
  }

  webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details);
    logProcessEvent({
      kind: 'webcontents-render-process-gone',
      reason: details?.reason ?? null,
      exitCode: details?.exitCode ?? null,
      url: webContents.getURL(),
    });
  });

  webContents.on('unresponsive', () => {
    console.error('Renderer became unresponsive');
    logProcessEvent({
      kind: 'webcontents-unresponsive',
      url: webContents.getURL(),
    });
  });

  webContents.on('responsive', () => {
    logProcessEvent({
      kind: 'webcontents-responsive',
      url: webContents.getURL(),
    });
  });
}
// --- End Settings Management ---

function getMainWindowZoomFactor() {
  const contents = getSafeWebContents();
  if (!contents) {
    return 1;
  }

  const zoomFactor = contents.getZoomFactor();
  return Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
}

function syncComfyUIViewZoomFactor(zoomFactor = getMainWindowZoomFactor()) {
  if (!comfyUIView || comfyUIView.webContents.isDestroyed()) {
    return;
  }

  comfyUIView.webContents.setZoomFactor(zoomFactor);
}

function sanitizeViewBounds(bounds = {}) {
  const zoomFactor = getMainWindowZoomFactor();
  const numberOrZero = (value) => Number.isFinite(value) ? Math.round(value) : 0;
  return {
    x: Math.max(0, numberOrZero(bounds.x * zoomFactor)),
    y: Math.max(0, numberOrZero(bounds.y * zoomFactor)),
    width: Math.max(0, numberOrZero(bounds.width * zoomFactor)),
    height: Math.max(0, numberOrZero(bounds.height * zoomFactor)),
  };
}

function updateComfyUIViewState(patch = {}) {
  const webContents = comfyUIView?.webContents;
  const navigationHistory = webContents?.navigationHistory;
  const navigationState = webContents && !webContents.isDestroyed()
    ? {
        canGoBack: typeof navigationHistory?.canGoBack === 'function'
          ? navigationHistory.canGoBack()
          : false,
        canGoForward: typeof navigationHistory?.canGoForward === 'function'
          ? navigationHistory.canGoForward()
          : false,
      }
    : {};

  comfyUIViewState = {
    ...comfyUIViewState,
    ...patch,
    ...(webContents && !webContents.isDestroyed()
      ? {
          url: webContents.getURL(),
          title: webContents.getTitle(),
          isLoading: webContents.isLoading(),
          ...navigationState,
        }
      : {}),
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('comfy-view-state-changed', comfyUIViewState);
  }

  return comfyUIViewState;
}

function sendComfyUIViewLoadFailed(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('comfy-view-load-failed', payload);
  }
}

function isComfyNavigationAllowed(url) {
  return isComfyUIViewUrlAllowed(url, comfyUIViewConfiguredUrl);
}

async function openExternalIfSafe(url) {
  const parsed = normalizeComfyUIViewUrl(url);
  if (parsed) {
    await shell.openExternal(parsed.toString());
  }
}

function configureComfyUIViewHandlers(view) {
  const contents = view.webContents;

  contents.setWindowOpenHandler(({ url }) => {
    if (isComfyNavigationAllowed(url)) {
      return { action: 'allow' };
    }

    openExternalIfSafe(url).catch((error) => {
      console.warn('Failed to open external ComfyUI URL:', error);
    });
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (isComfyNavigationAllowed(url)) {
      return;
    }

    event.preventDefault();
    openExternalIfSafe(url).catch((error) => {
      console.warn('Failed to open external ComfyUI navigation:', error);
    });
  });

  contents.on('did-start-loading', () => updateComfyUIViewState({ isLoading: true, lastLoadFailed: false }));
  contents.on('did-stop-loading', () => updateComfyUIViewState({ isLoading: false }));
  contents.on('did-navigate', () => updateComfyUIViewState({ lastLoadFailed: false }));
  contents.on('did-navigate-in-page', () => updateComfyUIViewState({ lastLoadFailed: false }));
  contents.on('page-title-updated', () => updateComfyUIViewState());
  contents.on('context-menu', (_event, params) => {
    showEditableTextContextMenu(contents, params);
  });
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) {
      return;
    }

    sendComfyUIViewLoadFailed({
      errorCode,
      errorDescription,
      url: validatedURL,
    });
    view.setVisible(false);
    updateComfyUIViewState({ isLoading: false, lastLoadFailed: true, visible: false });
  });
}

function showEditableTextContextMenu(contents, params) {
  if (!params.isEditable || !contents || contents.isDestroyed()) {
    return;
  }

  const menu = Menu.buildFromTemplate([
    { label: 'Undo', enabled: params.editFlags?.canUndo ?? false, click: () => contents.undo() },
    { label: 'Redo', enabled: params.editFlags?.canRedo ?? false, click: () => contents.redo() },
    { type: 'separator' },
    { label: 'Cut', enabled: params.editFlags?.canCut ?? false, click: () => contents.cut() },
    { label: 'Copy', enabled: params.editFlags?.canCopy ?? false, click: () => contents.copy() },
    { label: 'Paste', enabled: params.editFlags?.canPaste ?? false, click: () => contents.paste() },
    { type: 'separator' },
    { label: 'Select All', enabled: params.editFlags?.canSelectAll ?? true, click: () => contents.selectAll() },
  ]);

  menu.popup({ window: mainWindow });
}

function ensureComfyUIView() {
  if (comfyUIView && !comfyUIView.webContents.isDestroyed()) {
    return comfyUIView;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Main window is not available.');
  }

  if (!WebContentsView) {
    throw new Error('Embedded ComfyUI view is not supported by this Electron version.');
  }

  comfyUIView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      partition: 'persist:imagemetahub-comfyui',
      backgroundThrottling: false,
    },
  });

  comfyUIView.setVisible(false);
  mainWindow.contentView.addChildView(comfyUIView);
  configureComfyUIViewHandlers(comfyUIView);
  syncComfyUIViewZoomFactor();
  updateComfyUIViewState({ visible: false });
  return comfyUIView;
}

async function openComfyUIView({ url, bounds } = {}) {
  const parsed = normalizeComfyUIViewUrl(url);
  if (!parsed) {
    return { success: false, error: 'Invalid ComfyUI URL.' };
  }

  comfyUIViewConfiguredUrl = parsed.toString();
  const view = ensureComfyUIView();

  if (bounds) {
    view.setBounds(sanitizeViewBounds(bounds));
  }

  view.setVisible(true);
  updateComfyUIViewState({ visible: true });

  const currentUrl = view.webContents.getURL();
  if (!currentUrl || comfyUIViewState.lastLoadFailed || !isComfyNavigationAllowed(currentUrl)) {
    try {
      await view.webContents.loadURL(parsed.toString());
    } catch (error) {
      const message = error?.message || '';
      if (!message.includes('ERR_ABORTED') && error?.code !== 'ERR_ABORTED') {
        throw error;
      }
    }
  }

  return { success: true, state: updateComfyUIViewState({ visible: true }) };
}

function waitForComfyUIViewLoad(contents, timeoutMs = 20000) {
  if (!contents || contents.isDestroyed()) {
    return Promise.reject(new Error('ComfyUI view is not open.'));
  }

  if (!contents.isLoading()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for ComfyUI to load.'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      contents.removeListener('did-stop-loading', handleLoaded);
      contents.removeListener('did-fail-load', handleFailed);
    };

    const handleLoaded = () => {
      cleanup();
      resolve();
    };

    const handleFailed = (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) {
        return;
      }
      cleanup();
      reject(new Error(errorDescription || 'Failed to load ComfyUI.'));
    };

    contents.once('did-stop-loading', handleLoaded);
    contents.once('did-fail-load', handleFailed);
  });
}

async function waitForComfyUIRuntime(contents, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!contents || contents.isDestroyed()) {
      throw new Error('ComfyUI view is not open.');
    }

    const isReady = await contents.executeJavaScript(`
      Boolean(
        document.readyState !== 'loading' &&
        (
          window.app ||
          window.comfyAPI ||
          document.querySelector('canvas')
        )
      )
    `, true).catch(() => false);

    if (isReady) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('ComfyUI did not become ready in time.');
}

async function loadWorkflowIntoComfyUIView({ url, bounds, workflow, title, preferNewTab = true } = {}) {
  if (!workflow || typeof workflow !== 'string') {
    return { success: false, error: 'Workflow JSON is required.' };
  }

  const openResult = await openComfyUIView({ url, bounds });
  if (!openResult.success) {
    return openResult;
  }

  const contents = comfyUIView?.webContents;
  if (!contents || contents.isDestroyed()) {
    return { success: false, error: 'ComfyUI view is not open.' };
  }

  const currentUrl = contents.getURL();
  if (!currentUrl || !isComfyNavigationAllowed(currentUrl)) {
    return { success: false, error: 'ComfyUI view is not on the configured server.' };
  }

  await waitForComfyUIViewLoad(contents);
  await waitForComfyUIRuntime(contents);

  const result = await contents.executeJavaScript(`
    (async () => {
      const workflowText = ${JSON.stringify(workflow)};
      const workflowTitle = ${JSON.stringify(title || 'Image MetaHub workflow')};
      const preferNewTab = ${preferNewTab ? 'true' : 'false'};

      const parseWorkflow = () => {
        const parsed = JSON.parse(workflowText);
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Workflow JSON did not contain an object.');
        }

        const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
        const isUiWorkflow = (value) => isRecord(value) && Array.isArray(value.nodes);
        const isPromptGraph = (value) => {
          if (!isRecord(value) || Array.isArray(value.nodes)) {
            return false;
          }
          return Object.values(value).some((node) => isRecord(node) && typeof node.class_type === 'string');
        };

        const promptGraphToWorkflow = (promptGraph) => {
          const entries = Object.entries(promptGraph).filter(([, node]) => isRecord(node) && typeof node.class_type === 'string');
          const idMap = new Map();
          entries.forEach(([nodeId], index) => {
            const numericId = Number(nodeId);
            idMap.set(nodeId, Number.isFinite(numericId) && numericId > 0 ? numericId : index + 1);
          });

          let nextLinkId = 1;
          const links = [];
          const outputSlotsByNode = new Map();

          const ensureOutputSlot = (sourceNodeId, sourceSlot) => {
            const numericSourceId = idMap.get(String(sourceNodeId));
            if (!numericSourceId) {
              return null;
            }

            const outputs = outputSlotsByNode.get(numericSourceId) || [];
            while (outputs.length <= sourceSlot) {
              outputs.push({
                name: outputs.length === 0 ? 'output' : \`output_\${outputs.length}\`,
                type: '*',
                links: [],
                slot_index: outputs.length,
              });
            }
            outputSlotsByNode.set(numericSourceId, outputs);
            return outputs[sourceSlot];
          };

          const nodes = entries.map(([nodeId, node], index) => {
            const inputs = [];
            const widgetsValues = [];
            const nodeInputs = isRecord(node.inputs) ? node.inputs : {};
            const column = index % 4;
            const row = Math.floor(index / 4);

            Object.entries(nodeInputs).forEach(([inputName, inputValue]) => {
              if (Array.isArray(inputValue) && inputValue.length >= 2) {
                const sourceNodeId = String(inputValue[0]);
                const sourceSlot = Number(inputValue[1]) || 0;
                const sourceOutput = ensureOutputSlot(sourceNodeId, sourceSlot);
                const sourceNumericId = idMap.get(sourceNodeId);
                const targetNumericId = idMap.get(nodeId);

                if (sourceOutput && sourceNumericId && targetNumericId) {
                  const linkId = nextLinkId++;
                  sourceOutput.links.push(linkId);
                  inputs.push({
                    name: inputName,
                    type: '*',
                    link: linkId,
                  });
                  links.push([linkId, sourceNumericId, sourceSlot, targetNumericId, inputs.length - 1, '*']);
                }
              } else {
                widgetsValues.push(inputValue);
              }
            });

            return {
              id: idMap.get(nodeId),
              type: node.class_type,
              pos: [80 + column * 320, 80 + row * 210],
              size: [260, Math.max(90, 64 + inputs.length * 24 + widgetsValues.length * 24)],
              flags: {},
              order: index,
              mode: 0,
              inputs,
              outputs: outputSlotsByNode.get(idMap.get(nodeId)) || [],
              properties: {
                'Node name for S&R': node.class_type,
              },
              widgets_values: widgetsValues,
            };
          });

          return {
            last_node_id: Math.max(0, ...Array.from(idMap.values())),
            last_link_id: Math.max(0, nextLinkId - 1),
            nodes,
            links,
            groups: [],
            config: {},
            extra: {},
            version: 0.4,
          };
        };

        const candidates = [
          parsed,
          parsed.workflow,
          parsed.extra_pnginfo?.workflow,
          parsed.extra_data?.extra_pnginfo?.workflow,
        ];

        const uiWorkflow = candidates.find(isUiWorkflow);
        if (uiWorkflow) {
          return uiWorkflow;
        }

        const promptCandidates = [
          parsed.prompt,
          parsed.extra_pnginfo?.prompt,
          parsed.extra_data?.extra_pnginfo?.prompt,
        ];
        const promptGraph = promptCandidates.find(isPromptGraph);
        if (promptGraph) {
          return promptGraphToWorkflow(promptGraph);
        }

        throw new Error('Workflow JSON did not contain a loadable ComfyUI workflow or prompt graph.');
      };

      const app = window.app || window.comfyApp || window.ComfyApp?.instance || null;
      const workflow = parseWorkflow();
      let loadedInNewTab = false;

      const runMaybeAsync = async (candidate) => {
        if (typeof candidate !== 'function') {
          return false;
        }
        const output = candidate();
        if (output && typeof output.then === 'function') {
          await output;
        }
        return true;
      };

      if (preferNewTab) {
        const newTabCandidates = [
          () => app?.workflowManager?.newWorkflow?.(workflowTitle),
          () => app?.workflowManager?.createNewWorkflow?.(workflowTitle),
          () => app?.workflowManager?.openNewWorkflow?.(workflowTitle),
          () => app?.extensionManager?.command?.execute?.('Comfy.NewWorkflow'),
          () => app?.extensionManager?.command?.execute?.('Comfy.NewBlankWorkflow'),
          () => app?.extensionManager?.command?.execute?.('Workspace.NewWorkflow'),
        ];

        for (const candidate of newTabCandidates) {
          try {
            if (await runMaybeAsync(candidate)) {
              loadedInNewTab = true;
              break;
            }
          } catch {
            loadedInNewTab = false;
          }
        }
      }

      if (app?.loadGraphData && typeof app.loadGraphData === 'function') {
        await app.loadGraphData(workflow, true, true);
      } else if (app?.graph?.configure && typeof app.graph.configure === 'function') {
        app.graph.configure(workflow);
        app.graph.change?.();
        app.canvas?.setDirty?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
      } else if (window.graph?.configure && typeof window.graph.configure === 'function') {
        window.graph.configure(workflow);
      } else {
        throw new Error('The ComfyUI frontend did not expose a supported workflow loader.');
      }

      if (workflowTitle && !loadedInNewTab) {
        document.title = workflowTitle;
      }

      return {
        success: true,
        loadedInNewTab,
        fallbackUsed: preferNewTab && !loadedInNewTab,
        message: loadedInNewTab
          ? 'Workflow opened in a new ComfyUI tab.'
          : 'Workflow loaded into the current ComfyUI canvas.',
      };
    })()
  `, true);

  return {
    ...result,
    state: updateComfyUIViewState({ visible: true }),
  };
}

function showComfyUIView(bounds) {
  const view = ensureComfyUIView();
  if (bounds) {
    view.setBounds(sanitizeViewBounds(bounds));
  }
  view.setVisible(true);
  return { success: true, state: updateComfyUIViewState({ visible: true }) };
}

function hideComfyUIView() {
  if (comfyUIView && !comfyUIView.webContents.isDestroyed()) {
    comfyUIView.setVisible(false);
  }
  return { success: true, state: updateComfyUIViewState({ visible: false }) };
}

function disposeComfyUIView(reason = 'disposed') {
  if (!comfyUIView) {
    return { success: true, state: updateComfyUIViewState({ visible: false, isLoading: false }) };
  }

  const view = comfyUIView;
  const contents = view.webContents;
  let lastUrl = comfyUIViewState.url;
  let lastTitle = comfyUIViewState.title;

  try {
    if (contents && !contents.isDestroyed()) {
      lastUrl = contents.getURL() || lastUrl;
      lastTitle = contents.getTitle() || lastTitle;
    }
  } catch {
    // Best effort during native teardown.
  }

  try {
    view.setVisible(false);
  } catch {
    // Ignore native view teardown errors.
  }

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.contentView.removeChildView(view);
    }
  } catch (error) {
    console.warn('Failed to detach ComfyUI embedded view:', error);
  }

  comfyUIView = null;

  try {
    if (contents && !contents.isDestroyed()) {
      contents.close({ waitForBeforeUnload: false });
    }
  } catch (error) {
    console.warn('Failed to close ComfyUI embedded webContents:', error);
  }

  logProcessEvent({
    kind: 'comfy-view-disposed',
    reason,
    url: lastUrl || null,
  });

  return {
    success: true,
    state: updateComfyUIViewState({
      url: lastUrl,
      title: lastTitle,
      visible: false,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
    }),
  };
}

function suspendComfyUIView() {
  return disposeComfyUIView('suspended');
}

function setComfyUIViewBounds(bounds) {
  if (!comfyUIView || comfyUIView.webContents.isDestroyed()) {
    return { success: false, error: 'ComfyUI view is not open.' };
  }
  comfyUIView.setBounds(sanitizeViewBounds(bounds));
  return { success: true, state: updateComfyUIViewState() };
}

const launcherScriptsPath = path.join(app.getPath('userData'), 'launchers');
async function writeLauncherScript(command) {
  const normalizedCommand = normalizeLauncherCommand(command);
  if (!normalizedCommand) {
    throw new Error('No launch command configured. Add one in Settings > Integrations.');
  }

  await fs.mkdir(launcherScriptsPath, { recursive: true });
  const extension = process.platform === 'win32' ? '.cmd' : '.sh';
  const scriptPath = path.join(launcherScriptsPath, `generator-launcher${extension}`);
  const scriptContent = buildLauncherScriptContent(normalizedCommand, process.platform);

  await fs.writeFile(scriptPath, scriptContent, 'utf8');

  if (process.platform !== 'win32') {
    await fs.chmod(scriptPath, 0o755);
  }

  return scriptPath;
}

async function resolveExistingLauncherWorkingDirectory(command, workingDirectory) {
  const resolvedWorkingDirectory = resolveLauncherWorkingDirectory({
    command,
    workingDirectory,
    platform: process.platform,
  });

  if (!resolvedWorkingDirectory) {
    return '';
  }

  const directoryStats = await fs.stat(resolvedWorkingDirectory).catch(() => null);
  if (!directoryStats?.isDirectory()) {
    throw new Error(`Launcher working directory was not found: ${resolvedWorkingDirectory}`);
  }

  return resolvedWorkingDirectory;
}

async function launchGeneratorCommand({ command, workingDirectory }) {
  const scriptPath = await writeLauncherScript(command);
  const launchWorkingDirectory = await resolveExistingLauncherWorkingDirectory(command, workingDirectory);
  const spawnCwd = launchWorkingDirectory || path.dirname(scriptPath);

  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', 'cmd.exe', '/k', scriptPath], {
      cwd: spawnCwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return { scriptPath };
  }

  const child = spawn(scriptPath, {
    cwd: spawnCwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return { scriptPath };
}

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
        ...zoomMenuItems,
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { type: 'separator' },
        ...zoomMenuItems,
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
                isManualUpdateCheck = true;
                await autoUpdater.checkForUpdates();
              } catch (error) {
                isManualUpdateCheck = false;
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

  autoUpdater.on('update-available', async (info) => {
    console.log('Update available:', info.version);
    const wasManual = isManualUpdateCheck;
    isManualUpdateCheck = false;

    if (!wasManual) {
      const settings = await readSettings();
      if (settings.autoUpdate === false) {
        console.log('Auto-update is disabled, silently ignoring cached update-available event.');
        return;
      }
    }

    // Check if user previously skipped this version
    if (skippedVersions.has(info.version)) {
      console.log('User previously skipped version', info.version, '- not showing dialog');
      return;
    }

    if (mainWindow) {
      mainWindow.webContents.send('update-available-notification', buildUpdateNotificationPayload(info));
    } else {
      console.log('Main window not available - not downloading update');
      // Don't download if we can't ask for permission
    }
  });

  autoUpdater.on('update-not-available', () => {
    // console.log('Update not available');
    isManualUpdateCheck = false;
  });

  autoUpdater.on('error', (err) => {
    console.log('Error in auto-updater:', err);
    
    // Special handling for macOS
    if (process.platform === 'darwin') {
      console.log('macOS auto-updater error - this may be due to code signing requirements');
    }
    
    if (mainWindow) {
      mainWindow.webContents.send('update-error-notification', {
        message: err.message || 'Failed to check for updates. Please try again later.',
      });
    }

    isManualUpdateCheck = false;
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

  autoUpdater.on('update-downloaded', async (info) => {
    console.log('Update downloaded:', info.version);
    
    // Safety check just in case
    const wasManual = isManualUpdateCheck;
    if (!wasManual) {
      const settings = await readSettings();
      if (settings.autoUpdate === false) {
        console.log('Auto-update is disabled, silently ignoring cached update-downloaded event. Will install on next start.');
        return;
      }
    }

    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded-notification', buildUpdateNotificationPayload(info));
      isManualUpdateCheck = false;
    } else {
      console.log('Main window not available - update will install on next start');
      // Don't force restart if window is not available
    }
  });
} else {
  console.log('⚠️ Auto-updater not available, skipping event handlers');
}

function clampWindowBoundsToDisplay(bounds, display) {
  const workArea = display?.workArea ?? screen.getPrimaryDisplay().workArea;
  const width = Math.max(MIN_WINDOW_WIDTH, Math.min(bounds?.width ?? DEFAULT_WINDOW_WIDTH, workArea.width));
  const height = Math.max(MIN_WINDOW_HEIGHT, Math.min(bounds?.height ?? DEFAULT_WINDOW_HEIGHT, workArea.height));

  let x = typeof bounds?.x === 'number'
    ? bounds.x
    : workArea.x + Math.round((workArea.width - width) / 2);
  let y = typeof bounds?.y === 'number'
    ? bounds.y
    : workArea.y + Math.round((workArea.height - height) / 2);

  x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width);
  y = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height);

  return { x, y, width, height };
}

function resolveInitialWindowState(settings) {
  const savedWindowState = settings?.windowState;
  const savedBounds = savedWindowState?.bounds;
  const displays = screen.getAllDisplays();

  const preferredDisplay = typeof savedWindowState?.displayId === 'number'
    ? displays.find((display) => display.id === savedWindowState.displayId)
    : null;

  const matchedDisplay = savedBounds
    ? screen.getDisplayMatching({
        x: savedBounds.x ?? 0,
        y: savedBounds.y ?? 0,
        width: savedBounds.width ?? DEFAULT_WINDOW_WIDTH,
        height: savedBounds.height ?? DEFAULT_WINDOW_HEIGHT,
      })
    : null;

  const targetDisplay = preferredDisplay ?? matchedDisplay ?? screen.getPrimaryDisplay();

  return {
    bounds: clampWindowBoundsToDisplay(savedBounds, targetDisplay),
    isMaximized: Boolean(savedWindowState?.isMaximized),
    isFullScreen: Boolean(savedWindowState?.isFullScreen),
  };
}

async function persistWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const bounds = mainWindow.isMaximized() || mainWindow.isFullScreen()
    ? mainWindow.getNormalBounds()
    : mainWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);

  await queueSettingsUpdate((currentSettings) => ({
    ...currentSettings,
    windowState: {
      bounds,
      displayId: display?.id ?? null,
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen(),
    },
  }));
}

async function createWindow(startupDirectory = null) {
  const settings = await readSettings();
  const initialWindowState = resolveInitialWindowState(settings);

  // Create the browser window
  mainWindow = new BrowserWindow({
    ...initialWindowState.bounds,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'default',
    show: false // Don't show until ready
  });

  // Create application menu
  createApplicationMenu();

  // Ensure zoom starts at the default level
  resetZoom();

  // Set window title to include version (keeps it accurate across builds)
  try {
    const appVersion = app.getVersion();
    mainWindow.setTitle(`Image MetaHub v${appVersion}`);
  } catch {
    // Fallback if app.getVersion is not available
    mainWindow.setTitle('Image MetaHub v0.17.1');
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
    if (initialWindowState.isMaximized) {
      mainWindow.maximize();
    }
    if (initialWindowState.isFullScreen) {
      mainWindow.setFullScreen(true);
    }

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

  mainWindow.on('minimize', () => {
    hideComfyUIView();
  });

  mainWindow.on('restore', () => {
    updateComfyUIViewState({ visible: false });
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    showEditableTextContextMenu(mainWindow.webContents, params);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const isZoomModifier = input.control || input.meta;
    if (!isZoomModifier) return;

    const key = input.key?.toLowerCase();
    if (key === '0' || input.code === 'Digit0' || input.code === 'Numpad0') {
      event.preventDefault();
      resetZoom();
      return;
    }

    if (key === '+' || key === '=' || input.code === 'NumpadAdd') {
      event.preventDefault();
      adjustZoom(ZOOM_STEP);
      return;
    }

    if (key === '-' || input.code === 'NumpadSubtract') {
      event.preventDefault();
      adjustZoom(-ZOOM_STEP);
    }
  });

  mainWindow.on('closed', () => {
    disposeComfyUIView('main-window-closed');
    mainWindow = null;
  });

  let persistWindowStateTimer = null;
  const queueWindowStatePersist = () => {
    if (persistWindowStateTimer) {
      clearTimeout(persistWindowStateTimer);
    }

    persistWindowStateTimer = setTimeout(() => {
      persistWindowState().catch((error) => {
        console.error('Failed to persist window state:', error);
      });
    }, 200);
  };

  mainWindow.on('move', queueWindowStatePersist);
  mainWindow.on('resize', queueWindowStatePersist);
  mainWindow.on('close', () => {
    if (persistWindowStateTimer) {
      clearTimeout(persistWindowStateTimer);
      persistWindowStateTimer = null;
    }

    persistWindowState().catch((error) => {
      console.error('Failed to persist window state during close:', error);
    });
  });

  // Track fullscreen state changes and notify renderer
  // These events work on macOS, Windows, and Linux
  mainWindow.on('enter-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fullscreen-changed', { isFullscreen: true });
    }
  });

  mainWindow.on('leave-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fullscreen-changed', { isFullscreen: false });
    }
  });

  // Additional event for Windows/Linux compatibility
  // Some window managers may not fire enter/leave-full-screen consistently
  let lastKnownFullscreenState = false;
  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const currentFullscreenState = mainWindow.isFullScreen();
      // Only send if the state actually changed to avoid excessive updates
      if (currentFullscreenState !== lastKnownFullscreenState) {
        lastKnownFullscreenState = currentFullscreenState;
        mainWindow.webContents.send('fullscreen-state-check', { isFullscreen: currentFullscreenState });
      }
    }
  });

  attachWindowProcessDiagnostics(mainWindow);
}

// App event handlers
app.whenReady().then(async () => {
  registerProcessDiagnostics();
  registerMediaProtocol();
  registerThumbnailProtocol();

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
  
  await createWindow(startupDirectory);
});

// Setup IPC handlers for file operations
// Store allowed directory paths for security
const allowedDirectoryPaths = new Set();

const normalizeAllowedPath = (inputPath) => {
  if (!inputPath) return '';

  const resolvedPath = path.resolve(inputPath);
  const parsedPath = path.parse(resolvedPath);
  const normalizedPath = resolvedPath === parsedPath.root
    ? resolvedPath
    : resolvedPath.replace(/[\\/]+$/, '');

  return process.platform === 'win32'
    ? normalizedPath.toLowerCase()
    : normalizedPath;
};

const isSameOrChildPath = (candidatePath, allowedPath) => {
  if (!candidatePath || !allowedPath) return false;
  if (candidatePath === allowedPath) return true;

  const allowedPrefix = allowedPath.endsWith(path.sep)
    ? allowedPath
    : `${allowedPath}${path.sep}`;

  return candidatePath.startsWith(allowedPrefix);
};

const isPathAllowed = (filePath) => {
  if (allowedDirectoryPaths.size === 0 || !filePath) return false;
  const normalizedFilePath = normalizeAllowedPath(filePath);
  return Array.from(allowedDirectoryPaths).some((allowedPath) => isSameOrChildPath(normalizedFilePath, allowedPath));
};

// Helper function for recursive file search
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let index = 0;

  const worker = async () => {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function statMediaEntries(directory, entries, baseDirectory) {
  const mediaEntries = entries.filter((entry) => {
    if (!entry.isFile()) {
      return false;
    }
    return isSupportedMediaFileName(entry.name);
  });

  const fileRecords = await mapWithConcurrency(mediaEntries, FILE_STAT_CONCURRENCY, async (entry) => {
    const lowerName = entry.name.toLowerCase();
    const fullPath = path.join(directory, entry.name);
    const stats = await fs.stat(fullPath);
    return {
      name: path.relative(baseDirectory, fullPath).replace(/\\/g, '/'),
      lastModified: stats.birthtimeMs ?? stats.mtimeMs,
      contentModifiedMs: stats.mtimeMs,
      size: stats.size,
      type: getMimeTypeFromName(lowerName),
      birthtimeMs: stats.birthtimeMs,
    };
  });

  return fileRecords.filter(Boolean);
}

const IGNORED_SCAN_DIRECTORY_NAMES = new Set([
  'thumbnails',
  '.thumbnails',
  '.cache',
  'node_modules',
  '.git',
]);

function shouldIgnoreScanDirectory(fullPath, baseDirectory) {
  const relativePath = path.relative(baseDirectory, fullPath).replace(/\\/g, '/');
  if (!relativePath || relativePath === '.') {
    return false;
  }

  const segments = relativePath.split('/').filter(Boolean);
  return segments.some((segment) => IGNORED_SCAN_DIRECTORY_NAMES.has(segment.toLowerCase()));
}

async function getFilesRecursively(directory, baseDirectory) {
  const files = [];
  const directoriesToVisit = [directory];
  const start = Date.now();
  let directoriesVisited = 0;
  let directoriesSkipped = 0;

  while (directoriesToVisit.length > 0) {
    const currentDirectory = directoriesToVisit.pop();
    if (!currentDirectory) {
      continue;
    }

    if (shouldIgnoreScanDirectory(currentDirectory, baseDirectory)) {
      directoriesSkipped += 1;
      continue;
    }
    directoriesVisited += 1;

    try {
      const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const nextDirectory = path.join(currentDirectory, entry.name);
          if (!shouldIgnoreScanDirectory(nextDirectory, baseDirectory)) {
            directoriesToVisit.push(nextDirectory);
          }
        }
      }

      const fileRecords = await statMediaEntries(currentDirectory, entries, baseDirectory);
      files.push(...fileRecords);
    } catch (error) {
      // Ignore errors from directories we can't read, e.g. permissions
      console.warn(`Could not read directory ${currentDirectory}: ${error.message}`);
    }
  }

  logMainPerf('list-directory-files:recursive-walk', {
    baseDirectory,
    directoriesVisited,
    directoriesSkipped,
    files: files.length,
    durationMs: elapsedMs(start),
  });
  return files;
}

function setupFileOperationHandlers() {
  const approvedWriteRoots = new Set();
  const registerApprovedWriteRoot = (targetPath) => {
    if (!targetPath) return;
    const normalizedTarget = normalizeAllowedPath(targetPath);
    if (normalizedTarget) {
      approvedWriteRoots.add(normalizedTarget);
    }
  };
  const registerApprovedWriteFilePath = (filePath) => {
    if (!filePath) return;
    registerApprovedWriteRoot(path.dirname(filePath));
  };
  const isApprovedWritePath = (filePath) => {
    if (approvedWriteRoots.size === 0 || !filePath) return false;
    const normalizedFilePath = normalizeAllowedPath(filePath);
    return Array.from(approvedWriteRoots).some(allowedPath => isSameOrChildPath(normalizedFilePath, allowedPath));
  };
  const userDataPath = path.normalize(app.getPath('userData'));
  const isInternalPath = (filePath) => {
    if (!filePath) return false;
    const normalized = path.normalize(filePath);
    return normalized === userDataPath || normalized.startsWith(userDataPath + path.sep);
  };
  const isAllowedOrInternal = (filePath) => isPathAllowed(filePath) || isInternalPath(filePath);
  const isRenameTargetAllowed = (oldPath, newPath) => {
    if (isAllowedOrInternal(newPath)) {
      return true;
    }

    if (!isPathAllowed(oldPath) || !newPath) {
      return false;
    }

    const normalizedOldPath = normalizeAllowedPath(oldPath);
    const normalizedNewPath = normalizeAllowedPath(newPath);
    return path.dirname(normalizedOldPath) === path.dirname(normalizedNewPath);
  };
  const normalizeNameKey = (name) => name.toLowerCase();
  const SMART_LIBRARY_CACHE_KINDS = new Set(['clusters', 'autotags']);
  const getSmartLibraryCachePath = async (cacheId, kind) => {
    const safeCacheId = String(cacheId || '').replace(/[^a-zA-Z0-9-_]/g, '_');
    const safeKind = String(kind || '');
    if (!safeCacheId || !SMART_LIBRARY_CACHE_KINDS.has(safeKind)) {
      throw new Error('Invalid smart library cache key.');
    }

    const cacheDir = path.join(app.getPath('userData'), 'smart-library-cache');
    await fs.mkdir(cacheDir, { recursive: true });
    return path.join(cacheDir, `${safeCacheId}-${safeKind}.json`);
  };
  const getUniqueName = (name, usedNames) => {
    const parsed = path.parse(name);
    let candidate = name;
    let counter = 2;
    while (usedNames.has(normalizeNameKey(candidate))) {
      candidate = `${parsed.name} (${counter})${parsed.ext}`;
      counter += 1;
    }
    usedNames.add(normalizeNameKey(candidate));
    return candidate;
  };
  const getUniqueDestinationPath = async (destDir, baseName, usedNames) => {
    const parsed = path.parse(baseName);
    let candidate = baseName;
    let counter = 2;

    while (true) {
      const candidateKey = normalizeNameKey(candidate);
      const candidatePath = path.resolve(destDir, candidate);

      if (!usedNames.has(candidateKey)) {
        try {
          await fs.access(candidatePath);
        } catch {
          usedNames.add(candidateKey);
          return { candidate, candidatePath };
        }
      }

      candidate = `${parsed.name} (${counter})${parsed.ext}`;
      counter += 1;
    }
  };

  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const PNG_EXPORTABLE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
  const PNG_METADATA_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);
  const WEBP_METADATA_CHUNKS = new Set(['EXIF', 'XMP ']);
  const WEBP_VP8X_EXIF_FLAG = 0x08;
  const WEBP_VP8X_XMP_FLAG = 0x04;
  const activeCanceledExportIds = new Set();

  const createCrc32Table = () => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }
      table[index] = value >>> 0;
    }
    return table;
  };

  const CRC32_TABLE = createCrc32Table();

  const computeCrc32 = (buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  const createPngChunk = (type, data) => {
    const typeBuffer = Buffer.from(type, 'ascii');
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(dataBuffer.length, 0);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(computeCrc32(Buffer.concat([typeBuffer, dataBuffer])), 0);
    return Buffer.concat([lengthBuffer, typeBuffer, dataBuffer, crcBuffer]);
  };

  const createPngTextChunk = (keyword, text) => {
    const keywordBuffer = Buffer.from(keyword, 'utf8');
    const textBuffer = Buffer.from(text, 'utf8');
    return createPngChunk('tEXt', Buffer.concat([keywordBuffer, Buffer.from([0]), textBuffer]));
  };

  const createPngInternationalTextChunk = (keyword, text) => {
    const keywordBuffer = Buffer.from(keyword, 'utf8');
    const textBuffer = Buffer.from(text, 'utf8');
    return createPngChunk(
      'iTXt',
      Buffer.concat([
        keywordBuffer,
        Buffer.from([0, 0, 0, 0, 0]),
        textBuffer,
      ]),
    );
  };

  const appendChunksToPng = (pngBuffer, chunks) => {
    if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length < PNG_SIGNATURE.length + 12) {
      throw new Error('Invalid PNG buffer.');
    }

    if (!pngBuffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error('PNG signature missing.');
    }

    let offset = PNG_SIGNATURE.length;
    while (offset + 12 <= pngBuffer.length) {
      const chunkLength = pngBuffer.readUInt32BE(offset);
      const chunkType = pngBuffer.subarray(offset + 4, offset + 8).toString('ascii');
      const chunkTotalLength = chunkLength + 12;
      if (offset + chunkTotalLength > pngBuffer.length) {
        break;
      }

      if (chunkType === 'IEND') {
        return Buffer.concat([
          pngBuffer.subarray(0, offset),
          ...chunks,
          pngBuffer.subarray(offset),
        ]);
      }

      offset += chunkTotalLength;
    }

    throw new Error('PNG IEND chunk not found.');
  };

  const stripMetadataFromPngBuffer = (pngBuffer) => {
    if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length < PNG_SIGNATURE.length + 12) {
      throw new Error('Invalid PNG buffer.');
    }

    if (!pngBuffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error('PNG signature missing.');
    }

    const outputChunks = [PNG_SIGNATURE];
    let offset = PNG_SIGNATURE.length;

    while (offset + 12 <= pngBuffer.length) {
      const chunkLength = pngBuffer.readUInt32BE(offset);
      const chunkTotalLength = chunkLength + 12;
      if (offset + chunkTotalLength > pngBuffer.length) {
        throw new Error('Corrupted PNG chunk layout.');
      }

      const chunkType = pngBuffer.subarray(offset + 4, offset + 8).toString('ascii');
      const chunkBuffer = pngBuffer.subarray(offset, offset + chunkTotalLength);

      if (!PNG_METADATA_CHUNKS.has(chunkType)) {
        outputChunks.push(chunkBuffer);
      }

      offset += chunkTotalLength;

      if (chunkType === 'IEND') {
        return Buffer.concat(outputChunks);
      }
    }

    throw new Error('PNG IEND chunk not found.');
  };

  const isJpegMarkerStandalone = (marker) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

  const shouldKeepJpegAppSegment = (marker, segmentData) => {
    if (marker === 0xe0) {
      return (
        segmentData.subarray(0, 5).equals(Buffer.from('JFIF\0', 'binary')) ||
        segmentData.subarray(0, 5).equals(Buffer.from('JFXX\0', 'binary'))
      );
    }

    if (marker === 0xe2) {
      return segmentData.subarray(0, 12).equals(Buffer.from('ICC_PROFILE\0', 'binary'));
    }

    if (marker === 0xee) {
      return segmentData.subarray(0, 5).equals(Buffer.from('Adobe', 'binary'));
    }

    return false;
  };

  const stripMetadataFromJpegBuffer = (jpegBuffer) => {
    if (!Buffer.isBuffer(jpegBuffer) || jpegBuffer.length < 4) {
      throw new Error('Invalid JPEG buffer.');
    }

    if (jpegBuffer[0] !== 0xff || jpegBuffer[1] !== 0xd8) {
      throw new Error('JPEG SOI marker missing.');
    }

    const outputChunks = [jpegBuffer.subarray(0, 2)];
    let offset = 2;

    while (offset < jpegBuffer.length) {
      if (jpegBuffer[offset] !== 0xff) {
        outputChunks.push(jpegBuffer.subarray(offset));
        break;
      }

      let markerOffset = offset + 1;
      while (markerOffset < jpegBuffer.length && jpegBuffer[markerOffset] === 0xff) {
        markerOffset += 1;
      }

      if (markerOffset >= jpegBuffer.length) {
        break;
      }

      const marker = jpegBuffer[markerOffset];
      const segmentStart = markerOffset - 1;

      if (marker === 0xd9) {
        outputChunks.push(jpegBuffer.subarray(segmentStart, markerOffset + 1));
        break;
      }

      if (marker === 0xda) {
        outputChunks.push(jpegBuffer.subarray(segmentStart));
        break;
      }

      if (isJpegMarkerStandalone(marker)) {
        outputChunks.push(jpegBuffer.subarray(segmentStart, markerOffset + 1));
        offset = markerOffset + 1;
        continue;
      }

      if (markerOffset + 2 >= jpegBuffer.length) {
        throw new Error('Corrupted JPEG segment length.');
      }

      const segmentLength = jpegBuffer.readUInt16BE(markerOffset + 1);
      const segmentEnd = markerOffset + 1 + segmentLength;
      if (segmentLength < 2 || segmentEnd > jpegBuffer.length) {
        throw new Error('Corrupted JPEG segment bounds.');
      }

      const fullSegment = jpegBuffer.subarray(segmentStart, segmentEnd);
      const segmentData = jpegBuffer.subarray(markerOffset + 3, segmentEnd);
      const isAppMarker = marker >= 0xe0 && marker <= 0xef;
      const shouldDrop =
        marker === 0xfe ||
        (isAppMarker && !shouldKeepJpegAppSegment(marker, segmentData));

      if (!shouldDrop) {
        outputChunks.push(fullSegment);
      }

      offset = segmentEnd;
    }

    return Buffer.concat(outputChunks);
  };

  const createRiffChunk = (type, data) => {
    const typeBuffer = Buffer.from(type, 'ascii');
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const header = Buffer.alloc(8);
    typeBuffer.copy(header, 0);
    header.writeUInt32LE(dataBuffer.length, 4);
    const padding = dataBuffer.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0);
    return Buffer.concat([header, dataBuffer, padding]);
  };

  const stripMetadataFromWebpBuffer = (webpBuffer) => {
    if (!Buffer.isBuffer(webpBuffer) || webpBuffer.length < 12) {
      throw new Error('Invalid WebP buffer.');
    }

    if (webpBuffer.subarray(0, 4).toString('ascii') !== 'RIFF' || webpBuffer.subarray(8, 12).toString('ascii') !== 'WEBP') {
      throw new Error('WEBP RIFF header missing.');
    }

    const outputChunks = [];
    let offset = 12;

    while (offset + 8 <= webpBuffer.length) {
      const chunkType = webpBuffer.subarray(offset, offset + 4).toString('ascii');
      const chunkSize = webpBuffer.readUInt32LE(offset + 4);
      const paddedChunkSize = chunkSize + (chunkSize % 2);
      const chunkEnd = offset + 8 + paddedChunkSize;

      if (chunkEnd > webpBuffer.length) {
        throw new Error('Corrupted WebP chunk bounds.');
      }

      if (!WEBP_METADATA_CHUNKS.has(chunkType)) {
        if (chunkType === 'VP8X' && chunkSize >= 10) {
          const vp8xData = Buffer.from(webpBuffer.subarray(offset + 8, offset + 8 + chunkSize));
          vp8xData[0] &= ~(WEBP_VP8X_EXIF_FLAG | WEBP_VP8X_XMP_FLAG);
          outputChunks.push(createRiffChunk('VP8X', vp8xData));
        } else {
          outputChunks.push(webpBuffer.subarray(offset, chunkEnd));
        }
      }

      offset = chunkEnd;
    }

    const body = Buffer.concat(outputChunks);
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(body.length + 4, 4);
    header.write('WEBP', 8, 'ascii');
    return Buffer.concat([header, body]);
  };

  const stripMetadataFromImageBuffer = (buffer, sourceExtension) => {
    if (sourceExtension === '.png') {
      return stripMetadataFromPngBuffer(buffer);
    }

    if (sourceExtension === '.jpg' || sourceExtension === '.jpeg') {
      return stripMetadataFromJpegBuffer(buffer);
    }

    if (sourceExtension === '.webp') {
      return stripMetadataFromWebpBuffer(buffer);
    }

    throw new Error('This file format can only be exported with metadata preserved in v1.');
  };

  const toLoraPayload = (loras) => {
    if (!Array.isArray(loras)) {
      return [];
    }

    return loras
      .map((entry) => {
        if (typeof entry === 'string') {
          const name = entry.trim();
          return name ? { name } : null;
        }

        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const name = typeof entry.name === 'string' && entry.name.trim()
          ? entry.name.trim()
          : (typeof entry.model_name === 'string' ? entry.model_name.trim() : '');
        if (!name) {
          return null;
        }

        const weight = Number.isFinite(entry.weight)
          ? entry.weight
          : Number.isFinite(entry.model_weight)
            ? entry.model_weight
            : undefined;

        return weight !== undefined ? { name, weight } : { name };
      })
      .filter(Boolean);
  };

  const formatMetadataForA1111Compat = (metadata) => {
    if (!metadata || typeof metadata.prompt !== 'string' || !metadata.prompt.trim()) {
      throw new Error('Prompt is required to generate A1111-compatible metadata.');
    }

    const lines = [metadata.prompt.trim()];
    if (typeof metadata.negativePrompt === 'string' && metadata.negativePrompt.trim()) {
      lines.push(`Negative prompt: ${metadata.negativePrompt.trim()}`);
    }

    const params = [];
    if (Number.isFinite(metadata.steps)) {
      params.push(`Steps: ${metadata.steps}`);
    }

    const sampler = metadata.sampler || metadata.scheduler;
    if (typeof sampler === 'string' && sampler.trim()) {
      params.push(`Sampler: ${sampler.trim()}`);
    }

    if (Number.isFinite(metadata.cfg_scale)) {
      params.push(`CFG scale: ${metadata.cfg_scale}`);
    }

    if (Number.isFinite(metadata.seed)) {
      params.push(`Seed: ${metadata.seed}`);
    }

    if (Number.isFinite(metadata.width) && Number.isFinite(metadata.height) && metadata.width > 0 && metadata.height > 0) {
      params.push(`Size: ${metadata.width}x${metadata.height}`);
    }

    if (typeof metadata.model === 'string' && metadata.model.trim()) {
      params.push(`Model: ${metadata.model.trim()}`);
    }

    if (params.length > 0) {
      lines.push(params.join(', '));
    }

    return lines.join('\n');
  };

  const buildMetaHubExportPayload = (metadata) => ({
    generator: 'Image MetaHub',
    source_generator: typeof metadata?.generator === 'string' ? metadata.generator : null,
    exported_at: new Date().toISOString(),
    prompt: typeof metadata?.prompt === 'string' ? metadata.prompt : '',
    negativePrompt: typeof metadata?.negativePrompt === 'string' ? metadata.negativePrompt : '',
    seed: Number.isFinite(metadata?.seed) ? metadata.seed : undefined,
    steps: Number.isFinite(metadata?.steps) ? metadata.steps : undefined,
    cfg: Number.isFinite(metadata?.cfg_scale) ? metadata.cfg_scale : undefined,
    sampler_name: typeof metadata?.sampler === 'string' ? metadata.sampler : '',
    scheduler: typeof metadata?.scheduler === 'string' ? metadata.scheduler : '',
    model: typeof metadata?.model === 'string' ? metadata.model : '',
    width: Number.isFinite(metadata?.width) ? metadata.width : 0,
    height: Number.isFinite(metadata?.height) ? metadata.height : 0,
    loras: toLoraPayload(metadata?.loras),
    imh_pro: {
      notes: typeof metadata?.notes === 'string' ? metadata.notes : '',
      user_tags: Array.isArray(metadata?.tags) ? metadata.tags.join(', ') : '',
    },
  });

  const buildPngExportBuffer = (pngBuffer, metadataPolicy, effectiveMetadata) => {
    if (metadataPolicy === 'strip') {
      return pngBuffer;
    }

    if (metadataPolicy !== 'metahub_standard') {
      throw new Error(`Unsupported metadata export policy: ${metadataPolicy}`);
    }

    if (!effectiveMetadata) {
      throw new Error('Edited metadata is required for MetaHub export.');
    }

    const metaHubPayload = buildMetaHubExportPayload(effectiveMetadata);
    const parametersText = formatMetadataForA1111Compat(effectiveMetadata);
    return appendChunksToPng(pngBuffer, [
      createPngTextChunk('parameters', parametersText),
      createPngInternationalTextChunk('imagemetahub_data', JSON.stringify(metaHubPayload)),
    ]);
  };

  const createExportArtifact = async ({ sourcePath, relativePath, metadataPolicy = 'preserve', targetFormat = 'original', effectiveMetadata }) => {
    if (metadataPolicy === 'preserve') {
      const buffer = await fs.readFile(sourcePath);
      return {
        buffer,
        fileName: path.basename(relativePath),
      };
    }

    const sourceExtension = path.extname(relativePath).toLowerCase();
    if (!PNG_EXPORTABLE_EXTENSIONS.has(sourceExtension)) {
      throw new Error('This file format can only be exported with metadata preserved in v1.');
    }

    if (metadataPolicy === 'strip' && targetFormat === 'original') {
      const sourceBuffer = await fs.readFile(sourcePath);
      return {
        buffer: stripMetadataFromImageBuffer(sourceBuffer, sourceExtension),
        fileName: path.basename(relativePath),
      };
    }

    const image = nativeImage.createFromPath(sourcePath);
    if (image.isEmpty()) {
      throw new Error('Failed to decode source image for metadata export.');
    }

    const pngBuffer = image.toPNG();
    const exportedBuffer = buildPngExportBuffer(pngBuffer, metadataPolicy, effectiveMetadata);
    const targetExtension = targetFormat === 'original' && sourceExtension === '.png' ? '.png' : '.png';
    const fileName = `${path.parse(relativePath).name}${targetExtension}`;

    return {
      buffer: exportedBuffer,
      fileName,
    };
  };

  // --- Settings IPC ---
  ipcMain.handle('get-settings', async () => {
    const settings = await readSettings();
    return settings;
  });

  ipcMain.handle('save-settings', async (event, newSettings) => {
    try {
      await queueSettingsUpdate((currentSettings) => mergeSettingsUpdate(currentSettings, newSettings));
      return { success: true };
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to save settings.' };
    }
  });

  ipcMain.handle('mark-changelog-viewed', async (event, version) => {
    try {
      const versionToPersist = typeof version === 'string' && version.trim().length > 0
        ? version.trim()
        : app.getVersion();

      await queueSettingsUpdate((currentSettings) => ({
        ...currentSettings,
        lastViewedVersion: versionToPersist,
      }));

      return { success: true };
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to mark changelog as viewed.' };
    }
  });

  ipcMain.handle('launch-generator', async (event, payload) => {
    try {
      await settingsWriteQueue;
      const settings = await readSettings();
      const configuredCommand = normalizeLauncherCommand(settings?.generatorLaunchCommand);
      const configuredWorkingDirectory = normalizeLauncherWorkingDirectory(settings?.generatorLaunchWorkingDirectory);

      if (!configuredCommand) {
        return { success: false, error: 'No launch command configured. Add one in Settings > Integrations.' };
      }

      const requestedCommand = normalizeLauncherCommand(typeof payload === 'string' ? payload : payload?.command);
      const requestedWorkingDirectory = normalizeLauncherWorkingDirectory(
        typeof payload === 'string' ? '' : payload?.workingDirectory
      );

      if (requestedCommand && requestedCommand !== configuredCommand) {
        return { success: false, error: 'Launch request rejected: command must match the saved integration setting.' };
      }

      if (
        requestedWorkingDirectory &&
        configuredWorkingDirectory &&
        requestedWorkingDirectory !== configuredWorkingDirectory
      ) {
        return {
          success: false,
          error: 'Launch request rejected: working directory must match the saved integration setting.',
        };
      }

      if (requestedWorkingDirectory && !configuredWorkingDirectory) {
        return {
          success: false,
          error: 'Launch request rejected: working directory must be saved in Settings before launch.',
        };
      }

      const result = await launchGeneratorCommand({
        command: configuredCommand,
        workingDirectory: configuredWorkingDirectory,
      });
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to launch generator.' };
    }
  });

  ipcMain.handle('open-external-url', async (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only http and https URLs are supported.');
      }

      await shell.openExternal(parsed.toString());
      return { success: true };
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to open external URL.' };
    }
  });

  ipcMain.handle('open-path', async (event, filePath) => {
    try {
      if (!filePath) {
        return { success: false, error: 'No path provided.' };
      }

      const normalizedFilePath = path.resolve(filePath);
      if (!isPathAllowed(normalizedFilePath)) {
        console.error('SECURITY VIOLATION: Attempted to open path outside of allowed directories.');
        console.error('  [open-path] Requested path:', filePath);
        console.error('  [open-path] Normalized path:', normalizedFilePath);
        console.error('  [open-path] Allowed directories:', Array.from(allowedDirectoryPaths));
        return { success: false, error: 'Access denied', errorType: 'PERMISSION_DENIED' };
      }

      const openError = await shell.openPath(normalizedFilePath);
      if (openError) {
        return { success: false, error: openError };
      }

      return { success: true };
    } catch (error) {
      console.error('Failed to open path:', error);
      return { success: false, error: error?.message || 'Failed to open path.' };
    }
  });

  ipcMain.handle('comfy-view-open', async (event, payload) => {
    try {
      return await openComfyUIView(payload);
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to open embedded ComfyUI.' };
    }
  });

  ipcMain.handle('comfy-view-show', async (event, payload) => {
    try {
      return showComfyUIView(payload?.bounds);
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to show embedded ComfyUI.' };
    }
  });

  ipcMain.handle('comfy-view-hide', async () => {
    try {
      return hideComfyUIView();
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to hide embedded ComfyUI.' };
    }
  });

  ipcMain.handle('comfy-view-suspend', async () => {
    try {
      return suspendComfyUIView();
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to suspend embedded ComfyUI.' };
    }
  });

  ipcMain.handle('comfy-view-set-bounds', async (event, payload) => {
    try {
      return setComfyUIViewBounds(payload?.bounds ?? payload);
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to resize embedded ComfyUI.' };
    }
  });

  ipcMain.handle('comfy-view-reload', async (event, payload = {}) => {
    try {
      const targetUrl = payload?.url || comfyUIViewState.url || comfyUIViewConfiguredUrl;
      const openResult = await openComfyUIView({ url: targetUrl, bounds: payload?.bounds });
      if (!openResult.success) {
        return openResult;
      }

      const contents = comfyUIView?.webContents;
      if (!contents || contents.isDestroyed()) {
        return { success: false, error: 'ComfyUI view is not open.' };
      }

      const parsed = normalizeComfyUIViewUrl(targetUrl);
      const currentUrl = contents.getURL();
      if (parsed && (!currentUrl || !isComfyNavigationAllowed(currentUrl))) {
        await contents.loadURL(parsed.toString());
      } else {
        contents.reload();
      }

      return { success: true, state: updateComfyUIViewState({ visible: true, lastLoadFailed: false }) };
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to reload embedded ComfyUI.' };
    }
  });

  ipcMain.handle('comfy-view-go-back', async () => {
    try {
      if (!comfyUIView || comfyUIView.webContents.isDestroyed()) {
        return { success: false, error: 'ComfyUI view is not open.' };
      }
      const history = comfyUIView.webContents.navigationHistory;
      if (typeof history?.canGoBack === 'function' && history.canGoBack()) {
        history.goBack();
      }
      return { success: true, state: updateComfyUIViewState() };
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to navigate embedded ComfyUI.' };
    }
  });

  ipcMain.handle('comfy-view-go-forward', async () => {
    try {
      if (!comfyUIView || comfyUIView.webContents.isDestroyed()) {
        return { success: false, error: 'ComfyUI view is not open.' };
      }
      const history = comfyUIView.webContents.navigationHistory;
      if (typeof history?.canGoForward === 'function' && history.canGoForward()) {
        history.goForward();
      }
      return { success: true, state: updateComfyUIViewState() };
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to navigate embedded ComfyUI.' };
    }
  });

  ipcMain.handle('comfy-view-get-state', async () => {
    return { success: true, state: updateComfyUIViewState() };
  });

  ipcMain.handle('comfy-view-load-workflow', async (event, payload) => {
    try {
      return await loadWorkflowIntoComfyUIView(payload);
    } catch (error) {
      return { success: false, state: updateComfyUIViewState(), error: error?.message || 'Failed to load workflow in ComfyUI.' };
    }
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

  ipcMain.handle('get-user-data-path', () => {
    return app.getPath('userData');
  });

  ipcMain.handle('get-theme', () => {
    return {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors
    };
  });

  ipcMain.handle('get-zoom-factor', () => getMainWindowZoomFactor());

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });
  // --- End Settings IPC ---

  // --- Cache IPC Handlers ---
  const getCacheFilePath = async (cacheId) => {
    const safeCacheId = cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const rootPath = await getCacheRootPath();
    return path.join(rootPath, `${safeCacheId}.json`);
  };

  ipcMain.handle('get-cached-data', async (event, cacheId) => {
    const filePath = await getCacheFilePath(cacheId);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);

      // Check parser version - if mismatch, invalidate cache
      if (parsed.parserVersion !== PARSER_VERSION) {
        console.log(`⚠️ Cache version mismatch for ${cacheId}: stored=${parsed.parserVersion}, current=${PARSER_VERSION}. Invalidating cache to force re-parse.`);
        return { success: true, data: null }; // Return null to force re-parse with new parser
      }

      return { success: true, data: parsed };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { success: true, data: null }; // File not found is not an error
      }
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-cache-summary', async (event, cacheId) => {
    const start = Date.now();
    const filePath = await getCacheFilePath(cacheId);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      const chunkCount = parsed?.chunkCount ?? 0;
      if (chunkCount > 0) {
        const safeCacheId = cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');
        const rootPath = await getCacheRootPath();
        const cacheDir = path.join(rootPath, 'json_cache');
        const maxChunkBytes = 64 * 1024 * 1024;

        for (let i = 0; i < chunkCount; i += 1) {
          const chunkPath = path.join(cacheDir, `${safeCacheId}_${i}.json`);
          const stats = await fs.stat(chunkPath).catch(error => {
            if (error.code === 'ENOENT') return null;
            throw error;
          });

          if (stats && stats.size > maxChunkBytes) {
            console.warn(`⚠️ Cache chunk too large for ${cacheId}: chunk=${i}, bytes=${stats.size}. Invalidating cache to avoid renderer freeze.`);
            logMainPerf('get-cache-summary:oversized-chunk', {
              cacheId,
              chunkIndex: i,
              bytes: stats.size,
              durationMs: elapsedMs(start),
            });
            return { success: true, data: null };
          }
        }
      }
      logMainPerf('get-cache-summary:hit', {
        cacheId,
        imageCount: parsed?.imageCount ?? 0,
        chunkCount,
        mainRecordBytes: data.length,
        durationMs: elapsedMs(start),
      });
      return { success: true, data: parsed };
    } catch (error) {
      if (error.code === 'ENOENT') {
        logMainPerf('get-cache-summary:miss', {
          cacheId,
          durationMs: elapsedMs(start),
        });
        return { success: true, data: null };
      }
      logMainPerf('get-cache-summary:error', {
        cacheId,
        errorCode: error.code,
        durationMs: elapsedMs(start),
      });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-json-cache-data', async (event, cacheId) => {
    const filePath = await getCacheFilePath(cacheId);
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

  ipcMain.handle('write-json-cache-data', async (event, { cacheId, data }) => {
    try {
      const filePath = await getCacheFilePath(cacheId);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  const CHUNK_SIZE = 1024; // Keep cache chunks small enough to parse without freezing the renderer
  const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  ipcMain.handle('cache-data', async (event, { cacheId, data }) => {
    const start = Date.now();
    const safeCacheId = cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const { metadata, ...cacheRecord } = data;
    const rootPath = await getCacheRootPath();
    const cacheDir = path.join(rootPath, 'json_cache');
    await fs.mkdir(cacheDir, { recursive: true });

    // Write chunk files
    const chunkCount = Math.ceil(metadata.length / CHUNK_SIZE);
    for (let i = 0; i < chunkCount; i++) {
      const chunk = metadata.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const chunkPath = path.join(cacheDir, `${safeCacheId}_${i}.json`);
      await fs.writeFile(chunkPath, JSON.stringify(chunk));
    }

    // Write main cache record (without metadata) with parser version
    const mainCachePath = await getCacheFilePath(cacheId);
    cacheRecord.chunkCount = chunkCount;
    cacheRecord.parserVersion = PARSER_VERSION; // Add parser version
    await fs.writeFile(mainCachePath, JSON.stringify(cacheRecord, null, 2));

    logMainPerf('cache-data:complete', {
      cacheId,
      records: metadata.length,
      chunkCount,
      durationMs: elapsedMs(start),
    });
    return { success: true };
  });

  ipcMain.handle('prepare-cache-write', async (event, { cacheId }) => {
    const start = Date.now();
    try {
      const safeCacheId = cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');
      const rootPath = await getCacheRootPath();
      const cacheDir = path.join(rootPath, 'json_cache');
      await fs.mkdir(cacheDir, { recursive: true });

      try {
        const files = await fs.readdir(cacheDir);
        const chunkPattern = new RegExp(`^${escapeRegExp(safeCacheId)}_(\\d+)\\.json$`);
        const matchingFiles = files.filter(file => chunkPattern.test(file));
        await Promise.all(
          matchingFiles
            .map(file => fs.unlink(path.join(cacheDir, file)).catch(err => {
              if (err.code !== 'ENOENT') throw err;
            }))
        );
        logMainPerf('prepare-cache-write:cleanup', {
          cacheId,
          removedChunks: matchingFiles.length,
          durationMs: elapsedMs(start),
        });
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }

      logMainPerf('prepare-cache-write:complete', {
        cacheId,
        durationMs: elapsedMs(start),
      });
      return { success: true };
    } catch (error) {
      logMainPerf('prepare-cache-write:error', {
        cacheId,
        errorCode: error.code,
        durationMs: elapsedMs(start),
      });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('write-cache-chunk', async (event, { cacheId, chunkIndex, data }) => {
    const start = Date.now();
    try {
      const safeCacheId = cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');
      const rootPath = await getCacheRootPath();
      const cacheDir = path.join(rootPath, 'json_cache');
      await fs.mkdir(cacheDir, { recursive: true });
      const chunkPath = path.join(cacheDir, `${safeCacheId}_${chunkIndex}.json`);
      const json = JSON.stringify(data);
      await fs.writeFile(chunkPath, json);
      if (isSlowMainOp(start) || json.length > 8_000_000) {
        logMainPerf('write-cache-chunk:slow', {
          cacheId,
          chunkIndex,
          records: Array.isArray(data) ? data.length : null,
          bytes: json.length,
          durationMs: elapsedMs(start),
        });
      }
      return { success: true };
    } catch (error) {
      logMainPerf('write-cache-chunk:error', {
        cacheId,
        chunkIndex,
        errorCode: error.code,
        durationMs: elapsedMs(start),
      });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('finalize-cache-write', async (event, { cacheId, sourceCacheId, record }) => {
    const start = Date.now();
    try {
      const safeCacheId = cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');
      const safeSourceCacheId = sourceCacheId?.replace(/[^a-zA-Z0-9-_]/g, '_');
      if (safeSourceCacheId && safeSourceCacheId !== safeCacheId) {
        const rootPath = await getCacheRootPath();
        const cacheDir = path.join(rootPath, 'json_cache');
        await fs.mkdir(cacheDir, { recursive: true });

        const files = await fs.readdir(cacheDir).catch(error => {
          if (error.code === 'ENOENT') return [];
          throw error;
        });
        const targetChunkPattern = new RegExp(`^${escapeRegExp(safeCacheId)}_(\\d+)\\.json$`);
        const sourceChunkPattern = new RegExp(`^${escapeRegExp(safeSourceCacheId)}_(\\d+)\\.json$`);

        for (const file of files) {
          if (targetChunkPattern.test(file)) {
            await unlinkCacheChunkWithRetry(path.join(cacheDir, file));
          }
        }

        let renamedChunks = 0;
        for (const file of files) {
          const match = file.match(sourceChunkPattern);
          if (!match) {
            continue;
          }
          await renameCacheChunkWithRetry(
            path.join(cacheDir, file),
            path.join(cacheDir, `${safeCacheId}_${match[1]}.json`)
          );
          renamedChunks += 1;
        }
        logMainPerf('finalize-cache-write:swap-chunks', {
          cacheId,
          sourceCacheId,
          removedTargetChunks: targetFiles.length,
          renamedChunks,
          durationMs: elapsedMs(start),
        });
      }

      const mainCachePath = await getCacheFilePath(cacheId);
      // Add parser version to cache record
      const recordWithVersion = { ...record, parserVersion: PARSER_VERSION };
      await fs.writeFile(mainCachePath, JSON.stringify(recordWithVersion, null, 2));
      logMainPerf('finalize-cache-write:complete', {
        cacheId,
        sourceCacheId: sourceCacheId ?? null,
        imageCount: recordWithVersion.imageCount,
        chunkCount: recordWithVersion.chunkCount,
        durationMs: elapsedMs(start),
      });
      return { success: true };
    } catch (error) {
      logMainPerf('finalize-cache-write:error', {
        cacheId,
        sourceCacheId: sourceCacheId ?? null,
        errorCode: error.code,
        durationMs: elapsedMs(start),
      });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-cache-chunk', async (event, { cacheId, chunkIndex }) => {
    const start = Date.now();
    const safeCacheId = cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const rootPath = await getCacheRootPath();
    const cacheDir = path.join(rootPath, 'json_cache');
    const chunkPath = path.join(cacheDir, `${safeCacheId}_${chunkIndex}.json`);
    try {
      const data = await fs.readFile(chunkPath, 'utf-8');
      const parsed = JSON.parse(data);
      if (isSlowMainOp(start) || data.length > 8_000_000) {
        logMainPerf('get-cache-chunk:slow', {
          cacheId,
          chunkIndex,
          bytes: data.length,
          records: Array.isArray(parsed) ? parsed.length : null,
          durationMs: elapsedMs(start),
        });
      }
      return { success: true, data: parsed };
    } catch (error) {
      logMainPerf('get-cache-chunk:error', {
        cacheId,
        chunkIndex,
        errorCode: error.code,
        durationMs: elapsedMs(start),
      });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clear-cache-data', async (event, cacheId) => {
    const safeCacheId = cacheId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const rootPath = await getCacheRootPath();
    const cacheDir = path.join(rootPath, 'json_cache');
    const mainCachePath = await getCacheFilePath(cacheId);

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
  ipcMain.handle('resolve-thumbnail-cache-batch', async (event, { candidates } = {}) => {
    const startedAt = Date.now();
    const list = Array.isArray(candidates) ? candidates.slice(0, 512) : [];
    const rootPath = await getCacheRootPath();
    await getThumbnailCacheDir(rootPath);

    let hitCount = 0;
    let missCount = 0;

    try {
      const resolved = await mapWithConcurrency(list, 32, async (candidate) => {
        const requestId = candidate?.requestId || candidate?.imageId || candidate?.thumbnailId;
        const cached = await findCachedThumbnail(rootPath, candidate);

        if (cached) {
          hitCount++;
          return [requestId, {
            hit: true,
            url: cached.url,
            thumbnailId: cached.thumbnailId,
            extension: cached.extension,
            source: cached.source,
            legacy: cached.legacy,
          }];
        }

        missCount++;
        return [requestId, { hit: false }];
      });

      return {
        success: true,
        results: Object.fromEntries(resolved.filter(([key]) => Boolean(key))),
        stats: {
          requested: list.length,
          hits: hitCount,
          misses: missCount,
          durationMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-thumbnail', async (event, thumbnailId) => {
    try {
      for (const extension of ['webp', 'png', 'jpg', 'jpeg']) {
        const filePath = await getThumbnailCachePath(thumbnailId, extension);
        try {
          const data = await fs.readFile(filePath);
          return { success: true, data };
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      return { success: true, data: null };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('cache-thumbnail', async (event, { thumbnailId, data }) => {
    const rootPath = await getCacheRootPath();
    const filePath = await getThumbnailCachePath(thumbnailId, 'webp', rootPath);
    try {
      await fs.writeFile(filePath, data);
      await upsertThumbnailManifestEntry(
        rootPath,
        buildThumbnailManifestEntry({ algorithmVersion: `v${THUMBNAIL_CACHE_VERSION}` }, thumbnailId, 'webp', filePath)
      );
      return { success: true };
    } catch (error) {
      // Log the error with context for debugging
      const isPathTooLong = error.code === 'ENAMETOOLONG' || error.message?.includes('path too long');
      const isPermissionError = error.code === 'EACCES' || error.code === 'EPERM';

      if (isPathTooLong) {
        console.error(`Thumbnail path too long (this should not happen with hashing):`, {
          thumbnailIdLength: thumbnailId.length,
          filePathLength: filePath.length,
          error: error.message
        });
      } else if (!isPermissionError) {
        console.error('Error caching thumbnail:', error);
      }

      return { success: false, error: error.message, errorCode: error.code };
    }
  });

  ipcMain.handle('generate-thumbnail-to-cache', async (event, {
    thumbnailId,
    filePath,
    maxEdge = 320,
    quality = 82,
    imageId,
    originalRelativePath,
    lastModified,
    contentModifiedMs,
    fileSize,
    algorithmVersion,
  } = {}) => {
    try {
      if (!thumbnailId) {
        return { success: false, error: 'No thumbnail id provided' };
      }

      if (!filePath) {
        return { success: false, error: 'No file path provided' };
      }

      if (!isPathAllowed(filePath)) {
        return { success: false, error: 'Access denied: Cannot generate thumbnails outside of allowed directories.' };
      }

      let image;
      if (typeof nativeImage.createThumbnailFromPath === 'function') {
        image = await nativeImage.createThumbnailFromPath(filePath, {
          width: maxEdge,
          height: maxEdge,
        });
      } else {
        image = nativeImage.createFromPath(filePath);
      }

      if (!image || image.isEmpty()) {
        return { success: false, error: 'Failed to decode image for thumbnail generation.' };
      }

      const { width, height } = image.getSize();
      const safeWidth = Math.max(1, width || maxEdge);
      const safeHeight = Math.max(1, height || maxEdge);
      const scale = Math.min(1, maxEdge / Math.max(safeWidth, safeHeight));

      const resizedImage = scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(safeWidth * scale)),
            height: Math.max(1, Math.round(safeHeight * scale)),
            quality: 'better',
          })
        : image;

      const lowerExt = path.extname(filePath).toLowerCase();
      const preserveAlpha = lowerExt === '.png' || lowerExt === '.webp' || lowerExt === '.gif';
      const extension = preserveAlpha ? 'png' : 'jpg';
      const data = preserveAlpha
        ? resizedImage.toPNG()
        : resizedImage.toJPEG(Math.max(1, Math.min(100, Math.round(quality))));

      const rootPath = await getCacheRootPath();
      const thumbnailPath = await getThumbnailCachePath(thumbnailId, extension, rootPath);
      await fs.writeFile(thumbnailPath, data);

      await upsertThumbnailManifestEntry(
        rootPath,
        buildThumbnailManifestEntry(
          {
            imageId,
            originalRelativePath,
            lastModified,
            contentModifiedMs,
            fileSize,
            algorithmVersion: algorithmVersion || `v${THUMBNAIL_CACHE_VERSION}`,
          },
          thumbnailId,
          extension,
          thumbnailPath
        )
      );

      return {
        success: true,
        url: buildThumbnailProtocolUrl(thumbnailId, extension),
        thumbnailId,
        extension,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('generate-thumbnail-from-path', async (event, { filePath, maxEdge = 320, quality = 82 }) => {
    try {
      if (!filePath) {
        return { success: false, error: 'No file path provided' };
      }

      if (!isPathAllowed(filePath)) {
        return { success: false, error: 'Access denied: Cannot generate thumbnails outside of allowed directories.' };
      }

      let image;
      if (typeof nativeImage.createThumbnailFromPath === 'function') {
        image = await nativeImage.createThumbnailFromPath(filePath, {
          width: maxEdge,
          height: maxEdge,
        });
      } else {
        image = nativeImage.createFromPath(filePath);
      }

      if (!image || image.isEmpty()) {
        return { success: false, error: 'Failed to decode image for thumbnail generation.' };
      }

      const { width, height } = image.getSize();
      const safeWidth = Math.max(1, width || maxEdge);
      const safeHeight = Math.max(1, height || maxEdge);
      const scale = Math.min(1, maxEdge / Math.max(safeWidth, safeHeight));

      const resizedImage = scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(safeWidth * scale)),
            height: Math.max(1, Math.round(safeHeight * scale)),
            quality: 'better',
          })
        : image;

      const lowerExt = path.extname(filePath).toLowerCase();
      const preserveAlpha = lowerExt === '.png' || lowerExt === '.webp' || lowerExt === '.gif';

      if (preserveAlpha) {
        const data = resizedImage.toPNG();
        return { success: true, data, mimeType: 'image/png' };
      }

      const jpegQuality = Math.max(1, Math.min(100, Math.round(quality)));
      const data = resizedImage.toJPEG(jpegQuality);
      return { success: true, data, mimeType: 'image/jpeg' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clear-metadata-cache', async () => {
    try {
      const rootPath = await getCacheRootPath();
      const cacheDir = path.join(rootPath, 'json_cache');
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
      const rootPath = await getCacheRootPath();
      const cacheDir = path.join(rootPath, 'thumbnails');
      if (fsSync.existsSync(cacheDir)) {
        await fs.rm(cacheDir, { recursive: true, force: true });
        await fs.mkdir(cacheDir, { recursive: true });
      }
      clearThumbnailManifestState(rootPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clear-library-cache', async () => {
    try {
      const rootPath = await getCacheRootPath();
      const metadataCacheDir = path.join(rootPath, 'json_cache');
      const thumbnailCacheDir = path.join(rootPath, 'thumbnails');
      const smartLibraryCacheDir = path.join(app.getPath('userData'), 'smart-library-cache');

      if (fsSync.existsSync(metadataCacheDir)) {
        await fs.rm(metadataCacheDir, { recursive: true, force: true });
      }
      await fs.mkdir(metadataCacheDir, { recursive: true });

      if (fsSync.existsSync(thumbnailCacheDir)) {
        await fs.rm(thumbnailCacheDir, { recursive: true, force: true });
      }
      await fs.mkdir(thumbnailCacheDir, { recursive: true });
      clearThumbnailManifestState(rootPath);

      if (fsSync.existsSync(smartLibraryCacheDir)) {
        await fs.rm(smartLibraryCacheDir, { recursive: true, force: true });
      }

      try {
        const files = await fs.readdir(rootPath);
        const cacheRecordFiles = [];
        for (const file of files) {
          if (!file.endsWith('.json') || ['settings.json', 'settings.json.bak', 'settings.json.tmp'].includes(file)) {
            continue;
          }

          const filePath = path.join(rootPath, file);
          try {
            const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'));
            if (
              parsed &&
              typeof parsed === 'object' &&
              (
                typeof parsed.parserVersion === 'number' ||
                (typeof parsed.schemaVersion === 'number' && typeof parsed.librarySignature === 'string')
              )
            ) {
              cacheRecordFiles.push(filePath);
            }
          } catch (error) {
            console.warn(`Skipping non-cache JSON while clearing library cache: ${file}`, error?.message);
          }
        }

        await Promise.all(
          cacheRecordFiles.map(filePath => fs.unlink(filePath).catch(error => {
              if (error.code !== 'ENOENT') throw error;
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

  ipcMain.handle('read-smart-library-cache', async (event, { cacheId, kind } = {}) => {
    try {
      const cachePath = await getSmartLibraryCachePath(cacheId, kind);
      const data = await fs.readFile(cachePath, 'utf-8');
      return { success: true, data };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { success: false, error: 'Cache file not found.', errorCode: error.code };
      }
      return { success: false, error: error.message, errorCode: error.code };
    }
  });

  ipcMain.handle('write-smart-library-cache', async (event, { cacheId, kind, data } = {}) => {
    try {
      const cachePath = await getSmartLibraryCachePath(cacheId, kind);
      const tempPath = `${cachePath}.tmp`;
      const payload = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

      await fs.writeFile(tempPath, payload, 'utf-8');
      await fs.rename(tempPath, cachePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }
  });

  ipcMain.handle('delete-smart-library-cache', async (event, { cacheId, kind } = {}) => {
    try {
      const cachePath = await getSmartLibraryCachePath(cacheId, kind);
      await fs.unlink(cachePath).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message, errorCode: error.code };
    }
  });

  // Delete all cache files and folders (but not userData itself, as app is using it)
  ipcMain.handle('delete-cache-folder', async (event, options = {}) => {
    try {
      const userDataDir = app.getPath('userData');
      const settingsBeforeDelete = await readSettings();
      const preservedLicense = options?.preserveLicense === true ? settingsBeforeDelete?.license : undefined;

      try {
        const files = await fs.readdir(userDataDir);

        // Delete each file/folder inside userData
        for (const file of files) {
          const filePath = path.join(userDataDir, file);
          const stat = await fs.stat(filePath);

          if (stat.isDirectory()) {
            // Recursively delete directories
            await fs.rm(filePath, { recursive: true, force: true });
          } else {
            // Delete files
            await fs.unlink(filePath);
          }
        }
      } catch (error) {
        // If userData doesn't exist or can't be read, that's fine (already clean)
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }

      if (preservedLicense) {
        await saveSettings({ license: preservedLicense });
      }

      return { success: true, needsRestart: true };
    } catch (error) {
      console.error('Error deleting cache folder:', error);
      return { success: false, error: error.message, needsRestart: false };
    }
  });

  // Restart the application (used after cache reset)
  ipcMain.handle('restart-app', async () => {
    try {
      console.log('🔄 Restarting application...');
      app.relaunch();
      app.quit();
      return { success: true };
    } catch (error) {
      console.error('Error restarting app:', error);
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
        const normalized = normalizeAllowedPath(p);
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

  ipcMain.on('start-file-drag', (event, payload) => {
    try {
      const directoryPath = payload?.directoryPath;
      const relativePath = payload?.relativePath;
      if (!directoryPath || !relativePath) {
        return;
      }

      const fullPath = path.resolve(directoryPath, relativePath);
      if (!isPathAllowed(fullPath)) {
        console.error('SECURITY VIOLATION: Attempted to drag file outside of allowed directories.');
        return;
      }

      const fileIcon = nativeImage.createFromPath(fullPath);
      const dragIcon = fileIcon && !fileIcon.isEmpty()
        ? fileIcon
        : nativeImage.createFromPath(getIconPath());

      event.sender.startDrag({ file: fullPath, icon: dragIcon });
    } catch (error) {
      console.error('Error starting file drag:', error);
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
      registerApprovedWriteRoot(selectedPath);
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

  ipcMain.handle('show-save-dialog', async (event, options = {}) => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, options);
      if (result.canceled) {
        return { success: true, canceled: true };
      }
      if (result.filePath) {
        registerApprovedWriteFilePath(result.filePath);
      }
      return { success: true, canceled: false, path: result.filePath };
    } catch (error) {
      console.error('Error showing save dialog:', error);
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
      if (!isAllowedOrInternal(oldPath) || !isRenameTargetAllowed(oldPath, newPath)) {
        console.error('SECURITY VIOLATION: Attempted to rename file outside of allowed directories.');
        return { success: false, error: 'Access denied: Cannot rename files outside of the allowed directories.' };
      }
      
      console.log('Attempting to rename file:', oldPath, 'to', newPath);
      const oldStats = await fs.lstat(oldPath);
      try {
        const targetStats = await fs.lstat(newPath);
        const isSameFile = oldStats.dev === targetStats.dev && oldStats.ino === targetStats.ino;
        if (!isSameFile) {
          return { success: false, error: 'A file with that name already exists.' };
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }

      await fs.rename(oldPath, newPath);

      const normalizedOldAllowedPath = normalizeAllowedPath(oldPath);
      if (allowedDirectoryPaths.has(normalizedOldAllowedPath)) {
        allowedDirectoryPaths.delete(normalizedOldAllowedPath);
        allowedDirectoryPaths.add(normalizeAllowedPath(newPath));
      }

      return { success: true };
    } catch (error) {
      console.error('Error renaming file:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle show item in folder
  ipcMain.handle('show-item-in-folder', async (event, filePath) => {
    try {
      // Allow opening any folder/file that the user has access to via the OS dialogs
      // We removed the isPathAllowed check here because export destinations can be anywhere
      
      const normalizedFilePath = path.normalize(filePath);
      console.log('📂 Attempting to show item in folder:', normalizedFilePath);

      // Verify the path exists before trying to open or show it
      let stats;
      try {
        stats = await fs.stat(normalizedFilePath);
        console.log('✅ Path exists:', normalizedFilePath);
      } catch (accessError) {
        console.error('❌ Path does not exist:', normalizedFilePath, accessError);
        return { success: false, error: `Path does not exist: ${normalizedFilePath}` };
      }

      if (stats.isDirectory()) {
        const openError = await shell.openPath(normalizedFilePath);
        if (openError) {
          console.error('❌ shell.openPath failed for:', normalizedFilePath, openError);
          return { success: false, error: openError };
        }

        console.log('✅ shell.openPath called for directory:', normalizedFilePath);
        return { success: true };
      }

      shell.showItemInFolder(normalizedFilePath);
      console.log('✅ shell.showItemInFolder called for file:', normalizedFilePath);

      return { success: true };
    } catch (error) {
      console.error('❌ Error showing item in folder:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle open cache location (without security restrictions since it's app's internal cache)
  ipcMain.handle('open-cache-location', async (event, cachePath) => {
    try {
      const normalizedCachePath = path.normalize(cachePath);
      const parentPath = path.dirname(normalizedCachePath);
      console.log('📂 Opening cache parent directory:', parentPath);

      shell.showItemInFolder(parentPath);
      console.log('✅ shell.showItemInFolder called for:', parentPath);

      return { success: true };
    } catch (error) {
      console.error('❌ Error opening cache location:', error);
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

      // Read directory and include real directories plus symlinks/aliases that resolve to directories.
      const entries = await fs.readdir(normalizedPath, { withFileTypes: true });
      const subfolders = [];

      for (const entry of entries) {
        const entryPath = path.join(normalizedPath, entry.name);
        let isDirectory = entry.isDirectory();
        let realPath = entryPath;

        if (!isDirectory && entry.isSymbolicLink()) {
          try {
            const stats = await fs.stat(entryPath);
            isDirectory = stats.isDirectory();
            realPath = await fs.realpath(entryPath);
          } catch (error) {
            console.warn('Skipping inaccessible symlink while listing subfolders:', entryPath, error.message);
          }
        } else if (isDirectory) {
          try {
            realPath = await fs.realpath(entryPath);
          } catch {
            realPath = entryPath;
          }
        }

        if (isDirectory) {
          subfolders.push({
            name: entry.name,
            path: entryPath,
            realPath
          });
        }
      }

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
      isManualUpdateCheck = true;
      const result = await autoUpdater.checkForUpdates();
      // Reset the flag if successful, as 'update-available' or 'update-not-available' will handle UI
      // If it throws, the error handler will catch and reset the flag
      return { success: true, updateInfo: result.updateInfo };
    } catch (error) {
      console.error('Error checking for updates:', error);
      isManualUpdateCheck = false; // Reset on immediate error
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('download-update', async () => {
    if (!autoUpdater) {
      return { success: false, error: 'Auto-updater not available' };
    }

    try {
      console.log('User accepted update download - starting download...');
      isManualUpdateCheck = true;
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      console.error('Error downloading update:', error);
      isManualUpdateCheck = false;
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('install-update', async () => {
    if (!autoUpdater) {
      return { success: false, error: 'Auto-updater not available' };
    }

    try {
      console.log('User chose to restart and install update');
      autoUpdater.quitAndInstall();
      return { success: true };
    } catch (error) {
      console.error('Error installing update:', error);
      return { success: false, error: error.message };
    }
  });

  // TEST ONLY: Simulate update available dialog
  ipcMain.handle('test-update-dialog', async () => {
    if (!isDev) {
      return { success: false, error: 'test-update-dialog is only available in development.' };
    }

    if (!mainWindow) {
      return { success: false, error: 'Main window not available' };
    }
    
    // Simulate update info
    const mockUpdateInfo = {
  version: '0.14.0',
      releaseNotes: `## [0.13.2] - Release

### Major Performance Improvements
- **3-5x Faster Loading**: Batch IPC operations reduce 1000+ calls to a single batch
- **40-60% Fewer Re-renders**: Granular Zustand selectors optimize component updates
- **Phase B Optimizations**: Metadata enrichment now ~13ms per file (down from ~30ms)
- **Smoother Navigation**: Bounded thumbnail queue with stale request cancellation

### New Features
- **Comparison Modes**: Slider and hover modes for side-by-side image comparison
- **Component Memoization**: Sidebar and preview components prevent unnecessary re-renders
- **Optimized Rendering**: Improved grid and table view performance for large datasets`
    };

    mainWindow.webContents.send('update-available-notification', buildUpdateNotificationPayload(mockUpdateInfo));

    return { success: true };
  });

  // Handle listing directory files
  ipcMain.handle('list-directory-files', async (event, { dirPath, recursive = false }) => {
    const scanStart = Date.now();
    try {
      if (!dirPath) {
        return { success: false, error: 'No directory path provided' };
      }

      let imageFiles = [];

      if (recursive) {
        imageFiles = await getFilesRecursively(dirPath, dirPath);
      } else {
        const files = await fs.readdir(dirPath, { withFileTypes: true });
        imageFiles = await statMediaEntries(dirPath, files, dirPath);
      }

      console.log(`[list-directory-files] ${dirPath} (${recursive ? 'recursive' : 'flat'}) -> ${imageFiles.length} files in ${((Date.now() - scanStart) / 1000).toFixed(2)}s`);
      logMainPerf('list-directory-files:complete', {
        dirPath,
        recursive,
        files: imageFiles.length,
        durationMs: elapsedMs(scanStart),
      });

      return { success: true, files: imageFiles };
    } catch (error) {
      console.error('Error listing directory files:', error);
      logMainPerf('list-directory-files:error', {
        dirPath,
        recursive,
        errorCode: error.code,
        durationMs: elapsedMs(scanStart ?? Date.now()),
      });
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // File Watching Handlers
  // ============================================================

  ipcMain.handle('start-watching-directory', async (event, args) => {
    const { directoryId, dirPath } = args;

    if (!directoryId || !dirPath) {
      return { success: false, error: 'Missing required parameters' };
    }

    // Validar se o path está permitido
    if (!isPathAllowed(dirPath)) {
      return { success: false, error: 'Path not allowed' };
    }

    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) {
      return { success: false, error: 'No window available' };
    }

    return fileWatcher.startWatching(directoryId, dirPath, mainWindow);
  });

  ipcMain.handle('stop-watching-directory', async (event, args) => {
    const { directoryId } = args;

    if (!directoryId) {
      return { success: false, error: 'Missing directoryId' };
    }

    return fileWatcher.stopWatching(directoryId);
  });

  ipcMain.handle('get-watcher-status', async (event, args) => {
    const { directoryId } = args;

    if (!directoryId) {
      return { success: false, active: false };
    }

    const status = fileWatcher.getWatcherStatus(directoryId);
    return { success: true, ...status };
  });

  ipcMain.on('log-media-playback-event', (_event, payload) => {
    logProcessEvent(sanitizeMediaPlaybackDiagnostics(payload));
  });

  // Handle reading file content
  ipcMain.handle('resolve-media-url', async (event, filePath) => {
    let safeDetails = { fileName: null, extension: null, mimeType: null, fileSize: null };
    try {
      if (!filePath) {
        logProcessEvent({
          kind: 'resolve-media-url',
          status: 'failed',
          errorType: 'MISSING_PATH',
        });
        return { success: false, error: 'No file path provided' };
      }

      const normalizedFilePath = path.resolve(filePath);
      safeDetails = await getSafeFileDetails(normalizedFilePath);
      if (!isPathAllowed(normalizedFilePath)) {
        console.error('SECURITY VIOLATION: Attempted to resolve media URL outside of allowed directories.');
        console.error('  [resolve-media-url] Requested path:', filePath);
        console.error('  [resolve-media-url] Normalized path:', normalizedFilePath);
        console.error('  [resolve-media-url] Allowed directories:', Array.from(allowedDirectoryPaths));
        logProcessEvent({
          kind: 'resolve-media-url',
          status: 'failed',
          errorType: 'PERMISSION_DENIED',
          ...safeDetails,
        });
        return { success: false, error: 'Access denied', errorType: 'PERMISSION_DENIED' };
      }

      await fs.access(normalizedFilePath);
      logProcessEvent({
        kind: 'resolve-media-url',
        status: 'success',
        ...safeDetails,
      });
      return { success: true, url: buildMediaProtocolUrl(normalizedFilePath) };
    } catch (error) {
      const isFileNotFound = error.code === 'ENOENT' || error.message?.includes('no such file');
      const isPermissionError = error.code === 'EACCES' || error.code === 'EPERM';

      if (!isFileNotFound) {
        console.error('Error resolving media URL:', filePath, error);
      }

      logProcessEvent({
        kind: 'resolve-media-url',
        status: 'failed',
        errorType: isFileNotFound ? 'FILE_NOT_FOUND' : (isPermissionError ? 'PERMISSION_ERROR' : 'UNKNOWN_ERROR'),
        errorCode: error.code,
        errorMessage: redactDiagnosticText(error.message),
        ...safeDetails,
      });

      return {
        success: false,
        error: error.message,
        errorType: isFileNotFound ? 'FILE_NOT_FOUND' : (isPermissionError ? 'PERMISSION_ERROR' : 'UNKNOWN_ERROR'),
        errorCode: error.code,
      };
    }
  });

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
        return { success: false, error: 'Access denied', errorType: 'PERMISSION_DENIED' };
      }

      const data = await fs.readFile(filePath);
      // console.log('Read file:', filePath, 'Size:', data.length); // Commented out to reduce console noise

      return { success: true, data: data };
    } catch (error) {
      // Classify the error type for better handling in the frontend
      const isFileNotFound = error.code === 'ENOENT' || error.message?.includes('no such file');
      const isPermissionError = error.code === 'EACCES' || error.code === 'EPERM';

      // Only log non-ENOENT errors to avoid spam when cache is stale
      if (!isFileNotFound) {
        console.error('Error reading file:', filePath, error);
      }

      return {
        success: false,
        error: error.message,
        errorType: isFileNotFound ? 'FILE_NOT_FOUND' : (isPermissionError ? 'PERMISSION_ERROR' : 'UNKNOWN_ERROR'),
        errorCode: error.code
      };
    }
  });

  const handleReadMediaMetadata = async (args) => {
    try {
      const filePath = args?.filePath;
      if (!filePath) {
        return { success: false, error: 'No file path provided' };
      }

      if (!isPathAllowed(filePath)) {
        console.error('SECURITY VIOLATION: Attempted to read file outside of allowed directories.');
        console.error('  [read-video-metadata] Requested path:', filePath);
        console.error('  [read-video-metadata] Normalized path:', path.normalize(filePath));
        console.error('  [read-video-metadata] Allowed directories:', Array.from(allowedDirectoryPaths));
        return { success: false, error: 'Access denied', errorType: 'PERMISSION_DENIED' };
      }

      const metadata = await readMediaMetadataWithFfprobe(filePath);
      return { success: true, ...metadata };
    } catch (error) {
      const isBinaryMissing = error?.code === 'ENOENT' || error?.message?.includes('ffprobe');
      return {
        success: false,
        error: isBinaryMissing ? 'FFPROBE_NOT_FOUND' : (error?.message || String(error)),
      };
    }
  };

  ipcMain.handle('read-media-metadata', async (event, args) => handleReadMediaMetadata(args));
  ipcMain.handle('read-video-metadata', async (event, args) => handleReadMediaMetadata(args));

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

  // Handle toggling fullscreen
  ipcMain.handle('toggle-fullscreen', () => {
    if (mainWindow) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      return { success: true, isFullscreen: mainWindow.isFullScreen() };
    }
    return { success: false, error: 'Main window not available' };
  });

  ipcMain.handle('get-fullscreen-state', () => {
    if (mainWindow) {
      return { success: true, isFullscreen: mainWindow.isFullScreen() };
    }
    return { success: false, error: 'Main window not available' };
  });

  ipcMain.handle('set-fullscreen', (event, isFullscreen) => {
    if (mainWindow) {
      const nextFullscreenState = Boolean(isFullscreen);
      if (mainWindow.isFullScreen() !== nextFullscreenState) {
        mainWindow.setFullScreen(nextFullscreenState);
      }
      return { success: true, isFullscreen: mainWindow.isFullScreen() };
    }
    return { success: false, error: 'Main window not available' };
  });

  const DEFAULT_FULL_READ_MAX_FILE_BYTES = 32 * 1024 * 1024;
  const DEFAULT_FULL_READ_MAX_TOTAL_BYTES = 96 * 1024 * 1024;

  // Handle reading multiple files in a batch
  ipcMain.handle('read-files-batch', async (event, batchArgs) => {
    try {
      const filePaths = Array.isArray(batchArgs)
        ? batchArgs
        : Array.isArray(batchArgs?.filePaths)
          ? batchArgs.filePaths
          : [];
      const maxFileBytes = Array.isArray(batchArgs)
        ? DEFAULT_FULL_READ_MAX_FILE_BYTES
        : Math.max(1, Math.floor(batchArgs?.maxFileBytes ?? DEFAULT_FULL_READ_MAX_FILE_BYTES));
      const maxTotalBytes = Array.isArray(batchArgs)
        ? Number.POSITIVE_INFINITY
        : Math.max(1, Math.floor(batchArgs?.maxTotalBytes ?? DEFAULT_FULL_READ_MAX_TOTAL_BYTES));
      const reason = Array.isArray(batchArgs) ? undefined : batchArgs?.reason;

      if (filePaths.length === 0) {
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

      let scheduledBytes = 0;
      let skippedByLimit = 0;
      const limitedReadPlan = await Promise.all(filePaths.map(async (filePath) => {
        try {
          const stats = await fs.stat(filePath);
          const fileSize = stats.size ?? 0;

          if (fileSize > maxFileBytes) {
            skippedByLimit += 1;
            return {
              filePath,
              skip: {
                success: false,
                path: filePath,
                error: 'Skipped full read: file too large for IPC batch',
                errorType: 'FILE_TOO_LARGE',
                errorCode: 'IPC_FULL_READ_LIMIT',
              },
            };
          }

          if (scheduledBytes + fileSize > maxTotalBytes) {
            skippedByLimit += 1;
            return {
              filePath,
              skip: {
                success: false,
                path: filePath,
                error: 'Skipped full read: batch byte budget exceeded',
                errorType: 'BATCH_BYTE_LIMIT',
                errorCode: 'IPC_FULL_READ_LIMIT',
              },
            };
          }

          scheduledBytes += fileSize;
          return { filePath };
        } catch (error) {
          return {
            filePath,
            skip: {
              success: false,
              path: filePath,
              error: error.message,
              errorType: error.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'UNKNOWN_ERROR',
              errorCode: error.code,
            },
          };
        }
      }));

      if (skippedByLimit > 0) {
        console.warn('[read-files-batch] skipped oversized full reads', {
          reason: reason ?? 'unspecified',
          requested: filePaths.length,
          skipped: skippedByLimit,
          maxFileBytes,
          maxTotalBytes: Number.isFinite(maxTotalBytes) ? maxTotalBytes : null,
        });
      }

      const promises = limitedReadPlan.map((entry) => (
        entry.skip ? Promise.resolve(entry.skip) : fs.readFile(entry.filePath)
      ));
      const results = await Promise.allSettled(promises);

      const data = results.map((result, index) => {
        const planEntry = limitedReadPlan[index];
        if (result.status === 'fulfilled') {
          if (planEntry.skip) {
            return result.value;
          }
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

  ipcMain.handle('read-files-head-batch', async (event, { filePaths, maxBytes }) => {
    const start = performance.now();
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

      const FALLBACK_HEAD_BYTES = 256 * 1024;
      const MAX_HEAD_BYTES = 2 * 1024 * 1024;
      const requestedBytes = typeof maxBytes === 'number' ? maxBytes : FALLBACK_HEAD_BYTES;
      const safeBytes = Math.max(1, Math.min(requestedBytes, MAX_HEAD_BYTES));

      // Use Synchronous operations to bypass UV Threadpool overhead
      // This emulates the performance characteristics of PowerShell/CMD
      const results = new Array(filePaths.length);
      
      let totalOpenTime = 0;
      let totalReadTime = 0;

      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        
        // Yield every 5 files to prevent Main Process freeze
        if (i > 0 && i % 5 === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }

        try {
            const t0 = performance.now();
            const fd = fsSync.openSync(filePath, 'r');
            const t1 = performance.now();
            totalOpenTime += (t1 - t0);

            try {
                const buffer = Buffer.allocUnsafe(safeBytes);
                // readSync returns bytesRead directly
                const bytesRead = fsSync.readSync(fd, buffer, 0, safeBytes, 0);
                const t2 = performance.now();
                totalReadTime += (t2 - t1);
                
                results[i] = { status: 'fulfilled', value: { success: true, data: buffer.subarray(0, bytesRead), bytesRead, path: filePath } };
            } finally {
                fsSync.closeSync(fd);
            }
        } catch (error) {
            results[i] = { status: 'rejected', reason: error };
        }
      }

      console.log(`[Main] Batch(${filePaths.length}) - Sync Open: ${totalOpenTime.toFixed(1)}ms, Sync Read: ${totalReadTime.toFixed(1)}ms`);

      const data = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        }
        if (!result.reason.message?.includes('ENOENT')) {
          console.error('Error reading file head in batch:', filePaths[index], result.reason);
        }
        return { success: false, error: result.reason.message, path: filePaths[index] };
      });

      const response = { 
        success: true, 
        files: data,
        debug: {
          totalTime: performance.now() - start,
          openTime: totalOpenTime,
          readTime: totalReadTime,
          avgPerFile: (totalOpenTime + totalReadTime) / filePaths.length,
          concurrency: 1
        }
      };
      
      return response;
    } catch (error) {
      console.error('Error in read-files-head-batch handler:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('read-files-tail-batch', async (event, { filePaths, maxBytes }) => {
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

      const FALLBACK_TAIL_BYTES = 256 * 1024;
      const MAX_TAIL_BYTES = 2 * 1024 * 1024;
      const requestedBytes = typeof maxBytes === 'number' ? maxBytes : FALLBACK_TAIL_BYTES;
      const safeBytes = Math.max(1, Math.min(requestedBytes, MAX_TAIL_BYTES));

      const promises = filePaths.map(async (filePath) => {
        const handle = await fs.open(filePath, 'r');
        try {
          const stats = await handle.stat();
          const fileSize = stats.size ?? 0;
          const readSize = Math.min(safeBytes, fileSize);
          const start = Math.max(0, fileSize - readSize);
          const buffer = Buffer.allocUnsafe(readSize);
          const { bytesRead } = await handle.read(buffer, 0, readSize, start);
          return { success: true, data: buffer.subarray(0, bytesRead), bytesRead, path: filePath };
        } finally {
          await handle.close();
        }
      });
      const results = await Promise.allSettled(promises);

      const data = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        }
        if (!result.reason.message?.includes('ENOENT')) {
          console.error('Error reading file tail in batch:', filePaths[index], result.reason);
        }
        return { success: false, error: result.reason.message, path: filePaths[index] };
      });

      return { success: true, files: data };
    } catch (error) {
      console.error('Error in read-files-tail-batch handler:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle copying image to clipboard
  ipcMain.handle('copy-image-to-clipboard', async (event, filePath) => {
    try {
      if (!filePath) {
        return { success: false, error: 'No file path provided' };
      }

      // --- SECURITY CHECK ---
      if (!isPathAllowed(filePath)) {
        console.error('SECURITY VIOLATION: Attempted to copy file outside of allowed directories.');
        return { success: false, error: 'Access denied: Cannot copy files outside of the allowed directories.' };
      }
      // --- END SECURITY CHECK ---

      const image = nativeImage.createFromPath(filePath);
      if (image.isEmpty()) {
        return { success: false, error: 'Failed to load image from path' };
      }

      electron.clipboard.writeImage(image);
      return { success: true };
    } catch (error) {
      console.error('Error copying image to clipboard:', error);
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

  ipcMain.handle('dirname', async (event, filePath) => {
    try {
      if (!filePath) {
        return { success: false, error: 'No path provided' };
      }
      return { success: true, path: path.dirname(String(filePath)) };
    } catch (error) {
      console.error('Error getting dirname:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle batch path joining - optimized for processing multiple paths at once
  ipcMain.handle('join-paths-batch', async (event, { basePath, fileNames }) => {
    try {
      if (!basePath) {
        return { success: false, error: 'No base path provided' };
      }
      if (!Array.isArray(fileNames) || fileNames.length === 0) {
        return { success: false, error: 'No file names provided' };
      }

      // Process all paths in a single call
      const paths = fileNames.map(fileName => path.resolve(basePath, fileName));
      return { success: true, paths };
    } catch (error) {
      console.error('Error joining paths in batch:', error);
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

      if (!isAllowedOrInternal(normalizedFilePath) && !isApprovedWritePath(normalizedFilePath)) {
        console.error('SECURITY VIOLATION: Attempted to write file outside of approved directories.');
        return { success: false, error: 'Access denied: Cannot write files outside of approved directories.' };
      }

      console.log('Writing file to:', normalizedFilePath, 'Size:', data.length);

      await fs.writeFile(normalizedFilePath, data);
      return { success: true };
    } catch (error) {
      console.error('Error writing file:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('cancel-export-batch', async (event, { exportId } = {}) => {
    if (!exportId) {
      return { success: false, error: 'No export ID provided.' };
    }

    activeCanceledExportIds.add(String(exportId));
    return { success: true };
  });

  ipcMain.handle('export-images-batch', async (event, {
    files,
    destDir,
    exportId,
    metadataPolicy = 'preserve',
    targetFormat = 'original',
  } = {}) => {
    try {
      if (!Array.isArray(files) || files.length === 0) {
        return { success: false, error: 'No files provided for export.', exportedCount: 0, failedCount: 0 };
      }
      if (!destDir) {
        return { success: false, error: 'No destination directory provided.', exportedCount: 0, failedCount: 0 };
      }

      await fs.mkdir(destDir, { recursive: true });
      const usedNames = new Set();
      let exportedCount = 0;
      let failedCount = 0;
      let processedCount = 0;
      let stage = 'copying';
      const totalCount = files.length;
      const progressId = exportId ? String(exportId) : null;
      const PROGRESS_THROTTLE_MS = 200;
      let lastProgressAt = 0;
      const sendProgress = (force = false) => {
        const now = Date.now();
        if (!force && now - lastProgressAt < PROGRESS_THROTTLE_MS && processedCount < totalCount) {
          return;
        }
        lastProgressAt = now;
        try {
          if (event.sender.isDestroyed()) {
            return;
          }
          event.sender.send('export-batch-progress', {
            exportId: progressId,
            mode: 'folder',
            total: totalCount,
            processed: processedCount,
            exportedCount,
            failedCount,
            stage,
          });
        } catch (error) {
          console.warn('[Electron] Failed to send export progress update', error);
        }
      };
      const isCanceled = () => progressId ? activeCanceledExportIds.has(progressId) : false;

      sendProgress(true);

      for (const file of files) {
        if (isCanceled()) {
          stage = 'canceled';
          sendProgress(true);
          break;
        }

        try {
          const sourcePath = path.resolve(file.directoryPath, file.relativePath);
          if (!isPathAllowed(sourcePath)) {
            failedCount += 1;
            continue;
          }

          const artifact = await createExportArtifact({
            sourcePath,
            relativePath: file.relativePath,
            metadataPolicy,
            targetFormat,
            effectiveMetadata: file.effectiveMetadata,
          });
          const uniqueName = getUniqueName(artifact.fileName, usedNames);
          const destPath = path.resolve(destDir, uniqueName);
          await fs.writeFile(destPath, artifact.buffer);
          exportedCount += 1;
        } catch (error) {
          console.warn('[Electron] Failed to export file to folder:', file?.relativePath, error);
          failedCount += 1;
        } finally {
          processedCount += 1;
          sendProgress();
        }
      }

      const wasCanceled = isCanceled();
      stage = wasCanceled ? 'canceled' : 'done';
      sendProgress(true);
      if (progressId) {
        activeCanceledExportIds.delete(progressId);
      }

      if (wasCanceled) {
        return {
          success: false,
          exportedCount,
          failedCount,
          error: 'Export canceled.',
        };
      }

      const success = exportedCount > 0;
      return {
        success,
        exportedCount,
        failedCount,
        error: success ? undefined : 'No files were exported.',
      };
    } catch (error) {
      if (exportId) {
        activeCanceledExportIds.delete(String(exportId));
      }
      console.error('Error exporting images in batch:', error);
      return { success: false, error: error.message, exportedCount: 0, failedCount: 0 };
    }
  });

  ipcMain.handle('export-images-zip', async (event, {
    files,
    destZipPath,
    exportId,
    metadataPolicy = 'preserve',
    targetFormat = 'original',
  } = {}) => {
    try {
      if (!Array.isArray(files) || files.length === 0) {
        return { success: false, error: 'No files provided for export.', exportedCount: 0, failedCount: 0 };
      }
      if (!destZipPath) {
        return { success: false, error: 'No ZIP destination provided.', exportedCount: 0, failedCount: 0 };
      }

      await fs.mkdir(path.dirname(destZipPath), { recursive: true });
      const usedNames = new Set();
      let exportedCount = 0;
      let failedCount = 0;
      let processedCount = 0;
      let stage = 'copying';
      const totalCount = files.length;
      const progressId = exportId ? String(exportId) : null;
      const PROGRESS_THROTTLE_MS = 200;
      let lastProgressAt = 0;
      const sendProgress = (force = false) => {
        const now = Date.now();
        if (!force && now - lastProgressAt < PROGRESS_THROTTLE_MS && processedCount < totalCount) {
          return;
        }
        lastProgressAt = now;
        try {
          if (event.sender.isDestroyed()) {
            return;
          }
          event.sender.send('export-batch-progress', {
            exportId: progressId,
            mode: 'zip',
            total: totalCount,
            processed: processedCount,
            exportedCount,
            failedCount,
            stage,
          });
        } catch (error) {
          console.warn('[Electron] Failed to send export progress update', error);
        }
      };
      const isCanceled = () => progressId ? activeCanceledExportIds.has(progressId) : false;

      const output = fsSync.createWriteStream(destZipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      const finalizePromise = new Promise((resolve, reject) => {
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
      });

      archive.pipe(output);

      sendProgress(true);

      for (const file of files) {
        if (isCanceled()) {
          stage = 'canceled';
          sendProgress(true);
          archive.abort();
          output.destroy();
          break;
        }

        try {
          const sourcePath = path.resolve(file.directoryPath, file.relativePath);
          if (!isPathAllowed(sourcePath)) {
            failedCount += 1;
            continue;
          }

          const uniqueName = getUniqueName(path.basename(file.relativePath), usedNames);
          
          // For preserved files, stream directly from disk to avoid buffering entire file in memory
          if (metadataPolicy === 'preserve') {
            archive.file(sourcePath, { name: uniqueName });
          } else {
            // For rewritten artifacts (strip, metahub_standard), process through createExportArtifact
            const artifact = await createExportArtifact({
              sourcePath,
              relativePath: file.relativePath,
              metadataPolicy,
              targetFormat,
              effectiveMetadata: file.effectiveMetadata,
            });
            archive.append(artifact.buffer, { name: uniqueName });
          }
          exportedCount += 1;
        } catch (error) {
          console.warn('[Electron] Failed to export file to ZIP:', file?.relativePath, error);
          failedCount += 1;
        } finally {
          processedCount += 1;
          sendProgress();
        }
      }

      const wasCanceled = isCanceled();
      if (wasCanceled) {
        try {
          await fs.rm(destZipPath, { force: true });
        } catch {
          // ignore error
        }
        if (progressId) {
          activeCanceledExportIds.delete(progressId);
        }
        return {
          success: false,
          exportedCount,
          failedCount,
          error: 'Export canceled.',
        };
      }

      stage = 'finalizing';
      sendProgress(true);

      await archive.finalize();
      await finalizePromise;

      stage = 'done';
      sendProgress(true);
      if (progressId) {
        activeCanceledExportIds.delete(progressId);
      }

      const success = exportedCount > 0;
      return {
        success,
        exportedCount,
        failedCount,
        error: success ? undefined : 'No files were exported.',
      };
    } catch (error) {
      if (exportId) {
        activeCanceledExportIds.delete(String(exportId));
      }
      console.error('Error exporting images to ZIP:', error);
      return { success: false, error: error.message, exportedCount: 0, failedCount: 0 };
    }
  });

  ipcMain.handle('transfer-indexed-images', async (event, { files, destDir, mode, transferId } = {}) => {
    try {
      if (!Array.isArray(files) || files.length === 0) {
        return { success: false, transferred: [], failedCount: 0, error: 'No files provided for transfer.' };
      }
      if (!destDir) {
        return { success: false, transferred: [], failedCount: 0, error: 'No destination directory provided.' };
      }
      if (mode !== 'copy' && mode !== 'move') {
        return { success: false, transferred: [], failedCount: 0, error: 'Invalid transfer mode.' };
      }
      if (!isPathAllowed(destDir)) {
        return { success: false, transferred: [], failedCount: 0, error: 'Access denied: Destination must be an indexed folder.' };
      }

      await fs.mkdir(destDir, { recursive: true });

      const transferred = [];
      let failedCount = 0;
      const usedNames = new Set();
      let processed = 0;
      const total = files.length;
      const TRANSFER_CONCURRENCY = mode === 'move' ? 6 : 4;
      const progressTransferId = transferId ? String(transferId) : null;
      const sendProgress = (stage = 'copying', statusText) => {
        try {
          if (event.sender.isDestroyed()) {
            return;
          }
          event.sender.send('transfer-indexed-images-progress', {
            transferId: progressTransferId,
            mode,
            total,
            processed,
            transferredCount: transferred.length,
            failedCount,
            stage,
            statusText,
          });
        } catch (error) {
          console.warn('[Electron] Failed to send transfer progress update', error);
        }
      };

      sendProgress('copying', mode === 'move' ? 'Moving files...' : 'Copying files...');

      const plannedTransfers = [];

      for (const file of files) {
        try {
          const sourcePath = path.resolve(file.directoryPath, file.relativePath);
          if (!isPathAllowed(sourcePath)) {
            failedCount += 1;
            processed += 1;
            sendProgress('copying', `${mode === 'move' ? 'Moving' : 'Copying'} ${processed} of ${total}...`);
            continue;
          }

          if (path.normalize(file.directoryPath) === path.normalize(destDir)) {
            failedCount += 1;
            processed += 1;
            sendProgress('copying', `${mode === 'move' ? 'Moving' : 'Copying'} ${processed} of ${total}...`);
            continue;
          }

          const baseName = path.basename(file.relativePath);
          const { candidate, candidatePath } = await getUniqueDestinationPath(destDir, baseName, usedNames);

          if (path.normalize(sourcePath) === path.normalize(candidatePath)) {
            failedCount += 1;
            processed += 1;
            sendProgress('copying', `${mode === 'move' ? 'Moving' : 'Copying'} ${processed} of ${total}...`);
            continue;
          }

          plannedTransfers.push({
            sourceDirectoryPath: file.directoryPath,
            sourceRelativePath: file.relativePath,
            sourceAbsolutePath: sourcePath,
            destinationDirectoryPath: destDir,
            destinationRelativePath: candidate,
            destinationAbsolutePath: candidatePath,
            fileName: candidate
          });
        } catch {
          failedCount += 1;
          processed += 1;
          sendProgress(
            'copying',
            `${mode === 'move' ? 'Preparing move' : 'Preparing copy'} ${processed} of ${total}...`,
          );
        }
      }

      let nextTaskIndex = 0;
      const workerCount = Math.max(1, Math.min(TRANSFER_CONCURRENCY, plannedTransfers.length));

      const executeTransfer = async (task) => {
        if (mode === 'move') {
          try {
            await fs.rename(task.sourceAbsolutePath, task.destinationAbsolutePath);
          } catch (error) {
            if (error?.code === 'EXDEV') {
              await fs.copyFile(task.sourceAbsolutePath, task.destinationAbsolutePath);
              await fs.unlink(task.sourceAbsolutePath);
            } else {
              throw error;
            }
          }
        } else {
          await fs.copyFile(task.sourceAbsolutePath, task.destinationAbsolutePath);
        }

        const stats = await fs.stat(task.destinationAbsolutePath);
        transferred.push({
          sourceDirectoryPath: task.sourceDirectoryPath,
          sourceRelativePath: task.sourceRelativePath,
          destinationDirectoryPath: task.destinationDirectoryPath,
          destinationRelativePath: task.destinationRelativePath,
          destinationAbsolutePath: task.destinationAbsolutePath,
          fileName: task.fileName,
          size: stats.size,
          lastModified: stats.mtimeMs,
          type: getMimeTypeFromName(task.fileName),
        });
      };

      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (true) {
            const currentIndex = nextTaskIndex;
            nextTaskIndex += 1;
            if (currentIndex >= plannedTransfers.length) {
              return;
            }

            const task = plannedTransfers[currentIndex];
            try {
              await executeTransfer(task);
            } catch {
              failedCount += 1;
            } finally {
              processed += 1;
              sendProgress(
                processed >= total ? 'finalizing' : 'copying',
                processed >= total
                  ? 'Finalizing transfer...'
                  : `${mode === 'move' ? 'Moving' : 'Copying'} ${processed} of ${total}...`,
              );
            }
          }
        })
      );

      sendProgress('done', 'Transfer complete.');

      return {
        success: transferred.length > 0,
        transferred,
        failedCount,
        error: transferred.length > 0 ? undefined : `No files were ${mode === 'move' ? 'moved' : 'copied'}.`,
      };
    } catch (error) {
      console.error('Error transferring indexed images:', error);
      return { success: false, transferred: [], failedCount: 0, error: error.message };
    }
  });

  ipcMain.handle('delete-file', async (event, filePath) => {
    try {
      if (!isInternalPath(filePath)) {
        console.error('SECURITY VIOLATION: Attempted to delete file outside userData.');
        return { success: false, error: 'Access denied: Cannot delete files outside userData.' };
      }
      await fs.unlink(filePath);
      return { success: true };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { success: true };
      }
      console.error('Error deleting file:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ensure-directory', async (event, dirPath) => {
    try {
      if (!isAllowedOrInternal(dirPath)) {
        console.error('SECURITY VIOLATION: Attempted to create directory outside allowed paths.');
        return { success: false, error: 'Access denied: Cannot create directories outside allowed paths.' };
      }
      await fs.mkdir(dirPath, { recursive: true });
      return { success: true };
    } catch (error) {
      console.error('Error ensuring directory:', error);
      return { success: false, error: error.message };
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Stop all file watchers before quitting
  fileWatcher.stopAllWatchers();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => {
      console.error('Failed to recreate main window:', error);
    });
  }
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

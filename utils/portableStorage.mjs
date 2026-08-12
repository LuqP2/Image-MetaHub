import path from 'path';
import fsSync from 'fs';

// Portable mode keeps every piece of app state (settings, cache, thumbnails, logs)
// next to the executable instead of the per-user AppData/Application Support folder,
// so an installation on a USB drive carries its data between machines and leaves
// nothing behind on the host.
export const PORTABLE_MARKER_FILE_NAMES = ['portable.txt', '.portable'];
export const PORTABLE_DATA_DIR_NAME = 'data';
const WRITE_PROBE_FILE_NAME = '.imh-portable-write-test';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off']);

function readEnvValue(env, name) {
  const value = env?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

function isTruthyFlag(value) {
  return TRUTHY_VALUES.has(value.toLowerCase());
}

function isFalsyFlag(value) {
  return FALSY_VALUES.has(value.toLowerCase());
}

function firstMeaningfulLine(contents) {
  if (typeof contents !== 'string') return '';

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    return line;
  }

  return '';
}

function resolveAgainstBase(baseDir, candidate) {
  return path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(baseDir, candidate);
}

/**
 * Directory that represents "where the app was installed" for portable purposes.
 * This is the folder a user extracted the release into, not the internal bundle path.
 */
export function resolvePortableBaseDir({
  platform = process.platform,
  execPath = process.execPath,
  env = process.env,
  isPackaged = true,
  appRootDir = null,
} = {}) {
  // Unpackaged (dev) runs live in node_modules/electron, so anchor on the repo instead.
  if (!isPackaged) {
    return path.resolve(appRootDir || process.cwd());
  }

  // electron-builder's portable target extracts to a temp folder and points here.
  const portableExecutableDir = readEnvValue(env, 'PORTABLE_EXECUTABLE_DIR');
  if (portableExecutableDir) {
    return path.resolve(portableExecutableDir);
  }

  // An AppImage runs from a read-only mount; the .AppImage file itself is the install.
  const appImagePath = readEnvValue(env, 'APPIMAGE');
  if (platform === 'linux' && appImagePath) {
    return path.dirname(path.resolve(appImagePath));
  }

  const execDir = path.dirname(execPath);

  // On macOS the executable sits inside Foo.app/Contents/MacOS; use the folder holding the bundle.
  if (platform === 'darwin') {
    const bundleMatch = execDir.match(/^(.*)\/[^/]+\.app\/Contents\/MacOS\/?$/);
    if (bundleMatch) {
      return bundleMatch[1] || '/';
    }
  }

  return execDir;
}

/**
 * Looks for a portable marker file next to the installation.
 * An optional first non-comment line inside the marker overrides the data directory.
 */
export function readPortableMarker(baseDir, { fs = fsSync } = {}) {
  for (const fileName of PORTABLE_MARKER_FILE_NAMES) {
    const markerPath = path.join(baseDir, fileName);

    let exists = false;
    try {
      exists = fs.existsSync(markerPath) && !fs.statSync(markerPath).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) continue;

    let contents = '';
    try {
      contents = fs.readFileSync(markerPath, 'utf-8');
    } catch {
      contents = '';
    }

    return { markerPath, target: firstMeaningfulLine(contents) };
  }

  return null;
}

/**
 * Decides whether portable storage is requested and where it should live.
 * Resolution order: IMH_PORTABLE_DATA_DIR > IMH_PORTABLE > marker file next to the app.
 */
export function resolvePortableStorageTarget({
  platform = process.platform,
  execPath = process.execPath,
  env = process.env,
  isPackaged = true,
  appRootDir = null,
  fs = fsSync,
} = {}) {
  const baseDir = resolvePortableBaseDir({ platform, execPath, env, isPackaged, appRootDir });
  const explicitDataDir = readEnvValue(env, 'IMH_PORTABLE_DATA_DIR');
  const portableFlag = readEnvValue(env, 'IMH_PORTABLE');

  if (explicitDataDir) {
    return {
      enabled: true,
      source: 'env-path',
      baseDir,
      markerPath: null,
      dataDir: resolveAgainstBase(baseDir, explicitDataDir),
    };
  }

  if (portableFlag && isFalsyFlag(portableFlag)) {
    return { enabled: false, source: 'env-disabled', baseDir, markerPath: null, dataDir: null };
  }

  const marker = readPortableMarker(baseDir, { fs });
  const markerDataDir = marker?.target ? resolveAgainstBase(baseDir, marker.target) : null;

  if (portableFlag && isTruthyFlag(portableFlag)) {
    return {
      enabled: true,
      source: 'env-flag',
      baseDir,
      markerPath: marker?.markerPath || null,
      dataDir: markerDataDir || path.join(baseDir, PORTABLE_DATA_DIR_NAME),
    };
  }

  if (marker) {
    return {
      enabled: true,
      source: 'marker',
      baseDir,
      markerPath: marker.markerPath,
      dataDir: markerDataDir || path.join(baseDir, PORTABLE_DATA_DIR_NAME),
    };
  }

  return { enabled: false, source: 'not-configured', baseDir, markerPath: null, dataDir: null };
}

/**
 * "Reset app data" wipes everything inside the data directory, so it must never
 * be a folder that contains the application itself.
 */
export function isUnsafePortableDataDir(dataDir, execPath = process.execPath) {
  if (!dataDir || !execPath) return false;

  const normalizedDataDir = path.normalize(dataDir);
  const normalizedExecPath = path.normalize(execPath);
  const comparableDataDir = process.platform === 'win32' ? normalizedDataDir.toLowerCase() : normalizedDataDir;
  const comparableExecPath = process.platform === 'win32' ? normalizedExecPath.toLowerCase() : normalizedExecPath;

  return comparableExecPath.startsWith(comparableDataDir.replace(/[\\/]+$/, '') + path.sep);
}

function assertDirectoryIsWritable(dataDir, fs) {
  fs.mkdirSync(dataDir, { recursive: true });
  const probePath = path.join(dataDir, WRITE_PROBE_FILE_NAME);
  fs.writeFileSync(probePath, 'ok', 'utf-8');
  try {
    fs.unlinkSync(probePath);
  } catch {
    // Leaving the probe behind is harmless; the write itself is what we needed to verify.
  }
}

/**
 * First time an installation switches to portable mode, carry over the existing
 * settings file so the user does not have to reconfigure their library.
 * Only settings.json is copied - cache data is rebuilt on demand.
 */
function seedPortableSettings(dataDir, defaultUserDataDir, fs, logger) {
  if (!defaultUserDataDir || path.normalize(defaultUserDataDir) === path.normalize(dataDir)) {
    return false;
  }

  try {
    const targetSettings = path.join(dataDir, 'settings.json');
    if (fs.existsSync(targetSettings)) return false;

    const sourceSettings = path.join(defaultUserDataDir, 'settings.json');
    if (!fs.existsSync(sourceSettings)) return false;

    fs.copyFileSync(sourceSettings, targetSettings);
    logger?.log?.('[Portable] Copied existing settings.json into the portable data folder.');
    return true;
  } catch (error) {
    logger?.warn?.('[Portable] Failed to copy existing settings into the portable data folder:', error);
    return false;
  }
}

let portableStorageStatus = {
  enabled: false,
  source: 'not-initialized',
  baseDir: null,
  markerPath: null,
  dataDir: null,
  error: null,
};

export function getPortableStorageStatus() {
  return { ...portableStorageStatus };
}

/**
 * Redirects Electron's writable paths into the portable data folder.
 * Must run before anything reads app.getPath('userData'), i.e. at the very top of startup.
 */
export function activatePortableStorage({
  app,
  env = process.env,
  fs = fsSync,
  logger = console,
  appRootDir = null,
  platform = process.platform,
  execPath = process.execPath,
} = {}) {
  if (!app) {
    throw new Error('activatePortableStorage requires the Electron app instance.');
  }

  if (portableStorageStatus.source !== 'not-initialized') {
    return getPortableStorageStatus();
  }

  const target = resolvePortableStorageTarget({
    platform,
    execPath,
    env,
    isPackaged: app.isPackaged,
    appRootDir,
    fs,
  });

  if (!target.enabled) {
    portableStorageStatus = { ...target, error: null };
    return getPortableStorageStatus();
  }

  let defaultUserDataDir = null;
  try {
    defaultUserDataDir = app.getPath('userData');
  } catch {
    defaultUserDataDir = null;
  }

  if (isUnsafePortableDataDir(target.dataDir, execPath)) {
    const message = `The portable data folder "${target.dataDir}" contains the application itself. Choose a subfolder instead.`;
    logger?.error?.(`[Portable] ${message}`);
    portableStorageStatus = {
      ...target,
      enabled: false,
      source: 'unsafe-location',
      dataDir: defaultUserDataDir,
      error: message,
    };
    return getPortableStorageStatus();
  }

  try {
    assertDirectoryIsWritable(target.dataDir, fs);
  } catch (error) {
    const message = error?.message || String(error);
    logger?.error?.(
      `[Portable] Cannot write to "${target.dataDir}". Falling back to the default app data folder.`,
      error
    );
    portableStorageStatus = {
      ...target,
      enabled: false,
      source: 'unwritable',
      dataDir: defaultUserDataDir,
      error: message,
    };
    return getPortableStorageStatus();
  }

  seedPortableSettings(target.dataDir, defaultUserDataDir, fs, logger);

  // appData is what electron-updater and similar helpers derive their own folders from.
  try {
    app.setPath('appData', target.dataDir);
  } catch (error) {
    logger?.warn?.('[Portable] Failed to redirect the "appData" path:', error);
  }

  app.setPath('userData', target.dataDir);

  // sessionData, logs and crashDumps are resolved independently on some platforms,
  // so point them at the portable folder too - otherwise the host still gets written to.
  const derivedPaths = [
    ['sessionData', target.dataDir],
    ['logs', path.join(target.dataDir, 'logs')],
    ['crashDumps', path.join(target.dataDir, 'crashDumps')],
  ];

  for (const [name, value] of derivedPaths) {
    try {
      fs.mkdirSync(value, { recursive: true });
      app.setPath(name, value);
    } catch (error) {
      logger?.warn?.(`[Portable] Failed to redirect the "${name}" path:`, error);
    }
  }

  portableStorageStatus = { ...target, error: null };
  logger?.log?.(`[Portable] App data directory: ${target.dataDir} (source: ${target.source})`);
  return getPortableStorageStatus();
}

// Test-only: lets suites reset the module-level activation guard.
export function resetPortableStorageStatusForTests() {
  portableStorageStatus = {
    enabled: false,
    source: 'not-initialized',
    baseDir: null,
    markerPath: null,
    dataDir: null,
    error: null,
  };
}

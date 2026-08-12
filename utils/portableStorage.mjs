import path from 'path';
import fsSync from 'fs';

// Portable mode keeps every piece of app state (settings, cache, thumbnails, logs)
// next to the executable instead of the per-user AppData/Application Support folder,
// so an installation on a USB drive carries its data between machines and leaves
// nothing behind on the host.
export const PORTABLE_MARKER_FILE_NAMES = ['portable.txt', '.portable'];
export const PORTABLE_DATA_DIR_NAME = 'data';
export const PORTABLE_DATA_OWNER_FILE_NAME = '.image-metahub-portable-data';
export const PORTABLE_RETURN_MIGRATION_FILE_NAME = '.image-metahub-return-to-default.json';
const WRITE_PROBE_FILE_NAME = '.imh-portable-write-test';
const PORTABLE_PROFILE_PATHS = [
  'IndexedDB',
  'Local Storage',
  path.join('Partitions', 'imagemetahub-comfyui', 'IndexedDB'),
  path.join('Partitions', 'imagemetahub-comfyui', 'Local Storage'),
];
const PORTABLE_DATA_OWNER_CONTENTS = 'Image MetaHub portable data directory\n';
const ENV_MANAGED_PORTABLE_SOURCES = new Set(['env-flag', 'env-path', 'env-disabled']);

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
 * Creates the marker file that turns portable mode on for the next launch.
 * Existing marker contents (a custom data folder) are preserved unless the
 * caller is recovering from a failed marker-based activation.
 */
export function writePortableMarker(baseDir, { fs = fsSync, replaceExisting = false } = {}) {
  const existing = readPortableMarker(baseDir, { fs });
  if (existing && !replaceExisting) return existing.markerPath;

  const markerPath = path.join(baseDir, PORTABLE_MARKER_FILE_NAMES[0]);
  fs.writeFileSync(
    markerPath,
    [
      '# Image MetaHub portable mode.',
      '# Delete this file to store app data in the normal per-user location again.',
      '# Optional: write a folder path below to store the data somewhere else.',
      '',
    ].join('\n'),
    'utf-8'
  );

  return markerPath;
}

/**
 * Removes every marker file, so the next launch uses the normal per-user location.
 */
export function removePortableMarkers(baseDir, { fs = fsSync } = {}) {
  const removed = [];

  for (const fileName of PORTABLE_MARKER_FILE_NAMES) {
    const markerPath = path.join(baseDir, fileName);
    try {
      if (!fs.existsSync(markerPath)) continue;
      fs.unlinkSync(markerPath);
      removed.push(markerPath);
    } catch (error) {
      throw new Error(`Failed to remove "${markerPath}": ${error?.message || error}`);
    }
  }

  return removed;
}

export function readPortableReturnMigration(baseDir, { fs = fsSync } = {}) {
  const markerPath = path.join(baseDir, PORTABLE_RETURN_MIGRATION_FILE_NAME);
  try {
    if (!fs.existsSync(markerPath) || fs.statSync(markerPath).isDirectory()) return null;
    const payload = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    if (!payload || typeof payload.sourceDataDir !== 'string' || !payload.sourceDataDir.trim()) return null;
    return {
      markerPath,
      sourceDataDir: resolveAgainstBase(baseDir, payload.sourceDataDir.trim()),
    };
  } catch {
    return null;
  }
}

export function schedulePortableReturnMigration(baseDir, sourceDataDir, { fs = fsSync } = {}) {
  if (!sourceDataDir) throw new Error('Cannot return to the standard profile without the portable data folder.');

  const markerPath = path.join(baseDir, PORTABLE_RETURN_MIGRATION_FILE_NAME);
  const temporaryPath = `${markerPath}.tmp`;
  try {
    fs.rmSync(temporaryPath, { force: true });
    fs.writeFileSync(temporaryPath, JSON.stringify({ sourceDataDir: path.resolve(sourceDataDir) }, null, 2), 'utf-8');
    fs.rmSync(markerPath, { force: true });
    fs.renameSync(temporaryPath, markerPath);
    return markerPath;
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original scheduling error.
    }
    throw error;
  }
}

export function removePortableReturnMigration(baseDir, { fs = fsSync } = {}) {
  const markerPath = path.join(baseDir, PORTABLE_RETURN_MIGRATION_FILE_NAME);
  fs.rmSync(markerPath, { force: true });
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

  const returnMigration = readPortableReturnMigration(baseDir, { fs });
  if (returnMigration) {
    return {
      enabled: false,
      source: 'return-to-default',
      baseDir,
      markerPath: marker?.markerPath || null,
      dataDir: null,
      returnMigration,
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
export function isUnsafePortableDataDir(
  dataDir,
  execPath = process.execPath,
  { fs = fsSync, platform = process.platform, resolveSymlinks = true } = {}
) {
  if (!dataDir || !execPath) return false;

  const resolveRealPath = (candidate) => {
    if (!resolveSymlinks) return path.resolve(candidate);

    const realpathSync = fs?.realpathSync?.native || fs?.realpathSync;
    if (typeof realpathSync !== 'function') return path.resolve(candidate);

    try {
      return realpathSync.call(fs.realpathSync, candidate);
    } catch (error) {
      if (error?.code === 'ENOENT') return path.resolve(candidate);
      throw error;
    }
  };

  const normalizedDataDir = path.normalize(resolveRealPath(dataDir));
  const normalizedExecPath = path.normalize(resolveRealPath(execPath));
  const comparableDataDir = platform === 'win32' ? normalizedDataDir.toLowerCase() : normalizedDataDir;
  const comparableExecPath = platform === 'win32' ? normalizedExecPath.toLowerCase() : normalizedExecPath;
  const relativeExecPath = path.relative(comparableDataDir, comparableExecPath);

  return relativeExecPath === '' || (!relativeExecPath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeExecPath));
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
 * Checks upfront that a folder can actually host portable data, so turning the
 * setting on fails loudly instead of silently falling back on the next launch.
 */
export function ensurePortableDataDirIsUsable(dataDir, { execPath = process.execPath, fs = fsSync } = {}) {
  // Reject an obviously unsafe lexical path before creating anything. Once the
  // directory exists, repeat the check with real paths to catch symlinks.
  if (isUnsafePortableDataDir(dataDir, execPath, { fs, resolveSymlinks: false })) {
    throw new Error(`The folder "${dataDir}" contains the application itself. Choose a subfolder instead.`);
  }

  fs.mkdirSync(dataDir, { recursive: true });

  if (isUnsafePortableDataDir(dataDir, execPath, { fs })) {
    throw new Error(`The folder "${dataDir}" contains the application itself. Choose a subfolder instead.`);
  }

  ensurePortableDataDirOwnership(dataDir, fs);
  assertDirectoryIsWritable(dataDir, fs);
}

/**
 * Copies a file or directory through a sibling temporary path so a failed
 * migration never leaves a partial target that would be mistaken for complete.
 */
function copyPortableEntryAtomically(sourcePath, targetPath, fs, { replaceExisting = false } = {}) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.portable-migration`;
  const backupPath = `${targetPath}.portable-backup`;
  if (fs.existsSync(backupPath)) {
    if (!fs.existsSync(targetPath)) {
      fs.renameSync(backupPath, targetPath);
    } else {
      fs.rmSync(backupPath, { recursive: true, force: true });
    }
  }

  const targetExists = fs.existsSync(targetPath);
  if (targetExists && !replaceExisting) return false;

  let movedTargetToBackup = false;
  try {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
    fs.cpSync(sourcePath, temporaryPath, { recursive: true });
    if (targetExists) {
      fs.renameSync(targetPath, backupPath);
      movedTargetToBackup = true;
    }
    fs.renameSync(temporaryPath, targetPath);
    fs.rmSync(backupPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { recursive: true, force: true });
      if (movedTargetToBackup && !fs.existsSync(targetPath) && fs.existsSync(backupPath)) {
        fs.renameSync(backupPath, targetPath);
      }
    } catch {
      // Preserve the original migration error.
    }
    throw error;
  }
}

function ensurePortableDataDirOwnership(dataDir, fs) {
  const ownerPath = path.join(dataDir, PORTABLE_DATA_OWNER_FILE_NAME);

  if (fs.existsSync(ownerPath)) {
    const ownerStats = fs.statSync(ownerPath);
    const ownerContents = ownerStats.isDirectory() ? '' : fs.readFileSync(ownerPath, 'utf-8');
    if (!ownerStats.isDirectory() && ownerContents === PORTABLE_DATA_OWNER_CONTENTS) return;

    throw new Error(`The folder "${dataDir}" has an invalid Image MetaHub ownership marker.`);
  }

  const entries = fs.readdirSync(dataDir);
  if (entries.length > 0) {
    throw new Error(
      `The folder "${dataDir}" is not empty and is not owned by Image MetaHub. Choose an empty dedicated folder instead.`
    );
  }

  fs.writeFileSync(ownerPath, PORTABLE_DATA_OWNER_CONTENTS, { encoding: 'utf-8', flag: 'wx' });
}

function seedPortableSettings(dataDir, defaultUserDataDir, fs) {
  if (!defaultUserDataDir || path.normalize(defaultUserDataDir) === path.normalize(dataDir)) return false;

  const targetSettings = path.join(dataDir, 'settings.json');
  if (fs.existsSync(targetSettings)) return false;

  const sourceSettings = path.join(defaultUserDataDir, 'settings.json');
  if (!fs.existsSync(sourceSettings)) return false;

  const settings = JSON.parse(fs.readFileSync(sourceSettings, 'utf-8'));
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Existing settings.json does not contain a settings object.');
  }

  // A host-specific custom cache would defeat portable mode. Null selects the
  // redirected userData folder while leaving every other setting intact.
  settings.cachePath = null;

  const temporarySettings = `${targetSettings}.portable-migration`;
  try {
    fs.rmSync(temporarySettings, { force: true });
    fs.writeFileSync(temporarySettings, JSON.stringify(settings, null, 2), 'utf-8');
    fs.renameSync(temporarySettings, targetSettings);
    return true;
  } catch (error) {
    try {
      fs.rmSync(temporarySettings, { force: true });
    } catch {
      // Preserve the original migration error.
    }
    throw error;
  }
}

/**
 * First time an installation switches to portable mode, carry over settings
 * plus the Chromium stores that hold renderer localStorage and IndexedDB data.
 * Rebuildable image caches and thumbnails are intentionally not copied.
 */
function migratePortableData(dataDir, defaultUserDataDir, defaultSessionDataDir, fs, logger) {
  const migratedEntries = [];

  try {
    if (seedPortableSettings(dataDir, defaultUserDataDir, fs)) {
      migratedEntries.push('settings.json');
    }

    if (
      defaultSessionDataDir
      && path.normalize(defaultSessionDataDir) !== path.normalize(dataDir)
    ) {
      for (const relativePath of PORTABLE_PROFILE_PATHS) {
        const sourcePath = path.join(defaultSessionDataDir, relativePath);
        if (!fs.existsSync(sourcePath)) continue;

        const sourceStats = fs.statSync(sourcePath);
        if (!sourceStats.isDirectory()) continue;

        if (copyPortableEntryAtomically(sourcePath, path.join(dataDir, relativePath), fs)) {
          migratedEntries.push(relativePath);
        }
      }
    }
  } catch (error) {
    logger?.error?.('[Portable] Failed to migrate existing app data into the portable folder:', error);
    throw error;
  }

  if (migratedEntries.length > 0) {
    logger?.log?.(`[Portable] Migrated existing app data: ${migratedEntries.join(', ')}.`);
  }

  return migratedEntries.length > 0;
}

function migratePortableDataToDefault(
  sourceDataDir,
  defaultUserDataDir,
  defaultSessionDataDir,
  fs,
  logger
) {
  if (!sourceDataDir || !defaultUserDataDir || !defaultSessionDataDir) {
    throw new Error('Could not resolve both portable and standard profile folders for migration.');
  }

  const migratedEntries = [];
  const sourceSettings = path.join(sourceDataDir, 'settings.json');
  if (fs.existsSync(sourceSettings)) {
    copyPortableEntryAtomically(sourceSettings, path.join(defaultUserDataDir, 'settings.json'), fs, {
      replaceExisting: true,
    });
    migratedEntries.push('settings.json');
  }

  for (const relativePath of PORTABLE_PROFILE_PATHS) {
    const sourcePath = path.join(sourceDataDir, relativePath);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) continue;

    copyPortableEntryAtomically(sourcePath, path.join(defaultSessionDataDir, relativePath), fs, {
      replaceExisting: true,
    });
    migratedEntries.push(relativePath);
  }

  logger?.log?.(`[Portable] Migrated app data back to the standard profile: ${migratedEntries.join(', ')}.`);
  return migratedEntries.length > 0;
}

let portableStorageStatus = {
  enabled: false,
  source: 'not-initialized',
  requestedSource: null,
  baseDir: null,
  markerPath: null,
  dataDir: null,
  error: null,
};

export function getPortableStorageStatus() {
  return { ...portableStorageStatus };
}

export function isPortableStorageManagedByEnvironment(status = portableStorageStatus) {
  return ENV_MANAGED_PORTABLE_SOURCES.has(status?.requestedSource || status?.source);
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

  let target = resolvePortableStorageTarget({
    platform,
    execPath,
    env,
    isPackaged: app.isPackaged,
    appRootDir,
    fs,
  });

  let defaultUserDataDir = null;
  let defaultSessionDataDir = null;
  try {
    defaultUserDataDir = app.getPath('userData');
  } catch {
    defaultUserDataDir = null;
  }
  try {
    defaultSessionDataDir = app.getPath('sessionData') || defaultUserDataDir;
  } catch {
    defaultSessionDataDir = defaultUserDataDir;
  }

  let activationError = null;
  const returnMigration = readPortableReturnMigration(target.baseDir, { fs });
  if (!target.enabled && returnMigration) {
    try {
      migratePortableDataToDefault(
        returnMigration.sourceDataDir,
        defaultUserDataDir,
        defaultSessionDataDir,
        fs,
        logger
      );
      removePortableReturnMigration(target.baseDir, { fs });
      removePortableMarkers(target.baseDir, { fs });
      portableStorageStatus = { ...target, markerPath: null, error: null };
      return getPortableStorageStatus();
    } catch (error) {
      activationError = error?.message || String(error);
      logger?.error?.(
        '[Portable] Failed to migrate app data back to the standard profile. Continuing with portable data.',
        error
      );
      target = {
        enabled: true,
        source: 'return-migration-failed',
        requestedSource: target.source,
        baseDir: target.baseDir,
        markerPath: readPortableMarker(target.baseDir, { fs })?.markerPath || null,
        dataDir: returnMigration.sourceDataDir,
      };
    }
  }

  if (!target.enabled) {
    portableStorageStatus = { ...target, error: null };
    return getPortableStorageStatus();
  }

  if (isUnsafePortableDataDir(target.dataDir, execPath, { fs, platform, resolveSymlinks: false })) {
    const message = `The portable data folder "${target.dataDir}" contains the application itself. Choose a subfolder instead.`;
    logger?.error?.(`[Portable] ${message}`);
    portableStorageStatus = {
      ...target,
      enabled: false,
      source: 'unsafe-location',
      requestedSource: target.source,
      dataDir: defaultUserDataDir,
      error: message,
    };
    return getPortableStorageStatus();
  }

  try {
    fs.mkdirSync(target.dataDir, { recursive: true });
  } catch (error) {
    const message = error?.message || String(error);
    logger?.error?.(
      `[Portable] Cannot create "${target.dataDir}". Falling back to the default app data folder.`,
      error
    );
    portableStorageStatus = {
      ...target,
      enabled: false,
      source: 'unwritable',
      requestedSource: target.source,
      dataDir: defaultUserDataDir,
      error: message,
    };
    return getPortableStorageStatus();
  }

  if (isUnsafePortableDataDir(target.dataDir, execPath, { fs, platform })) {
    const message = `The portable data folder "${target.dataDir}" contains the application itself. Choose a subfolder instead.`;
    logger?.error?.(`[Portable] ${message}`);
    portableStorageStatus = {
      ...target,
      enabled: false,
      source: 'unsafe-location',
      requestedSource: target.source,
      dataDir: defaultUserDataDir,
      error: message,
    };
    return getPortableStorageStatus();
  }

  try {
    ensurePortableDataDirOwnership(target.dataDir, fs);
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
      requestedSource: target.source,
      dataDir: defaultUserDataDir,
      error: message,
    };
    return getPortableStorageStatus();
  }

  try {
    migratePortableData(target.dataDir, defaultUserDataDir, defaultSessionDataDir, fs, logger);
  } catch (error) {
    const message = error?.message || String(error);
    portableStorageStatus = {
      ...target,
      enabled: false,
      source: 'migration-failed',
      requestedSource: target.source,
      dataDir: defaultUserDataDir,
      error: message,
    };
    return getPortableStorageStatus();
  }

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

  portableStorageStatus = { ...target, error: activationError };
  logger?.log?.(`[Portable] App data directory: ${target.dataDir} (source: ${target.source})`);
  return getPortableStorageStatus();
}

// Test-only: lets suites reset the module-level activation guard.
export function resetPortableStorageStatusForTests() {
  portableStorageStatus = {
    enabled: false,
    source: 'not-initialized',
    requestedSource: null,
    baseDir: null,
    markerPath: null,
    dataDir: null,
    error: null,
  };
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fsSync from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  PORTABLE_DATA_DIR_NAME,
  activatePortableStorage,
  ensurePortableDataDirIsUsable,
  getPortableStorageStatus,
  isUnsafePortableDataDir,
  readPortableMarker,
  removePortableMarkers,
  resetPortableStorageStatusForTests,
  resolvePortableBaseDir,
  resolvePortableStorageTarget,
  writePortableMarker,
} from '../utils/portableStorage.mjs';

type FakeFileMap = Record<string, string>;

// Minimal fs stub: only the sync reads resolvePortableStorageTarget performs.
const makeFakeFs = (files: FakeFileMap) => ({
  existsSync: (target: string) => Object.prototype.hasOwnProperty.call(files, path.normalize(target)),
  statSync: () => ({ isDirectory: () => false }),
  readFileSync: (target: string) => {
    const key = path.normalize(target);
    if (!Object.prototype.hasOwnProperty.call(files, key)) {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }
    return files[key];
  },
});

const INSTALL_DIR = path.resolve(path.sep === '\\' ? 'D:\\PortableApps\\ImageMetaHub' : '/media/usb/ImageMetaHub');
const EXEC_PATH = path.join(INSTALL_DIR, 'Image MetaHub.exe');
const markerPath = (name: string) => path.join(INSTALL_DIR, name);

const resolveTarget = (options: Record<string, unknown> = {}, files: FakeFileMap = {}) =>
  resolvePortableStorageTarget({
    platform: 'win32',
    execPath: EXEC_PATH,
    env: {},
    isPackaged: true,
    fs: makeFakeFs(files),
    ...options,
  });

describe('resolvePortableBaseDir', () => {
  it('uses the app root when the app is not packaged', () => {
    const baseDir = resolvePortableBaseDir({
      isPackaged: false,
      appRootDir: INSTALL_DIR,
      execPath: path.join(INSTALL_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    });

    expect(baseDir).toBe(INSTALL_DIR);
  });

  it('prefers PORTABLE_EXECUTABLE_DIR over the executable location', () => {
    const baseDir = resolvePortableBaseDir({
      platform: 'win32',
      execPath: path.join(os.tmpdir(), 'extracted', 'Image MetaHub.exe'),
      env: { PORTABLE_EXECUTABLE_DIR: INSTALL_DIR },
    });

    expect(baseDir).toBe(INSTALL_DIR);
  });

  it('uses the AppImage location on Linux', () => {
    const baseDir = resolvePortableBaseDir({
      platform: 'linux',
      execPath: '/tmp/.mount_abc/usr/bin/image-metahub',
      env: { APPIMAGE: '/media/usb/Image MetaHub.AppImage' },
    });

    expect(baseDir).toBe(path.dirname(path.resolve('/media/usb/Image MetaHub.AppImage')));
  });

  it('uses the folder holding the bundle on macOS', () => {
    const baseDir = resolvePortableBaseDir({
      platform: 'darwin',
      execPath: '/Volumes/USB/Image MetaHub.app/Contents/MacOS/Image MetaHub',
      env: {},
    });

    expect(baseDir).toBe('/Volumes/USB');
  });

  it('falls back to the executable folder', () => {
    expect(resolvePortableBaseDir({ platform: 'win32', execPath: EXEC_PATH, env: {} })).toBe(INSTALL_DIR);
  });
});

describe('readPortableMarker', () => {
  it('returns null when no marker exists', () => {
    expect(readPortableMarker(INSTALL_DIR, { fs: makeFakeFs({}) })).toBeNull();
  });

  it('reads the first non-comment line as the data directory override', () => {
    const marker = readPortableMarker(INSTALL_DIR, {
      fs: makeFakeFs({ [markerPath('portable.txt')]: '# where to store data\n\n  my-data  \nignored\n' }),
    });

    expect(marker).toEqual({ markerPath: markerPath('portable.txt'), target: 'my-data' });
  });

  it('treats an empty marker as "use the default folder"', () => {
    const marker = readPortableMarker(INSTALL_DIR, { fs: makeFakeFs({ [markerPath('.portable')]: '' }) });

    expect(marker?.target).toBe('');
  });
});

describe('resolvePortableStorageTarget', () => {
  it('stays disabled without a marker or env flag', () => {
    const target = resolveTarget();

    expect(target).toMatchObject({ enabled: false, source: 'not-configured', dataDir: null, baseDir: INSTALL_DIR });
  });

  it('enables portable mode from a marker file, defaulting to the data subfolder', () => {
    const target = resolveTarget({}, { [markerPath('portable.txt')]: '' });

    expect(target).toMatchObject({
      enabled: true,
      source: 'marker',
      dataDir: path.join(INSTALL_DIR, PORTABLE_DATA_DIR_NAME),
    });
  });

  it('resolves a relative marker path against the installation folder', () => {
    const target = resolveTarget({}, { [markerPath('portable.txt')]: 'imh-data' });

    expect(target.dataDir).toBe(path.join(INSTALL_DIR, 'imh-data'));
  });

  it('honours an absolute marker path', () => {
    const absolute = path.join(INSTALL_DIR, '..', 'shared-data');
    const target = resolveTarget({}, { [markerPath('portable.txt')]: absolute });

    expect(target.dataDir).toBe(path.normalize(absolute));
  });

  it('enables portable mode from IMH_PORTABLE without a marker', () => {
    const target = resolveTarget({ env: { IMH_PORTABLE: 'true' } });

    expect(target).toMatchObject({ enabled: true, source: 'env-flag', dataDir: path.join(INSTALL_DIR, PORTABLE_DATA_DIR_NAME) });
  });

  it('lets IMH_PORTABLE_DATA_DIR win over a marker file', () => {
    const target = resolveTarget(
      { env: { IMH_PORTABLE_DATA_DIR: 'from-env' } },
      { [markerPath('portable.txt')]: 'from-marker' }
    );

    expect(target).toMatchObject({ enabled: true, source: 'env-path', dataDir: path.join(INSTALL_DIR, 'from-env') });
  });

  it('lets IMH_PORTABLE=0 disable a marker file', () => {
    const target = resolveTarget({ env: { IMH_PORTABLE: '0' } }, { [markerPath('portable.txt')]: '' });

    expect(target).toMatchObject({ enabled: false, source: 'env-disabled', dataDir: null });
  });
});

describe('marker file writes', () => {
  const created: string[] = [];
  const makeTempDir = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-portable-marker-'));
    created.push(dir);
    return dir;
  };

  afterEach(async () => {
    await Promise.all(created.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('writes a marker that turns portable mode on for the next launch', async () => {
    const baseDir = await makeTempDir();
    const written = writePortableMarker(baseDir);

    expect(written).toBe(path.join(baseDir, 'portable.txt'));
    expect(
      resolvePortableStorageTarget({ env: {}, execPath: path.join(baseDir, 'Image MetaHub.exe') })
    ).toMatchObject({ enabled: true, source: 'marker', dataDir: path.join(baseDir, PORTABLE_DATA_DIR_NAME) });
  });

  it('keeps a custom data folder already written in the marker', async () => {
    const baseDir = await makeTempDir();
    await fs.writeFile(path.join(baseDir, 'portable.txt'), 'custom-folder');

    writePortableMarker(baseDir);

    expect(await fs.readFile(path.join(baseDir, 'portable.txt'), 'utf-8')).toBe('custom-folder');
  });

  it('replaces a failed custom marker when Settings enables the default portable folder', async () => {
    const baseDir = await makeTempDir();
    await fs.writeFile(path.join(baseDir, 'portable.txt'), 'missing-or-unsafe-folder');

    writePortableMarker(baseDir, { replaceExisting: true });

    expect(
      resolvePortableStorageTarget({ env: {}, execPath: path.join(baseDir, 'Image MetaHub.exe') })
    ).toMatchObject({ enabled: true, dataDir: path.join(baseDir, PORTABLE_DATA_DIR_NAME) });
  });

  it('removes every marker so the next launch uses the default location', async () => {
    const baseDir = await makeTempDir();
    await fs.writeFile(path.join(baseDir, 'portable.txt'), '');
    await fs.writeFile(path.join(baseDir, '.portable'), '');

    const removed = removePortableMarkers(baseDir);

    expect(removed).toHaveLength(2);
    expect(
      resolvePortableStorageTarget({ env: {}, execPath: path.join(baseDir, 'Image MetaHub.exe') })
    ).toMatchObject({ enabled: false, source: 'not-configured' });
  });

  it('is a no-op when there is no marker to remove', async () => {
    const baseDir = await makeTempDir();

    expect(removePortableMarkers(baseDir)).toEqual([]);
  });
});

describe('ensurePortableDataDirIsUsable', () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(created.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('creates the folder when it can be written to', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-portable-usable-'));
    created.push(baseDir);
    const dataDir = path.join(baseDir, PORTABLE_DATA_DIR_NAME);

    ensurePortableDataDirIsUsable(dataDir, { execPath: path.join(baseDir, 'Image MetaHub.exe') });

    expect(fsSync.existsSync(dataDir)).toBe(true);
  });

  it('rejects a folder that contains the app', () => {
    expect(() => ensurePortableDataDirIsUsable(INSTALL_DIR, { execPath: EXEC_PATH })).toThrow(
      /contains the application itself/
    );
  });
});

describe('isUnsafePortableDataDir', () => {
  it('rejects a data folder that contains the executable', () => {
    expect(isUnsafePortableDataDir(INSTALL_DIR, EXEC_PATH)).toBe(true);
  });

  it('accepts a subfolder of the installation', () => {
    expect(isUnsafePortableDataDir(path.join(INSTALL_DIR, PORTABLE_DATA_DIR_NAME), EXEC_PATH)).toBe(false);
  });

  it('rejects a symlink whose resolved target contains the executable', () => {
    const linkedDataDir = path.join(INSTALL_DIR, 'linked-data');
    const realpathSync = vi.fn((candidate: fsSync.PathLike) => {
      const normalized = path.normalize(String(candidate));
      if (normalized === path.normalize(linkedDataDir)) return INSTALL_DIR;
      return normalized;
    });
    Object.assign(realpathSync, { native: realpathSync });

    expect(
      isUnsafePortableDataDir(linkedDataDir, EXEC_PATH, {
        platform: 'win32',
        fs: { realpathSync } as unknown as typeof fsSync,
      })
    ).toBe(true);
  });
});

describe('activatePortableStorage', () => {
  const created: string[] = [];
  const makeTempDir = async (prefix: string) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    created.push(dir);
    return dir;
  };

  const makeFakeApp = (defaultUserData: string) => {
    const paths: Record<string, string> = { userData: defaultUserData, sessionData: defaultUserData };
    return {
      isPackaged: true,
      getPath: (name: string) => paths[name],
      setPath: (name: string, value: string) => {
        paths[name] = value;
      },
      paths,
    };
  };

  const silentLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    resetPortableStorageStatusForTests();
  });

  afterEach(async () => {
    resetPortableStorageStatusForTests();
    await Promise.all(created.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('leaves Electron paths untouched when portable mode is off', async () => {
    const defaultUserData = await makeTempDir('imh-portable-default-');
    const app = makeFakeApp(defaultUserData);

    const status = activatePortableStorage({
      app,
      env: {},
      logger: silentLogger,
      platform: 'win32',
      execPath: EXEC_PATH,
      fs: makeFakeFs({}) as unknown as typeof fsSync,
    });

    expect(status.enabled).toBe(false);
    expect(app.paths.userData).toBe(defaultUserData);
  });

  it('redirects userData, sessionData, logs and crashDumps into the portable folder', async () => {
    const installDir = await makeTempDir('imh-portable-install-');
    const defaultUserData = await makeTempDir('imh-portable-default-');
    const execPath = path.join(installDir, 'Image MetaHub.exe');
    await fs.writeFile(path.join(installDir, 'portable.txt'), '');
    const app = makeFakeApp(defaultUserData);

    const status = activatePortableStorage({ app, env: {}, logger: silentLogger, execPath });
    const dataDir = path.join(installDir, PORTABLE_DATA_DIR_NAME);

    expect(status).toMatchObject({ enabled: true, source: 'marker', dataDir, error: null });
    expect(app.paths.userData).toBe(dataDir);
    expect(app.paths.appData).toBe(dataDir);
    expect(app.paths.sessionData).toBe(dataDir);
    expect(app.paths.logs).toBe(path.join(dataDir, 'logs'));
    expect(app.paths.crashDumps).toBe(path.join(dataDir, 'crashDumps'));
    expect(fsSync.existsSync(dataDir)).toBe(true);
    expect(getPortableStorageStatus().dataDir).toBe(dataDir);
  });

  it('migrates settings and persistent renderer stores into an empty portable folder', async () => {
    const installDir = await makeTempDir('imh-portable-install-');
    const defaultUserData = await makeTempDir('imh-portable-default-');
    await fs.writeFile(path.join(installDir, 'portable.txt'), '');
    await fs.writeFile(path.join(defaultUserData, 'settings.json'), '{"cachePath":"K:\\\\cache","theme":"dark"}');
    await fs.mkdir(path.join(defaultUserData, 'Local Storage', 'leveldb'), { recursive: true });
    await fs.writeFile(path.join(defaultUserData, 'Local Storage', 'leveldb', 'renderer-state'), 'directories');
    await fs.mkdir(path.join(defaultUserData, 'IndexedDB', 'file__0.indexeddb.leveldb'), { recursive: true });
    await fs.writeFile(
      path.join(defaultUserData, 'IndexedDB', 'file__0.indexeddb.leveldb', 'preferences'),
      'annotations'
    );

    activatePortableStorage({
      app: makeFakeApp(defaultUserData),
      env: {},
      logger: silentLogger,
      execPath: path.join(installDir, 'Image MetaHub.exe'),
    });

    const dataDir = path.join(installDir, PORTABLE_DATA_DIR_NAME);
    const copiedSettings = JSON.parse(await fs.readFile(path.join(dataDir, 'settings.json'), 'utf-8'));
    expect(copiedSettings).toEqual({ cachePath: null, theme: 'dark' });
    expect(await fs.readFile(path.join(dataDir, 'Local Storage', 'leveldb', 'renderer-state'), 'utf-8')).toBe(
      'directories'
    );
    expect(
      await fs.readFile(path.join(dataDir, 'IndexedDB', 'file__0.indexeddb.leveldb', 'preferences'), 'utf-8')
    ).toBe('annotations');
  });

  it('keeps portable settings that already exist', async () => {
    const installDir = await makeTempDir('imh-portable-install-');
    const defaultUserData = await makeTempDir('imh-portable-default-');
    await fs.writeFile(path.join(installDir, 'portable.txt'), '');
    await fs.mkdir(path.join(installDir, PORTABLE_DATA_DIR_NAME));
    await fs.writeFile(path.join(installDir, PORTABLE_DATA_DIR_NAME, 'settings.json'), '{"portable":true}');
    await fs.writeFile(path.join(defaultUserData, 'settings.json'), '{"portable":false}');

    activatePortableStorage({
      app: makeFakeApp(defaultUserData),
      env: {},
      logger: silentLogger,
      execPath: path.join(installDir, 'Image MetaHub.exe'),
    });

    const kept = await fs.readFile(path.join(installDir, PORTABLE_DATA_DIR_NAME, 'settings.json'), 'utf-8');
    expect(kept).toBe('{"portable":true}');
  });

  it('refuses a data folder that would contain the app itself', async () => {
    const installDir = await makeTempDir('imh-portable-install-');
    const defaultUserData = await makeTempDir('imh-portable-default-');
    await fs.writeFile(path.join(installDir, 'portable.txt'), installDir);
    const app = makeFakeApp(defaultUserData);

    const status = activatePortableStorage({
      app,
      env: {},
      logger: silentLogger,
      execPath: path.join(installDir, 'Image MetaHub.exe'),
    });

    expect(status).toMatchObject({ enabled: false, source: 'unsafe-location', dataDir: defaultUserData });
    expect(status.error).toContain('contains the application itself');
    expect(app.paths.userData).toBe(defaultUserData);
  });

  it('falls back to the default folder when the portable folder is read-only', async () => {
    const defaultUserData = await makeTempDir('imh-portable-default-');
    const app = makeFakeApp(defaultUserData);
    const readOnlyFs = {
      ...makeFakeFs({ [markerPath('portable.txt')]: '' }),
      mkdirSync: () => undefined,
      writeFileSync: () => {
        throw Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' });
      },
      unlinkSync: () => undefined,
      copyFileSync: () => undefined,
    };

    const status = activatePortableStorage({
      app,
      env: {},
      logger: silentLogger,
      platform: 'win32',
      execPath: EXEC_PATH,
      fs: readOnlyFs as unknown as typeof fsSync,
    });

    expect(status).toMatchObject({ enabled: false, source: 'unwritable', dataDir: defaultUserData });
    expect(status.error).toContain('EROFS');
    expect(app.paths.userData).toBe(defaultUserData);
  });

  it('does not redirect Electron paths when persistent profile migration fails', async () => {
    const installDir = await makeTempDir('imh-portable-install-');
    const defaultUserData = await makeTempDir('imh-portable-default-');
    await fs.writeFile(path.join(installDir, 'portable.txt'), '');
    await fs.mkdir(path.join(defaultUserData, 'IndexedDB'));
    const app = makeFakeApp(defaultUserData);
    const failingFs = {
      ...fsSync,
      cpSync: () => {
        throw new Error('profile copy failed');
      },
    };

    const status = activatePortableStorage({
      app,
      env: {},
      logger: silentLogger,
      execPath: path.join(installDir, 'Image MetaHub.exe'),
      fs: failingFs,
    });

    expect(status).toMatchObject({ enabled: false, source: 'migration-failed', dataDir: defaultUserData });
    expect(status.error).toContain('profile copy failed');
    expect(app.paths.userData).toBe(defaultUserData);
  });
});

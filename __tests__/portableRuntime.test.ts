import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  configurePortableAppPaths,
  resolvePortableRuntime,
} from '../utils/portableRuntime.mjs';

describe('portable runtime', () => {
  it('resolves the portable profile from the electron-builder environment on Windows', () => {
    expect(resolvePortableRuntime({
      platform: 'win32',
      env: {
        PORTABLE_EXECUTABLE_DIR: 'D:\\Apps\\ImageMetaHub',
        PORTABLE_EXECUTABLE_FILE: 'D:\\Apps\\ImageMetaHub\\ImageMetaHub-Portable.exe',
      },
    })).toEqual({
      isPortable: true,
      portableExecutableDir: 'D:\\Apps\\ImageMetaHub',
      portableExecutableFile: 'D:\\Apps\\ImageMetaHub\\ImageMetaHub-Portable.exe',
      userDataPath: 'D:\\Apps\\ImageMetaHub\\ImageMetaHubData',
      autoUpdateSupported: false,
    });
  });

  it('normalizes the portable executable directory', () => {
    const runtime = resolvePortableRuntime({
      platform: 'win32',
      env: {
        PORTABLE_EXECUTABLE_DIR: 'D:\\Apps\\Nested\\..\\ImageMetaHub\\',
        PORTABLE_EXECUTABLE_FILE: 'D:\\Apps\\Nested\\..\\ImageMetaHub\\ImageMetaHub.exe',
      },
    });

    expect(runtime.portableExecutableDir).toBe('D:\\Apps\\ImageMetaHub');
    expect(runtime.portableExecutableFile).toBe('D:\\Apps\\ImageMetaHub\\ImageMetaHub.exe');
    expect(runtime.userDataPath).toBe('D:\\Apps\\ImageMetaHub\\ImageMetaHubData');
  });

  it('keeps installed and development launches non-portable without the environment marker', () => {
    expect(resolvePortableRuntime({ platform: 'win32', env: {} })).toEqual({
      isPortable: false,
      portableExecutableDir: null,
      portableExecutableFile: null,
      userDataPath: null,
      autoUpdateSupported: true,
    });
  });

  it('ignores the Windows portable marker on other platforms', () => {
    expect(resolvePortableRuntime({
      platform: 'linux',
      env: { PORTABLE_EXECUTABLE_DIR: '/media/usb/ImageMetaHub' },
    }).isPortable).toBe(false);
  });

  it('proves write access before redirecting every persistent Electron path', () => {
    const app = {
      setPath: vi.fn(),
      setAppLogsPath: vi.fn(),
    };
    const fsApi = {
      mkdirSync: vi.fn(),
      openSync: vi.fn(() => 17),
      closeSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const runtime = resolvePortableRuntime({
      platform: 'win32',
      env: { PORTABLE_EXECUTABLE_DIR: 'E:\\ImageMetaHub' },
    });

    configurePortableAppPaths(app, runtime, {
      fsApi,
      createProbeName: () => '.write-test',
    });

    expect(fsApi.openSync).toHaveBeenCalledWith(
      'E:\\ImageMetaHub\\ImageMetaHubData\\.write-test',
      'wx',
    );
    expect(app.setPath.mock.calls).toEqual([
      ['userData', 'E:\\ImageMetaHub\\ImageMetaHubData'],
      ['sessionData', 'E:\\ImageMetaHub\\ImageMetaHubData'],
      ['crashDumps', 'E:\\ImageMetaHub\\ImageMetaHubData\\crash-dumps'],
    ]);
    expect(app.setAppLogsPath).toHaveBeenCalledWith(
      'E:\\ImageMetaHub\\ImageMetaHubData\\logs',
    );
  });

  it('fails without redirecting to AppData when the portable profile is not writable', () => {
    const app = {
      setPath: vi.fn(),
      setAppLogsPath: vi.fn(),
    };
    const fsApi = {
      mkdirSync: vi.fn(),
      openSync: vi.fn(() => {
        throw new Error('access denied');
      }),
      closeSync: vi.fn(),
      unlinkSync: vi.fn(() => {
        throw new Error('missing probe');
      }),
    };
    const runtime = resolvePortableRuntime({
      platform: 'win32',
      env: { PORTABLE_EXECUTABLE_DIR: 'F:\\ReadOnly' },
    });

    expect(() => configurePortableAppPaths(app, runtime, { fsApi })).toThrow(
      'Portable profile directory is not writable: F:\\ReadOnly\\ImageMetaHubData',
    );
    expect(app.setPath).not.toHaveBeenCalled();
    expect(app.setAppLogsPath).not.toHaveBeenCalled();
  });

  it('configures portable paths before the instance lock and skips protocol registration', () => {
    const source = readFileSync(path.join(process.cwd(), 'electron-deeplink.mjs'), 'utf8');

    expect(source.indexOf('configurePortableAppPaths(app, portableRuntime)')).toBeLessThan(
      source.indexOf('app.requestSingleInstanceLock()'),
    );
    expect(source).toContain('if (!portableRuntime.isPortable)');
  });

  it('reports userData as the default cache root', () => {
    const source = readFileSync(path.join(process.cwd(), 'electron.mjs'), 'utf8');
    const handlerStart = source.indexOf("ipcMain.handle('get-default-cache-path'");
    const handlerEnd = source.indexOf("ipcMain.handle('get-user-data-path'", handlerStart);
    const handlerSource = source.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain("path: app.getPath('userData')");
    expect(handlerSource).not.toContain('ImageMetaHubCache');
  });

  it('opens only the configured cache directory resolved by the main process', () => {
    const source = readFileSync(path.join(process.cwd(), 'electron.mjs'), 'utf8');
    const handlerStart = source.indexOf("ipcMain.handle('open-cache-location'");
    const handlerEnd = source.indexOf("ipcMain.handle('list-subfolders'", handlerStart);
    const handlerSource = source.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('await getCacheRootPath()');
    expect(handlerSource).toContain('await fs.stat(normalizedCachePath)');
    expect(handlerSource).toContain('stats.isDirectory()');
    expect(handlerSource).not.toContain('cachePath) =>');
  });

  it('relaunches the portable wrapper instead of the extracted executable', () => {
    const source = readFileSync(path.join(process.cwd(), 'electron.mjs'), 'utf8');
    const handlerStart = source.indexOf("ipcMain.handle('restart-app'");
    const handlerEnd = source.indexOf('// --- End Thumbnail Cache IPC Handlers', handlerStart);
    const handlerSource = source.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain(
      'app.relaunch({ execPath: desktopRuntime.portableExecutableFile })',
    );
    expect(handlerSource.indexOf('app.relaunch')).toBeLessThan(handlerSource.indexOf('app.quit'));
  });
});

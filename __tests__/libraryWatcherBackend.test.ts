import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ watch: vi.fn(), require: vi.fn(), nativeConstructor: vi.fn() }));
vi.mock('chokidar', () => ({ default: { watch: mocks.watch } }));
vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return { ...actual, createRequire: () => mocks.require, default: { ...actual.default, createRequire: () => mocks.require } };
});
import { createLibraryWatcher } from '../services/libraryWatcherBackend.mjs';

const options = { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 } };
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe('library watcher backend resource safety', () => {
  it('uses a tree-wide native watcher on macOS', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    const watcher = { options: { useFsEvents: true, usePolling: false }, add: vi.fn(), close: vi.fn() };
    watcher.add.mockReturnValue(watcher);
    mocks.nativeConstructor.mockImplementation(function () { return watcher; });
    mocks.require.mockReturnValue({ FSWatcher: mocks.nativeConstructor });
    expect(createLibraryWatcher('/synthetic/library', options)).toBe(watcher);
    expect(watcher.add).toHaveBeenCalledWith('/synthetic/library');
    expect(mocks.watch).not.toHaveBeenCalled();
  });
  it('never falls back to per-file native watches when FSEvents cannot load', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    const watcher = { options: { useFsEvents: false, usePolling: false }, add: vi.fn(), close: vi.fn() };
    mocks.nativeConstructor.mockImplementation(function () { return watcher; });
    mocks.require.mockReturnValue({ FSWatcher: mocks.nativeConstructor });
    createLibraryWatcher('/synthetic/library', options);
    expect(watcher.add).not.toHaveBeenCalled();
    expect(watcher.close).toHaveBeenCalled();
    expect(mocks.watch).toHaveBeenCalledWith('/synthetic/library', { ...options, usePolling: true, interval: 1000, binaryInterval: 1000 });
  });
  it('honors explicit polling on macOS without loading the native module', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    createLibraryWatcher('/synthetic/library', { ...options, usePolling: true });
    expect(mocks.require).not.toHaveBeenCalled();
    expect(mocks.watch).toHaveBeenCalledWith('/synthetic/library', { ...options, usePolling: true });
  });
  it('keeps the existing backend on Windows and Linux', () => {
    for (const platform of ['win32', 'linux']) {
      vi.stubGlobal('process', { ...process, platform });
      createLibraryWatcher('/synthetic/library', options);
    }
    expect(mocks.require).not.toHaveBeenCalled();
    expect(mocks.watch).toHaveBeenCalledTimes(2);
  });
});

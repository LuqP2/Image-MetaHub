import chokidar from 'chokidar';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Chokidar 5 retains a kqueue descriptor per file on macOS. Large libraries
// can exhaust the descriptors needed to launch Electron's next renderer.
// The macOS-only alias retains Chokidar 3's tree-wide native FSEvents backend.
export function createLibraryWatcher(directoryPath, options) {
  if (process.platform === 'darwin' && !options.usePolling) {
    try {
      const macChokidar = require('chokidar-macos');
      const watcher = new macChokidar.FSWatcher({
        ...options,
        disableGlobbing: true,
        useFsEvents: true,
        usePolling: false,
      });
      if (watcher.options.useFsEvents && !watcher.options.usePolling) {
        return watcher.add(directoryPath);
      }
      void watcher.close();
    } catch (error) {
      console.warn('[FileWatcher] Native macOS backend unavailable; using polling:', error?.code || error?.name);
    }
    // Never silently return to per-file native watches if the optional native
    // module is unavailable in an installation. Polling keeps renderers usable.
    return chokidar.watch(directoryPath, {
      ...options, usePolling: true, interval: 1000, binaryInterval: 1000,
    });
  }
  return chokidar.watch(directoryPath, options);
}

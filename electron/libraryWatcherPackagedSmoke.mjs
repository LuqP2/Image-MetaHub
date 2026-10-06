import fs from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';
import { startWatching, stopWatching } from '../services/fileWatcher.mjs';

export async function prepareLargeLibraryWatcherSmoke(directoryPath, baseline = false) {
  const descriptorCount = async () => (await fs.readdir('/dev/fd')).filter(name => /^\d+$/.test(name)).length;
  const before = await descriptorCount();
  let watcher;
  const messages = [];
  const directoryId = 'packaged-large-library-smoke';
  const receiver = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: (channel, payload) => messages.push({ channel, payload }) },
  };
  const cleanup = async () => {
    if (watcher) await watcher.close();
    else stopWatching(directoryId);
  };
  try {
    const backend = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Large library watcher did not become ready.')), 60000);
      const ready = (details) => { clearTimeout(timer); resolve(details); };
      if (baseline) {
        watcher = chokidar.watch(directoryPath, { ignoreInitial: true, depth: 99 });
        let reportedLimit = false;
        watcher.once('ready', () => {
          // Leave headroom for reading the settings and measuring descriptors,
          // while retaining the large per-file watch set that breaks spawn.
          watcher.unwatch(Array.from(watcher._closers.keys()).slice(-64));
          ready({ useFsEvents: false });
        });
        watcher.on('error', error => {
          if (error.code === 'EMFILE') {
            if (!reportedLimit) console.log('[packaged-detached-viewer-smoke] baseline-watcher-limit EMFILE');
            reportedLimit = true;
            return;
          }
          clearTimeout(timer);
          reject(error);
        });
      } else {
        const result = startWatching(directoryId, directoryPath, receiver, { onReady: ready });
        if (!result.success) { clearTimeout(timer); reject(new Error(result.error)); }
      }
    });
    const after = await descriptorCount();
    console.log(`[packaged-detached-viewer-smoke] library descriptors before=${before} after=${after} fsevents=${backend.useFsEvents}`);
    if (baseline) {
      if (after - before < 9000) throw new Error('Baseline did not establish descriptor pressure.');
      return cleanup;
    }
    if (!backend.useFsEvents || after - before > 128) {
      throw new Error('Packaged large library did not use bounded native FSEvents monitoring.');
    }
    const waitForMessage = async (channel, matches) => {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const index = messages.findIndex(message => message.channel === channel && matches(message.payload));
        if (index >= 0) { messages.splice(index, 1); return; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Large library watcher missed ${channel}.`);
    };
    const probe = path.join(directoryPath, 'event-probe.png');
    await fs.writeFile(probe, 'synthetic');
    await waitForMessage('new-images-detected', payload => payload.files.some(file => file.path === probe));
    await fs.appendFile(probe, '-changed');
    await waitForMessage('new-images-detected', payload => payload.files.some(file => file.path === probe && file.forceReindex));
    const sidecar = probe + '.imagemetahub.json';
    await fs.writeFile(sidecar, '{}');
    await waitForMessage('new-images-detected', payload => payload.files.some(file => file.path === probe && file.provenanceBytesChanged === false));
    await fs.unlink(sidecar);
    await waitForMessage('new-images-detected', payload => payload.files.some(file => file.path === probe && file.provenanceBytesChanged === false));
    await fs.unlink(probe);
    await waitForMessage('watched-files-removed', payload => payload.files.some(file => file.path === probe));
    console.log('[packaged-detached-viewer-smoke] large-library-events passed');
    console.log('[packaged-detached-viewer-smoke] large-library-watcher-ready');
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

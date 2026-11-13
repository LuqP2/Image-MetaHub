import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createWindowsLibraryWatcher } from '../services/windowsLibraryWatcher.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(predicate) {
  const deadline = Date.now() + 4000;
  while (!predicate() && Date.now() < deadline) await delay(20);
  expect(predicate()).toBe(true);
}

it('enumerates without file stats and reconciles notifications received during enumeration', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imh-watcher-'));
  const existing = path.join(root, 'existing.png');
  const created = path.join(root, 'created.png');
  const handle = new EventEmitter();
  handle.close = vi.fn();
  let notify;
  const stat = vi.fn(fs.promises.stat);
  const lstat = vi.fn(fs.promises.lstat);
  const read = vi.fn(async (...args) => {
    const result = await fs.promises.readdir(...args);
    if (read.mock.calls.length === 1) {
      expect(stat).not.toHaveBeenCalled();
      expect(lstat).not.toHaveBeenCalled();
      await fs.promises.writeFile(created, 'synthetic');
      notify('rename', 'created.png');
    }
    return result;
  });
  let watcher;
  try {
    await fs.promises.writeFile(existing, 'synthetic');
    watcher = createWindowsLibraryWatcher(root, {
      awaitWriteFinish: { pollInterval: 10, stabilityThreshold: 30 },
    }, {
      watch: (_root, options, callback) => {
        expect(options.recursive).toBe(true);
        notify = callback;
        return handle;
      },
      promises: { ...fs.promises, stat, lstat, readdir: read },
    });
    const observed = [];
    watcher.on('change', file => observed.push(file));
    watcher.on('add', file => observed.push(file));
    await once(watcher, 'ready');
    await until(() => observed.includes(created));
    expect(observed).toEqual([created]);
    expect(lstat.mock.calls.map(([file]) => file)).toEqual([created]);
    expect(stat.mock.calls.every(([file]) => file === created)).toBe(true);
    notify('change', 'existing.png');
    watcher.close();
    await delay(100);
    expect(observed).toEqual([created]);
    expect(handle.close).toHaveBeenCalledOnce();
  } finally {
    watcher?.close();
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

it.runIf(process.platform === 'win32').each(['EACCES', 'EPERM'])(
  'keeps the root watcher active when a junction subscription fails with %s', async code => {
    const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imh-watcher-'));
    const root = path.join(temp, 'root');
    const target = path.join(temp, 'target');
    const handle = new EventEmitter();
    handle.close = vi.fn();
    let notify;
    let watcher;
    try {
      await fs.promises.mkdir(root);
      await fs.promises.mkdir(target);
      await fs.promises.symlink(target, path.join(root, 'linked'), 'junction');
      const watch = vi.fn((folder, _options, callback) => {
        if (folder !== root) throw Object.assign(new Error('Access denied'), { code });
        notify = callback;
        return handle;
      });
      watcher = createWindowsLibraryWatcher(root, {
        ignorePermissionErrors: true,
        awaitWriteFinish: { pollInterval: 10, stabilityThreshold: 30 },
      }, { watch, promises: fs.promises });
      await once(watcher, 'ready');
      expect(watch).toHaveBeenCalledTimes(2);
      const added = once(watcher, 'add');
      const file = path.join(root, 'accessible.png');
      await fs.promises.writeFile(file, 'synthetic');
      notify('rename', 'accessible.png');
      expect(await added).toEqual([file]);
      expect(handle.close).not.toHaveBeenCalled();
    } finally {
      watcher?.close();
      await fs.promises.rm(temp, { recursive: true, force: true });
    }
  },
);

it.runIf(process.platform === 'win32')('observes real nested filesystem changes and waits for stable writes', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imh-watcher-'));
  const sub = path.join(root, 'nested');
  const moved = path.join(root, 'moved');
  const image = path.join(sub, 'image.png');
  const sidecar = image + '.imagemetahub.json';
  const observed = [];
  let watcher;
  try {
    await fs.promises.mkdir(sub);
    watcher = createWindowsLibraryWatcher(root, {
      awaitWriteFinish: { stabilityThreshold: 180, pollInterval: 20 },
    });
    for (const event of ['add', 'change', 'unlink', 'unlinkDir']) {
      watcher.on(event, target => observed.push([event, target]));
    }
    const saw = (event, target) => observed.some(([e, p]) => e === event && p === target);
    await once(watcher, 'ready');
    await fs.promises.writeFile(image, 'first part');
    await delay(100);
    expect(saw('add', image)).toBe(false);
    await fs.promises.appendFile(image, ' second part');
    await until(() => saw('add', image));
    await fs.promises.appendFile(image, ' changed');
    await until(() => saw('change', image));
    await fs.promises.writeFile(sidecar, '{}');
    await until(() => saw('add', sidecar));
    await fs.promises.unlink(sidecar);
    await until(() => saw('unlink', sidecar));
    await fs.promises.rename(sub, moved);
    await until(() => saw('unlinkDir', sub) && saw('add', path.join(moved, 'image.png')));
    await fs.promises.unlink(path.join(moved, 'image.png'));
    await until(() => saw('unlink', path.join(moved, 'image.png')));
  } finally {
    watcher?.close();
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

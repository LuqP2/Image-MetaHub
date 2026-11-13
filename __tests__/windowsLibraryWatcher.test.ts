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

it.each(['lstat', 'stat', 'readdir'])('preserves indexed paths when %s denies access', async operation => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imh-watcher-'));
  const folder = path.join(root, 'nested');
  const file = path.join(folder, 'existing.png');
  const handle = new EventEmitter();
  handle.close = vi.fn();
  let notify;
  let blocked = true;
  let watcher;
  try {
    await fs.promises.mkdir(folder);
    await fs.promises.writeFile(file, 'synthetic');
    const actual = fs.promises[operation];
    const read = vi.fn(async (target, ...args) => {
      if (blocked && target === (operation === 'readdir' ? folder : file)) {
        throw Object.assign(new Error('Access denied'), { code: 'EACCES' });
      }
      return actual(target, ...args);
    });
    blocked = false;
    watcher = createWindowsLibraryWatcher(root, {
      ignorePermissionErrors: true,
      awaitWriteFinish: { pollInterval: 10, stabilityThreshold: 30 },
    }, {
      watch: (_root, _options, callback) => { notify = callback; return handle; },
      promises: { ...fs.promises, [operation]: read },
    });
    const removed = vi.fn();
    watcher.on('unlink', removed);
    watcher.on('unlinkDir', removed);
    await once(watcher, 'ready');
    read.mockClear();
    blocked = true;
    notify('change', operation === 'readdir' ? null : path.relative(root, file));
    await until(() => read.mock.calls.some(([target]) => target === (operation === 'readdir' ? folder : file)));
    await delay(100);
    expect(removed).not.toHaveBeenCalled();
    blocked = false;
    await fs.promises.unlink(file);
    notify('rename', path.relative(root, file));
    await until(() => removed.mock.calls.length > 0);
    expect(removed.mock.calls).toEqual([[file]]);
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

it.runIf(process.platform === 'win32').each([false, true])(
  'reconciles a linked target reporting EPERM only when missing (deleted: %s)', async deleted => {
    const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imh-watcher-'));
    const root = path.join(temp, 'library');
    const target = path.join(temp, 'external');
    const junction = path.join(root, 'linked');
    const rootHandle = Object.assign(new EventEmitter(), { close: vi.fn() });
    const linkHandle = Object.assign(new EventEmitter(), { close: vi.fn() });
    let watcher;
    let denied = false;
    try {
      await fs.promises.mkdir(root);
      await fs.promises.mkdir(target);
      await fs.promises.writeFile(path.join(target, 'existing.png'), 'synthetic');
      await fs.promises.symlink(target, junction, 'junction');
      const stat = vi.fn(async (file, ...args) => {
        if (denied && file === junction) throw Object.assign(new Error('Access denied'), { code: 'EACCES' });
        return fs.promises.stat(file, ...args);
      });
      watcher = createWindowsLibraryWatcher(root, { ignorePermissionErrors: true }, {
        watch: folder => folder === root ? rootHandle : linkHandle,
        promises: { ...fs.promises, stat },
      });
      const removed = vi.fn();
      watcher.on('unlinkDir', removed);
      watcher.on('unlink', removed);
      await once(watcher, 'ready');
      stat.mockClear();
      if (deleted) {
        await fs.promises.unlink(path.join(target, 'existing.png'));
        await fs.promises.rmdir(target);
      } else {
        denied = true;
      }
      linkHandle.emit('error', Object.assign(new Error('Watch ended'), { code: 'EPERM' }));
      await until(() => stat.mock.calls.some(([file]) => file === junction));
      if (deleted) {
        await until(() => removed.mock.calls.length === 2);
        expect(removed.mock.calls).toEqual([[junction], [path.join(junction, 'existing.png')]]);
      } else {
        await delay(100);
        expect(removed).not.toHaveBeenCalled();
      }
      expect(rootHandle.close).not.toHaveBeenCalled();
    } finally {
      watcher?.close();
      await fs.promises.rm(temp, { recursive: true, force: true });
    }
  },
);

it.each([false, true])('confirms root absence before emitting unlinkDir (deleted: %s)', async deleted => {
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imh-watcher-'));
  const root = path.join(temp, 'library');
  const handle = Object.assign(new EventEmitter(), { close: vi.fn() });
  let watcher;
  try {
    await fs.promises.mkdir(root);
    watcher = createWindowsLibraryWatcher(root, { ignorePermissionErrors: true }, {
      watch: () => handle,
      promises: {
        ...fs.promises,
        stat: target => deleted ? fs.promises.stat(target) :
          Promise.reject(Object.assign(new Error('Access denied'), { code: 'EPERM' })),
      },
    });
    const removed = vi.fn();
    watcher.on('unlinkDir', removed);
    await once(watcher, 'ready');
    if (deleted) await fs.promises.rmdir(root);
    const failed = once(watcher, 'error');
    handle.emit('error', Object.assign(new Error('Watch ended'), { code: 'EPERM' }));
    await failed;
    expect(removed.mock.calls).toEqual(deleted ? [[root]] : []);
    expect(handle.close).toHaveBeenCalledOnce();
  } finally {
    watcher?.close();
    await fs.promises.rm(temp, { recursive: true, force: true });
  }
});

it('reports retained files as changed after replacing a directory at the same path', async () => {
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imh-watcher-'));
  const root = path.join(temp, 'library');
  const album = path.join(root, 'album');
  const replacement = path.join(temp, 'replacement');
  let watcher;
  let notify;
  try {
    await fs.promises.mkdir(album, { recursive: true });
    await fs.promises.mkdir(replacement);
    await fs.promises.writeFile(path.join(album, 'same.png'), 'old');
    await fs.promises.writeFile(path.join(replacement, 'same.png'), 'new');
    watcher = createWindowsLibraryWatcher(root, {
      awaitWriteFinish: { pollInterval: 10, stabilityThreshold: 30 },
    }, {
      watch: (_folder, _options, callback) => {
        notify = callback;
        return Object.assign(new EventEmitter(), { close: vi.fn() });
      },
      promises: fs.promises,
    });
    const changed = vi.fn();
    watcher.on('change', changed);
    await once(watcher, 'ready');
    await fs.promises.rename(album, path.join(temp, 'old'));
    await fs.promises.rename(replacement, album);
    notify('rename', 'album');
    notify('rename', 'album');
    await until(() => changed.mock.calls.length > 0);
    expect(changed.mock.calls).toEqual([[path.join(album, 'same.png')]]);
  } finally {
    watcher?.close();
    await fs.promises.rm(temp, { recursive: true, force: true });
  }
});

it.runIf(process.platform === 'win32')('reports retained files as changed when a junction is retargeted', async () => {
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imh-watcher-'));
  const root = path.join(temp, 'library');
  const junction = path.join(root, 'linked');
  const first = path.join(temp, 'first');
  const second = path.join(temp, 'second');
  let watcher;
  let notify;
  try {
    for (const folder of [root, first, second]) await fs.promises.mkdir(folder);
    await fs.promises.writeFile(path.join(first, 'same.png'), 'first');
    await fs.promises.writeFile(path.join(second, 'same.png'), 'second');
    await fs.promises.symlink(first, junction, 'junction');
    const watch = vi.fn((folder, _options, callback) => {
      if (folder === root) notify = callback;
      return Object.assign(new EventEmitter(), { close: vi.fn() });
    });
    watcher = createWindowsLibraryWatcher(root, {
      awaitWriteFinish: { pollInterval: 10, stabilityThreshold: 30 },
    }, { watch, promises: fs.promises });
    const changed = vi.fn();
    const added = vi.fn();
    watcher.on('change', changed);
    watcher.on('add', added);
    await once(watcher, 'ready');
    await fs.promises.unlink(junction);
    await fs.promises.symlink(second, junction, 'junction');
    notify('rename', 'linked');
    await until(() => changed.mock.calls.length > 0);
    expect(changed.mock.calls).toEqual([[path.join(junction, 'same.png')]]);
    expect(added).not.toHaveBeenCalled();
    expect(watch.mock.calls.map(([folder]) => folder)).toEqual([root, first, second]);
  } finally {
    watcher?.close();
    await fs.promises.rm(temp, { recursive: true, force: true });
  }
});

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

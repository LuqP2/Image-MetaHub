import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { setImmediate as yieldToLoop } from 'node:timers/promises';

const reads = [];
let activeReads = 0;

function pumpReads() {
  while (activeReads < 2 && reads.length) {
    activeReads++;
    const { run, resolve, reject } = reads.shift();
    Promise.resolve().then(run).then(resolve, reject).finally(() => {
      activeReads--;
      pumpReads();
    });
  }
}

function queueRead(run) {
  return new Promise((resolve, reject) => {
    reads.push({ run, resolve, reject });
    pumpReads();
  });
}

const missing = error => ['ENOENT', 'ENOTDIR'].includes(error.code);
const denied = error => ['EACCES', 'EPERM'].includes(error.code);
const inaccessible = Symbol('inaccessible');

export function createWindowsLibraryWatcher(directoryPath, options, io = fs) {
  const root = path.resolve(directoryPath);
  const events = new EventEmitter();
  events.options = { ...options, useFsEvents: false, usePolling: false, backend: 'windows-recursive' };
  const ignored = new Set((options.ignored ?? []).map(pattern => pattern.split('/')[1]));
  const maxDepth = options.depth ?? Infinity;
  let inventory = new Map();
  const notifications = new Map();
  const writes = new Map();
  const links = new Map();
  let closed = false;
  let busy = true;
  let timer;
  let writeTimer;
  let checkingWrites = false;

  const keyFor = target => target.toLowerCase();
  const keyInside = (key, parent) => key === parent ||
    key.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
  const inScope = target => {
    const relative = path.relative(root, target);
    if (!relative) return true;
    const parts = relative.split(path.sep);
    return !path.isAbsolute(relative) && parts[0] !== '..' &&
      parts.length <= maxDepth + 1 && !parts.some(part => ignored.has(part.toLowerCase()));
  };

  function fail(error) {
    if (closed) return;
    events.close();
    events.emit('error', error);
  }

  function notify(base, filename, event = 'rename') {
    if (closed) return;
    const target = filename ? path.resolve(base, filename) : base;
    if (!inScope(target)) return;
    const previous = notifications.get(target);
    notifications.set(target, !filename || previous === 'unknown' ? 'unknown' :
      previous === 'rename' ? 'rename' : event);
    schedule();
  }

  function subscribe(target, logicalPath) {
    const handle = io.watch(target, { recursive: true, persistent: options.persistent !== false },
      (event, name) => notify(logicalPath, name, event));
    handle.on('error', error => {
      if (logicalPath !== root && options.ignorePermissionErrors && denied(error)) {
        links.delete(keyFor(logicalPath));
        handle.close();
        // Windows also reports EPERM when a junction's watched target disappears.
        if (error.code === 'EPERM') {
          void probe(logicalPath).then(kind => {
            if (kind === null) notify(path.dirname(logicalPath), path.basename(logicalPath));
          }).catch(fail);
        }
        return;
      }
      // Windows reports EPERM when the watched directory itself disappears.
      if (error.code === 'EPERM' || missing(error)) {
        if (logicalPath !== root) {
          links.delete(keyFor(logicalPath));
          handle.close();
          notify(path.dirname(logicalPath), path.basename(logicalPath));
          return;
        }
        if (!closed) events.emit('unlinkDir', root);
        fail(new Error('The watched library folder is no longer available.', { cause: error }));
        return;
      }
      fail(error);
    });
    return handle;
  }

  const native = subscribe(root, root);

  function close() {
    if (closed) return;
    closed = true;
    native.close();
    for (const { handle } of links.values()) handle.close();
    links.clear();
    clearTimeout(timer);
    clearTimeout(writeTimer);
    notifications.clear();
    writes.clear();
    inventory.clear();
  }
  const watcher = Object.assign(events, { close });

  async function probe(target, follow = true) {
    try {
      return await (follow ? io.promises.stat(target) : io.promises.lstat(target));
    } catch (error) {
      if (missing(error)) return null;
      if (options.ignorePermissionErrors && denied(error)) return inaccessible;
      throw error;
    }
  }

  async function scan(start, initialEntry) {
    const entries = new Map([[keyFor(start), initialEntry]]);
    const stack = [{ ...initialEntry, actual: start, ancestors: new Set() }];
    while (stack.length && !closed) {
      const { target, ancestors, actual: expectedPath } = stack.pop();
      const entry = entries.get(keyFor(target));
      let actual = expectedPath;
      if (entry.link || (target === start && start !== root)) {
        actual = await io.promises.realpath(target).catch(error => {
          if (missing(error)) return null;
          if (options.ignorePermissionErrors && denied(error)) return inaccessible;
          throw error;
        });
      }
      if (closed || !actual) continue;
      if (actual === inaccessible) {
        await preserveSubtree(entries, target);
        continue;
      }
      if (ancestors.has(keyFor(actual))) continue;
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(keyFor(actual));
      if (entry.link && keyFor(target) !== keyFor(root)) {
        const key = keyFor(target);
        const old = links.get(key);
        if (old?.actual !== actual) {
          old?.handle.close();
          links.delete(key);
          try {
            links.set(key, { actual, handle: subscribe(actual, target) });
          } catch (error) {
            if (options.ignorePermissionErrors && denied(error)) {
              await preserveSubtree(entries, target);
              continue;
            }
            throw error;
          }
        }
      }
      const result = await queueRead(async () => {
        if (closed) return [];
        try {
          return await io.promises.readdir(target, { withFileTypes: true });
        } catch (error) {
          if (missing(error)) return [];
          if (options.ignorePermissionErrors && denied(error)) return inaccessible;
          throw error;
        }
      });
      if (result === inaccessible) {
        await preserveSubtree(entries, target);
        continue;
      }
      for (let i = 0; i < result.length && !closed; i++) {
        if (i && i % 256 === 0) await yieldToLoop();
        if (closed) break;
        const item = result[i];
        const child = path.join(target, item.name);
        if (!inScope(child)) continue;
        const link = item.isSymbolicLink();
        const kind = link ? await probe(child) : item;
        if (kind === inaccessible) {
          await preserveSubtree(entries, child);
          continue;
        }
        if (closed || !kind || (!kind.isFile() && !kind.isDirectory())) continue;
        const data = { target: child, directory: kind.isDirectory(), link, actual: path.join(actual, item.name) };
        entries.set(keyFor(child), data);
        if (data.directory && path.relative(root, child).split(path.sep).length <= maxDepth) {
          stack.push({ ...data, ancestors: nextAncestors, actual: path.join(actual, item.name) });
        }
      }
    }
    return entries;
  }

  async function preserveSubtree(entries, target) {
    const parent = keyFor(target);
    let processed = 0;
    for (const [key, entry] of inventory) {
      if (++processed % 256 === 0) await yieldToLoop();
      if (closed) return;
      if (keyInside(key, parent)) entries.set(key, entry);
    }
  }

  function stable(target, event) {
    if (options.isRelevantFile && !options.isRelevantFile(target)) return;
    const key = keyFor(target);
    const previous = writes.get(key);
    writes.set(key, { target, event: previous?.event === 'add' ? 'add' : event, since: Date.now() });
    scheduleWriteCheck();
  }

  function scheduleWriteCheck() {
    if (closed || checkingWrites || writeTimer || !writes.size) return;
    writeTimer = setTimeout(() => {
      writeTimer = undefined;
      void checkWrites().catch(fail);
    }, options.awaitWriteFinish?.pollInterval ?? 100);
  }

  async function checkWrites() {
    checkingWrites = true;
    try {
      for (const [key, pending] of Array.from(writes)) {
        if (closed) return;
        const stats = await probe(pending.target);
        if (closed || writes.get(key) !== pending) continue;
        if (stats === inaccessible) {
          writes.delete(key);
          continue;
        }
        if (!stats?.isFile()) {
          writes.delete(key);
          notify(path.dirname(pending.target), path.basename(pending.target));
          continue;
        }
        const signature = [stats.size, stats.mtimeMs, stats.ctimeMs].join(':');
        const now = Date.now();
        if (pending.signature !== signature) {
          pending.signature = signature;
          pending.since = now;
        }
        if (now - pending.since >= (options.awaitWriteFinish?.stabilityThreshold ?? 2000)) {
          writes.delete(key);
          events.emit(pending.event, pending.target);
        }
      }
    } finally {
      checkingWrites = false;
      scheduleWriteCheck();
    }
  }

  function remove(key, old) {
    writes.delete(key);
    links.get(key)?.handle.close();
    links.delete(key);
    events.emit(old.directory ? 'unlinkDir' : 'unlink', old.target);
  }

  async function reconcile(target, duringStartup, event) {
    const key = keyFor(target);
    const old = inventory.get(key);
    const info = await probe(target, false);
    if (closed || info === inaccessible) return;
    const kind = info?.isSymbolicLink() ? await probe(target) : info;
    if (closed || kind === inaccessible) return;
    if (kind?.isFile() && !old?.directory) {
      inventory.set(key, { target, directory: false, link: info.isSymbolicLink(), actual: old?.actual });
      if (old && old.target !== target) remove(key, old);
      // A path seen by the initial enumeration may have been created after subscribe.
      stable(target, (old && old.target === target) || duringStartup ? 'change' : 'add');
      return;
    }
    if (!kind && !old?.directory && key !== keyFor(root)) {
      inventory.delete(key);
      if (old) remove(key, old);
      else if (duringStartup) {
        events.emit('unlink', target);
        events.emit('unlinkDir', target);
      }
      return;
    }
    const next = kind?.isDirectory()
      ? await scan(target, { target, directory: true, link: info.isSymbolicLink() })
      : new Map();
    if (kind?.isFile()) next.set(key, { target, directory: false, link: info.isSymbolicLink() });
    if (closed) return;
    let processed = 0;
    for (const [childKey, child] of inventory) {
      if (++processed % 256 === 0) await yieldToLoop();
      if (closed) return;
      if (!keyInside(childKey, key)) continue;
      const replacement = next.get(childKey);
      if (!replacement || replacement.directory !== child.directory || replacement.target !== child.target) {
        inventory.delete(childKey);
        remove(childKey, child);
      }
    }
    for (const [childKey, child] of next) {
      if (++processed % 256 === 0) await yieldToLoop();
      if (closed) return;
      if (!child.directory) {
        const previous = inventory.get(childKey);
        if (!previous) {
          stable(child.target, 'add');
        } else if (event === 'unknown' ||
            (previous.actual && child.actual && keyFor(previous.actual) !== keyFor(child.actual)) ||
            (duringStartup && event === 'rename' && target !== root)) {
          // A retained logical path may now resolve under a different junction target.
          stable(child.target, 'change');
        }
      }
      inventory.set(childKey, child);
    }
  }

  async function drain(duringStartup) {
    const batch = Array.from(notifications);
    notifications.clear();
    for (const [target, event] of batch) {
      if (closed) return;
      await reconcile(target, duringStartup, event);
    }
  }

  function schedule() {
    if (busy || closed || timer || !notifications.size) return;
    timer = setTimeout(async () => {
      timer = undefined;
      busy = true;
      try {
        await drain(false);
      } catch (error) {
        fail(error);
      } finally {
        busy = false;
        schedule();
      }
    }, 50);
  }

  void (async () => {
    inventory = await scan(root, { target: root, directory: true });
    await drain(true);
    if (closed) return;
    busy = false;
    events.emit('ready');
    schedule();
  })().catch(fail);

  return watcher;
}

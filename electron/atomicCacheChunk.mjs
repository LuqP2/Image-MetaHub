import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** Per-destination queue. A failed write must not poison later requests. */
export function createAtomicCacheChunkWriter(io = fs) {
  const pending = new Map();
  return async (destination, data) => {
    const previous = pending.get(destination) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        const json = JSON.stringify(data);
        await io.writeFile(temporary, json, { flag: 'wx' });
        await io.rename(temporary, destination);
        return json.length;
      } finally {
        await io.unlink(temporary).catch(() => {});
      }
    });
    pending.set(destination, operation);
    try {
      return await operation;
    } finally {
      if (pending.get(destination) === operation) pending.delete(destination);
    }
  };
}

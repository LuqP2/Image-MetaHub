import { boardService } from './boardService';
import type { BoardDocument, BoardSummary } from './types';
const cache = new Map<string, BoardDocument>();
let active = 0;
const queue: Array<() => void> = [];
function next() { while (active < 2 && queue.length) queue.shift()!(); }
/** Read saved documents only, with bounded concurrency and a small session cache. */
export function loadBoardPreview(summary: BoardSummary, visible: () => boolean): Promise<BoardDocument | null> {
  const key = `${summary.id}:${summary.revision}:${summary.updatedAt}`;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    queue.push(() => {
      if (!visible()) { resolve(null); return; }
      active++;
      void boardService.load(summary.id).then(document => {
        if (document.revision === summary.revision && document.updatedAt === summary.updatedAt) {
          cache.set(key, document);
          if (cache.size > 32) cache.delete(cache.keys().next().value!);
        }
        resolve(document);
      }, reject).finally(() => { active--; next(); });
    });
    next();
  });
}

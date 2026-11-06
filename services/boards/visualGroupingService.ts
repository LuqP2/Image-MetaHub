import type { IndexedImage } from '../../types';
import { useSettingsStore } from '../../store/useSettingsStore';
import { canReuseImageEmbedding, ensureImageEmbedded, getIndex, openLibrary } from '../embeddings/semanticSearchEngine';
import { ROW_FLAG_TOMBSTONE, SEGMENT_ROWS, rowStrideBytes } from '../embeddings/embeddingFormat';
import type { VisualVector, VisualGroupingResult } from './visualGrouping';

const check = (signal: AbortSignal) => {
  signal.throwIfAborted();
  if (!useSettingsStore.getState().semanticSearchEnabled) throw new Error('Enable Local Visual Search to group images.');
};
export async function prepareVisualGrouping(images: IndexedImage[], options: { signal: AbortSignal; limit: number; progress(done: number, total: number): void }): Promise<{ vectors: VisualVector[]; failures: Array<{ imageId: string; error: string }> }> {
  check(options.signal);
  const index = await openLibrary();
  const failures: Array<{ imageId: string; error: string }> = [];
  const unique = [...new Map(images.map(image => [image.id, image])).values()];
  const ready = new Set<string>();
  for (let i = 0; i < unique.length; i++) {
    check(options.signal);
    if (getIndex() !== index) throw new Error('The visual model changed. Recalculate the groups.');
    const image = unique[i];
    try {
      if (!canReuseImageEmbedding(index, image)) {
        if (index.stats.liveRows >= options.limit && !index.hasVector(image.id)) throw new Error('Visual Search index limit reached.');
        if (!await ensureImageEmbedded(image, false, options.signal)) throw new Error('This image could not be prepared.');
      }
      check(options.signal);
      ready.add(image.id);
    } catch (error) {
      check(options.signal);
      failures.push({ imageId: image.id, error: error instanceof Error ? error.message : String(error) });
    }
    options.progress(i + 1, unique.length);
  }
  if (getIndex() !== index) throw new Error('The visual model changed. Recalculate the groups.');
  const rows = index.rowSnapshot(), dim = index.dim, stride = rowStrideBytes(dim);
  const vectors: VisualVector[] = [];
  for (const descriptor of index.segmentDescriptors()) {
    check(options.signal);
    const wanted = Array.from({ length: descriptor.rowCount }, (_, local) => ({ local, row: rows[descriptor.index * SEGMENT_ROWS + local] }))
      .filter(({ row }) => row && !(row[2] & ROW_FLAG_TOMBSTONE) && ready.has(row[0]));
    if (!wanted.length) continue;
    const buffer = await index.readSegment(descriptor.index);
    if (!buffer || buffer.byteLength < descriptor.rowCount * stride) throw new Error('The visual index could not be read. Retry after indexing finishes.');
    const view = new DataView(buffer);
    for (const { local, row } of wanted) {
      const offset = local * stride, scale = view.getFloat32(offset, true);
      const codes = new Int8Array(buffer, offset + 4, dim);
      vectors.push({ imageId: row[0], vector: Float32Array.from(codes, code => code * scale) });
    }
  }
  check(options.signal);
  if (getIndex() !== index) throw new Error('The visual model changed. Recalculate the groups.');
  return { vectors, failures };
}

export function runVisualGroupingWorker(vectors: VisualVector[], threshold: number, signal: AbortSignal, progress: (done: number, total: number) => void): Promise<VisualGroupingResult> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('../workers/boardVisualGroupingWorker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { cleanup(); reject(new Error(event.message || 'Visual grouping failed.')); };
    worker.onmessage = event => {
      if (event.data.type === 'progress') progress(event.data.done, event.data.total);
      if (event.data.type === 'result') { cleanup(); resolve(event.data.result); }
      if (event.data.type === 'error') { cleanup(); reject(new Error(event.data.error)); }
    };
    const copies = vectors.map(item => ({ imageId: item.imageId, vector: item.vector.slice() }));
    try { worker.postMessage({ vectors: copies, threshold }, copies.map(item => item.vector.buffer)); }
    catch (error) { cleanup(); reject(error); }
  });
}

import type { IndexedImage } from '../../types';
import type { ExrAssetInfo } from './contracts';
import { unwrapExr, subscribeExrChanged } from './client';
import { resolveFileSortDate } from '../../utils/fileTimestamps.js';

let watching = false;
let refreshing = false;
export function watchExrLibrary() {
  if (watching || !window.electronAPI?.exr) return;
  watching = true;
  subscribeExrChanged(() => { void refreshPendingExrMetadata().catch(() => {}); });
}
export async function refreshPendingExrMetadata() {
  if (refreshing || !window.electronAPI?.exr) return;
  refreshing = true;
  try {
    const state = unwrapExr(await window.electronAPI.exr.status());
    if (!state.installed || !state.enabled) return;
    const [{ useImageStore }, { reparseIndexedImage }] = await Promise.all([import('../../store/useImageStore'), import('../fileIndexer')]);
    const snapshot = useImageStore.getState();
    const pending = snapshot.images.filter(image => image.name.toLowerCase().endsWith('.exr') && !(image.metadata as unknown as { exr?: unknown })?.exr && !(image.metadata as unknown as { exrError?: unknown })?.exrError);
    const updates = new Map<string, IndexedImage>();
    for (const image of pending) {
      const status = unwrapExr(await window.electronAPI.exr.status());
      if (!status.enabled) break;
      const dir = snapshot.directories.find(d => d.id === image.directoryId);
      if (!dir) continue;
      const updated = await reparseIndexedImage(image, dir.path).catch(() => null);
      if (updated) updates.set(image.id, updated);
    }
    if (updates.size) {
      const current = useImageStore.getState();
      current.setImages(current.images.map(image => {
        const update = updates.get(image.id);
        return update && image.contentModifiedMs === update.contentModifiedMs ? { ...image, metadata: update.metadata, metadataString: update.metadataString, dimensions: update.dimensions } : image;
      }));
    }
  } finally { refreshing = false; }
}
export async function indexExrEntry(entry: { handle: FileSystemFileHandle; path: string; size?: number; lastModified: number; contentModifiedMs?: number; birthtimeMs?: number }, directoryId: string): Promise<IndexedImage> {
  watchExrLibrary();
  let info: ExrAssetInfo | undefined;
  let error: string | undefined;
  const api = window.electronAPI?.exr;
  const filePath = (entry.handle as FileSystemFileHandle & { _filePath?: string })._filePath;
  if (api && filePath) {
    try {
      const status = unwrapExr(await api.status());
      if (status.installed && status.enabled) {
        const inspected = unwrapExr(await api.inspect(filePath));
        info = { parts: inspected.parts };
      }
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }
  const primary = info?.parts.find(p => !p.deep) ?? info?.parts[0];
  const metadata = info ? { exr: info } : { _exrPending: true, ...(error ? { exrError: error } : {}) };
  return {
    id: `${directoryId}::${entry.path}`, name: entry.handle.name, directoryId, handle: entry.handle,
    metadata: metadata as unknown as IndexedImage['metadata'], metadataString: JSON.stringify(metadata),
    lastModified: resolveFileSortDate(entry.birthtimeMs, entry.contentModifiedMs, entry.lastModified),
    contentModifiedMs: entry.contentModifiedMs ?? entry.lastModified, fileSize: entry.size,
    fileType: 'image/x-exr', dimensions: primary ? `${primary.width}x${primary.height}` : undefined,
    models: [], loras: [], scheduler: '', thumbnailStatus: 'pending', thumbnailError: null,
  };
}

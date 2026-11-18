import type { IndexedImage } from '../../types';
import type { BoardAssetReference } from './types';
import { reparseIndexedImage } from '../fileIndexer';
import { inferMimeTypeFromName, isSupportedMediaFileName } from '../../utils/mediaTypes.js';

export function externalBoardReference(path: string): BoardAssetReference {
  const normalized = path.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return { kind: 'external', locator: { imageId: `canvas-external:${normalized}`, directoryPath: normalized.slice(0, slash) || '/', relativePath: normalized.slice(slash + 1) } };
}
export function externalBoardPath(reference: BoardAssetReference): string {
  return `${reference.locator.directoryPath?.replace(/\/$/, '')}/${reference.locator.relativePath}`;
}
/** Uses the existing parser/media handles, without adding an entry to the library. */
export async function loadExternalBoardAsset(reference: BoardAssetReference): Promise<IndexedImage | null> {
  const path = externalBoardPath(reference);
  const name = reference.locator.relativePath;
  if (!isSupportedMediaFileName(name)) throw new Error('Drag supported media files onto the canvas.');
  const permission = await window.electronAPI?.boardsAuthorizeFile?.(path);
  if (!permission) throw new Error('External files require the updated desktop app.');
  if (permission.success === false) throw new Error(permission.error);
  const stats = await window.electronAPI?.getFileStats(path);
  if (!stats?.success || !stats.stats || stats.stats.isDirectory) throw new Error('File unavailable. Drag files rather than folders.');
  const image = { id: `${reference.locator.imageId}::${name}`, name, directoryId: reference.locator.imageId, directoryName: '', lastModified: stats.stats.mtimeMs, fileSize: stats.stats.size, fileType: inferMimeTypeFromName(name), handle: { kind: 'file', name, _filePath: path } } as unknown as IndexedImage;
  return reparseIndexedImage(image, reference.locator.directoryPath!);
}

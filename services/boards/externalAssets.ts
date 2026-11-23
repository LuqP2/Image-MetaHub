import type { IndexedImage } from '../../types';
import type { BoardAssetReference } from './types';
import { reparseIndexedImage } from '../fileIndexer';
import { inferMimeTypeFromName, isSupportedMediaFileName } from '../../utils/mediaTypes.js';

export type ExternalBoardAssetResolution =
  | { status: 'resolved'; image: IndexedImage }
  | { status: 'approval-required' }
  | { status: 'missing' };

export function externalBoardReference(path: string): BoardAssetReference {
  const normalized = path.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const directoryPath = /^[a-z]:\/$/i.test(normalized.slice(0, slash + 1)) ? normalized.slice(0, slash + 1) : normalized.slice(0, slash) || '/';
  return { kind: 'external', locator: { imageId: `canvas-external:${normalized}`, directoryPath, relativePath: normalized.slice(slash + 1) } };
}
export function externalBoardPath(reference: BoardAssetReference): string {
  return `${reference.locator.directoryPath?.replace(/\/$/, '')}/${reference.locator.relativePath}`;
}

/** Hydrates an external board asset without granting access; uses board-scoped read channels only. */
export async function loadExternalBoardAsset(boardId: string, reference: BoardAssetReference): Promise<ExternalBoardAssetResolution> {
  const path = externalBoardPath(reference);
  const name = reference.locator.relativePath;
  if (!boardId || !isSupportedMediaFileName(name)) return { status: 'missing' };
  const api = window.electronAPI;
  if (!api?.boardsStatFile || !api?.boardsReadFile) return { status: 'missing' };
  const stats = await api.boardsStatFile({ boardId, filePath: path });
  if (stats.success === false) {
    return stats.code === 'BOARD_APPROVAL_REQUIRED' ? { status: 'approval-required' } : { status: 'missing' };
  }
  if (!stats.data || stats.data.isDirectory) return { status: 'missing' };
  const image = {
    id: `${reference.locator.imageId}::${name}`,
    name,
    directoryId: reference.locator.imageId,
    directoryName: '',
    lastModified: stats.data.mtimeMs,
    fileSize: stats.data.size,
    fileType: inferMimeTypeFromName(name),
    handle: { kind: 'file', name, _filePath: path, _boardId: boardId },
  } as unknown as IndexedImage;
  try {
    const parsed = await reparseIndexedImage(image, reference.locator.directoryPath!);
    if (!parsed) return { status: 'missing' };
    // Reparsing reconstructs a plain Electron handle. Renderer thumbnails (AVIF
    // and small videos) also need the File API, loaded lazily from the board-approved path.
    return {
      status: 'resolved',
      image: {
        ...parsed,
        handle: {
          ...parsed.handle,
          name,
          kind: 'file',
          _filePath: path,
          _boardId: boardId,
          getFile: async () => {
            const result = await window.electronAPI!.boardsReadFile!({ boardId, filePath: path });
            if (result.success === false || !result.data) throw new Error((result.success === false && result.error) || 'External file is unavailable.');
            return new File([new Uint8Array(result.data)], name, { type: inferMimeTypeFromName(name), lastModified: parsed.lastModified });
          },
        } as FileSystemFileHandle,
      },
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'BOARD_APPROVAL_REQUIRED') {
      return { status: 'approval-required' };
    }
    return { status: 'missing' };
  }
}

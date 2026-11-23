import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndexedImage } from '../types';
import { loadExternalBoardAsset, externalBoardPath, externalBoardReference } from '../services/boards/externalAssets';
import { reparseIndexedImage } from '../services/fileIndexer';
import { createBoardDocument, normalizeBoardDocument } from '../services/boards/document.mjs';
import { addAssets } from '../services/boards/operations';

vi.mock('../services/fileIndexer', () => ({ reparseIndexedImage: vi.fn() }));
const bytes = new Uint8Array([1, 2, 3]);
const boardsReadFile = vi.fn();
const boardsStatFile = vi.fn();
const genericReadFile = vi.fn();
const genericGetFileStats = vi.fn();
beforeEach(() => {
  boardsReadFile.mockReset().mockResolvedValue({ success: true, data: bytes });
  boardsStatFile.mockReset().mockResolvedValue({ success: true, data: { size: 3, mtimeMs: 1234, isDirectory: false } });
  genericReadFile.mockReset();
  genericGetFileStats.mockReset();
  window.electronAPI = {
    boardsStatFile,
    boardsReadFile,
    readFile: genericReadFile,
    getFileStats: genericGetFileStats,
  } as unknown as Window['electronAPI'];
  vi.mocked(reparseIndexedImage).mockImplementation(async image => ({ ...image, handle: { kind: 'file', name: image.name, _filePath: externalBoardPath(externalBoardReference(`/synthetic/${image.name}`)), _boardId: 'board-1' } } as unknown as IndexedImage));
});
afterEach(() => { delete window.electronAPI; vi.unstubAllGlobals(); });

describe('external Canvas assets', () => {
  it.each([['reference.avif', 'image/avif'], ['clip.mp4', 'video/mp4']])('returns a lazy board-scoped File-compatible handle after reparsing %s without touching generic channels', async (name, type) => {
    const resolved = await loadExternalBoardAsset('board-1', externalBoardReference(`/synthetic/${name}`));
    expect(resolved.status).toBe('resolved');
    if (resolved.status !== 'resolved') throw new Error('Expected resolved');
    expect(boardsReadFile).not.toHaveBeenCalled();
    expect(genericGetFileStats).not.toHaveBeenCalled();
    const file = await resolved.image.handle.getFile();
    expect(boardsReadFile).toHaveBeenCalledWith({ boardId: 'board-1', filePath: `/synthetic/${name}` });
    expect(genericReadFile).not.toHaveBeenCalled();
    expect(file).toBeInstanceOf(File);
    expect({ name: file.name, type: file.type, size: file.size, lastModified: file.lastModified }).toEqual({ name, type, size: 3, lastModified: 1234 });
    const reader = new FileReader();
    const contents = new Promise<ArrayBuffer>(resolve => { reader.onload = () => resolve(reader.result as ArrayBuffer); });
    reader.readAsArrayBuffer(file);
    expect(new Uint8Array(await contents)).toEqual(bytes);
    boardsReadFile.mockResolvedValueOnce({ success: false, code: 'BOARD_FILE_NOT_FOUND', error: 'File removed' });
    await expect(resolved.image.handle.getFile()).rejects.toThrow('File removed');
  });

  it('distinguishes approval-required from missing without auto-authorizing', async () => {
    boardsStatFile.mockResolvedValueOnce({ success: false, code: 'BOARD_APPROVAL_REQUIRED', error: 'Approval required' });
    expect(await loadExternalBoardAsset('board-1', externalBoardReference('/synthetic/unapproved.png'))).toEqual({ status: 'approval-required' });

    boardsStatFile.mockResolvedValueOnce({ success: false, code: 'BOARD_FILE_NOT_FOUND', error: 'Missing' });
    expect(await loadExternalBoardAsset('board-1', externalBoardReference('/synthetic/missing.png'))).toEqual({ status: 'missing' });
  });

  it('retains parser failure as missing without creating an unusable image', async () => {
    vi.mocked(reparseIndexedImage).mockResolvedValueOnce(null);
    expect(await loadExternalBoardAsset('board-1', externalBoardReference('/synthetic/missing.png'))).toEqual({ status: 'missing' });
  });

  it.each([
    ['C:\\picture.png', 'C:/', 'C:/picture.png'],
    ['D:/clip.mp4', 'D:/', 'D:/clip.mp4'],
    ['/picture.png', '/', '/picture.png'],
    ['C:\\pictures\\reference.png', 'C:/pictures', 'C:/pictures/reference.png'],
    ['\\\\server\\share\\reference.png', '//server/share', '//server/share/reference.png'],
  ])('preserves an absolute directory for %s through board persistence', (path, directory, expectedPath) => {
    const reference = externalBoardReference(path);
    expect(reference.locator.directoryPath).toBe(directory);
    const board = addAssets(createBoardDocument(), [{ reference, name: reference.locator.relativePath, mediaType: 'image' }], { x: 0, y: 0 });
    const object = normalizeBoardDocument(JSON.parse(JSON.stringify(board))).objects[0];
    if (object.type !== 'asset') throw new Error('Expected an asset');
    expect(externalBoardPath(object.reference)).toBe(expectedPath);
  });
});

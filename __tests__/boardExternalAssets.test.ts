import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndexedImage } from '../types';
import { loadExternalBoardAsset, externalBoardPath, externalBoardReference } from '../services/boards/externalAssets';
import { reparseIndexedImage } from '../services/fileIndexer';
import { createBoardDocument, normalizeBoardDocument } from '../services/boards/document.mjs';
import { addAssets } from '../services/boards/operations';

vi.mock('../services/fileIndexer', () => ({ reparseIndexedImage: vi.fn() }));
const bytes = new Uint8Array([1, 2, 3]);
const readFile = vi.fn();
beforeEach(() => {
  readFile.mockReset().mockResolvedValue({ success: true, data: bytes });
  window.electronAPI = {
    boardsAuthorizeFile: vi.fn().mockResolvedValue({ success: true, data: '/synthetic/file' }),
    getFileStats: vi.fn().mockResolvedValue({ success: true, stats: { size: 3, mtimeMs: 1234 } }),
    readFile,
  } as unknown as Window['electronAPI'];
  vi.mocked(reparseIndexedImage).mockImplementation(async image => ({ ...image, handle: { kind: 'file', name: image.name, _filePath: externalBoardPath(externalBoardReference(`/synthetic/${image.name}`)) } } as unknown as IndexedImage));
});
afterEach(() => { delete window.electronAPI; vi.unstubAllGlobals(); });

describe('external Canvas assets', () => {
  it.each([['reference.avif', 'image/avif'], ['clip.mp4', 'video/mp4']])('returns a lazy File-compatible handle after reparsing %s', async (name, type) => {
    const image = await loadExternalBoardAsset(externalBoardReference(`/synthetic/${name}`));
    expect(image).not.toBeNull();
    expect(readFile).not.toHaveBeenCalled();
    const file = await image!.handle.getFile();
    expect(readFile).toHaveBeenCalledWith(`/synthetic/${name}`);
    expect(file).toBeInstanceOf(File);
    expect({ name: file.name, type: file.type, size: file.size, lastModified: file.lastModified }).toEqual({ name, type, size: 3, lastModified: 1234 });
    const reader = new FileReader();
    const contents = new Promise<ArrayBuffer>(resolve => { reader.onload = () => resolve(reader.result as ArrayBuffer); });
    reader.readAsArrayBuffer(file);
    expect(new Uint8Array(await contents)).toEqual(bytes);
    readFile.mockResolvedValueOnce({ success: false, error: 'File removed' });
    await expect(image!.handle.getFile()).rejects.toThrow('File removed');
  });
  it('retains parser failure without creating an unusable image', async () => {
    vi.mocked(reparseIndexedImage).mockResolvedValueOnce(null);
    expect(await loadExternalBoardAsset(externalBoardReference('/synthetic/missing.png'))).toBeNull();
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

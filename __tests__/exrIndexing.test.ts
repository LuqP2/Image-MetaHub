import { beforeEach, describe, expect, it, vi } from 'vitest';
import { indexExrEntry } from '../services/exr/indexing';

const read = vi.fn(() => { throw new Error('EXR bytes must not reach the renderer'); });
const api = { status: vi.fn(), inspect: vi.fn(), onChanged: vi.fn(() => () => {}) };
const entry = { handle: { name: 'render.exr', _filePath: 'D:\\renders\\render.exr', getFile: read } as unknown as FileSystemFileHandle, path: 'render.exr', lastModified: 1234, size: 456 };
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { exr: api, readFile: read } });
});
describe('EXR catalog indexing', () => {
  it('catalogs unavailable EXRs without reading bytes, sidecars, or decoding', async () => {
    api.status.mockResolvedValue({ success: true, value: { installed: false, enabled: false } });
    const result = await indexExrEntry(entry, 'renders');
    expect(result).toMatchObject({ id: 'renders::render.exr', fileSize: 456, fileType: 'image/x-exr', models: [], loras: [] });
    expect(result.metadata).toMatchObject({ _exrPending: true });
    expect(read).not.toHaveBeenCalled(); expect(api.inspect).not.toHaveBeenCalled();
  });
  it('uses only native header data and does not persist a folder profile as file metadata', async () => {
    api.status.mockResolvedValue({ success: true, value: { installed: true, enabled: true } });
    api.inspect.mockResolvedValue({ success: true, value: { parts: [{ index: 0, width: 4096, height: 2160, deep: false, channels: [] }], profile: { input: 'ACEScg' } } });
    const result = await indexExrEntry(entry, 'renders');
    expect(result.dimensions).toBe('4096x2160');
    expect(result.metadata).toMatchObject({ exr: { parts: [{ width: 4096 }] } });
    expect(result.metadataString).not.toContain('ACEScg'); expect(read).not.toHaveBeenCalled();
  });
  it('keeps an incomplete render cataloged and records a recoverable error', async () => {
    api.status.mockResolvedValue({ success: true, value: { installed: true, enabled: true } });
    api.inspect.mockResolvedValue({ success: false, error: 'Incomplete EXR header' });
    const result = await indexExrEntry(entry, 'renders');
    expect(result.metadata).toMatchObject({ _exrPending: true, exrError: 'Incomplete EXR header' });
    expect(read).not.toHaveBeenCalled();
  });
});

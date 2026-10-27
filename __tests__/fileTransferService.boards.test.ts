import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transferIndexedImages } from '../services/fileTransferService';
import { boardDirectory, boardImage } from './helpers/boardIntegrationFixtures';
const mocks = vi.hoisted(() => ({ queue: vi.fn(), flush: vi.fn().mockResolvedValue(undefined), state: { annotations: new Map(), directories: [], setError: vi.fn(), setTransferProgress: vi.fn(), addImages: vi.fn(), flushPendingImages: vi.fn(), removeImages: vi.fn(), clearImageSelection: vi.fn(), setSuccess: vi.fn(), refreshAvailableTags: vi.fn() } }));
vi.mock('../services/boards/referenceSync', () => ({ queueBoardReferenceRemaps: mocks.queue, flushReferenceRemaps: mocks.flush }));
vi.mock('../store/useImageStore', () => ({ useImageStore: { getState: () => mocks.state, setState: vi.fn() } }));
vi.mock('../services/userDataPersistenceAdapter', () => ({ prepareUserDataForImages: async () => {}, getUserDataPersistenceStatus: async () => ({ authority: 'sqlite' }), registerStableUserDataImages: vi.fn() }));
vi.mock('../services/fileIndexer', () => ({ processFiles: vi.fn() }));
const originalApi = window.electronAPI;
beforeEach(() => { mocks.queue.mockClear(); mocks.flush.mockResolvedValue(undefined); });
afterEach(() => Object.defineProperty(window, 'electronAPI', { configurable: true, value: originalApi }));
describe('file move Canvas references', () => {
  it.each(['move', 'copy'] as const)('handles partial %s and the watcher path without remapping failed files', async mode => {
    const first = boardImage('a.png'); const second = boardImage('b.png');
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { transferIndexedImages: vi.fn().mockResolvedValue({ success: true, failedCount: 1, transferred: [{ sourceDirectoryPath: 'root', sourceRelativePath: 'a.png', destinationDirectoryPath: 'C:/destination', destinationRelativePath: 'a.png', destinationAbsolutePath: 'C:/destination/a.png', fileName: 'a.png' }] }) } });
    const result = await transferIndexedImages({ images: [first, second], destinationDirectory: { ...boardDirectory, id: 'dest', path: 'C:/destination', autoWatch: true }, mode });
    expect(result).toMatchObject({ success: true, transferredCount: 1, failedCount: 1 });
    if (mode === 'copy') expect(mocks.queue).not.toHaveBeenCalled();
    else expect(mocks.queue).toHaveBeenCalledWith([expect.objectContaining({ oldLocator: expect.objectContaining({ imageId: first.id }), newLocator: expect.objectContaining({ imageId: 'dest::a.png', directoryPath: 'C:/destination' }) })]);
  });
});

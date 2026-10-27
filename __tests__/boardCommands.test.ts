import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addImagesToBoard } from '../services/boards/commands';
import { useBoardStore } from '../store/useBoardStore';
import { useImageStore } from '../store/useImageStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { boardDirectory, boardImage } from './helpers/boardIntegrationFixtures';
const baseline = vi.hoisted(() => vi.fn());
vi.mock('../services/boards/referenceSync', () => ({ getBoardReferenceBaseline: baseline, queueBoardReferenceRemaps: vi.fn(), flushReferenceRemaps: async () => {} }));
vi.mock('../services/boards/boardService', () => ({ boardService: { save: async (document, revision) => ({ ...document, revision: revision + 1 }), flush: async () => {} } }));
beforeEach(() => { baseline.mockReset().mockResolvedValue(['historic']); useBoardStore.setState({ sessions: {}, activeBoardId: null, closing: false }); });
afterEach(async () => useBoardStore.getState().flushAll());
describe('add library references to Canvas', () => {
  it('adds a batch with a current baseline as one undo step and selects the new objects', async () => {
    const images = [boardImage('a.png'), boardImage('b.png')];
    useImageStore.setState({ images, directories: [boardDirectory] });
    const board = createBoardDocument(); useBoardStore.getState().adoptBoard(board);
    const ids = await addImagesToBoard(board.id, images, [boardDirectory], { x: 75, y: -20 });
    const session = useBoardStore.getState().sessions[board.id];
    expect(ids).toHaveLength(2); expect(session.selectedObjectIds).toEqual(ids); expect(session.past).toHaveLength(1);
    expect(session.document.objects[0]).toMatchObject({ x: 75, y: -20, reference: { appliedRemapIds: ['historic'], locator: { imageId: images[0].id } } });
  });
  it('uses live identity after awaiting the baseline and rejects a vanished path reference', async () => {
    const image = boardImage('a.png', { assetId: crypto.randomUUID() });
    useImageStore.setState({ images: [image], directories: [boardDirectory] });
    const board = createBoardDocument(); useBoardStore.getState().adoptBoard(board);
    let release: (ids: string[]) => void;
    baseline.mockImplementationOnce(() => new Promise<string[]>(resolve => { release = resolve; }));
    const pending = addImagesToBoard(board.id, [image], [boardDirectory]);
    const moved = { ...image, id: 'root::moved.png', name: 'moved.png' };
    useImageStore.setState({ images: [moved] }); release!(['historic']);
    await pending;
    expect(useBoardStore.getState().sessions[board.id].document.objects[0]).toMatchObject({ name: 'moved.png', reference: { locator: { imageId: moved.id } } });
    await expect(addImagesToBoard(board.id, [boardImage('vanished.png')], [boardDirectory])).rejects.toThrow('Select it again');
  });
});

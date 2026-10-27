import { describe, expect, it, vi } from 'vitest';
import { createBoardStore } from '../store/useBoardStore';
import { BoardError, applyBoardReferenceRemaps, normalizeBoardDocument } from '../services/boards/document.mjs';
import { addText, updateObjects } from '../services/boards/operations';
import type { BoardDocument, BoardRepository } from '../services/boards/types';
import { boardRemap, boardWithAsset } from './helpers/boardFixtures';

function fixture() {
  const documents = new Map<string, BoardDocument>();
  const repository: BoardRepository = {
    list: async () => [], load: async id => normalizeBoardDocument(documents.get(id)),
    save: vi.fn(async (document, revision) => {
      if ((documents.get(document.id)?.revision ?? 0) !== revision) throw new BoardError('BOARD_REVISION_CONFLICT', 'changed');
      const saved = normalizeBoardDocument({ ...document, revision: revision + 1 }); documents.set(saved.id, saved); return saved;
    }),
    remove: async id => { documents.delete(id); }, remapReferences: async () => {}, flush: async () => {},
  };
  return { documents, repository, store: createBoardStore(repository, 60000) };
}

describe('board sessions and history', () => {
  it('freezes document edits during the final close flush and unlocks on cancellation', async () => {
    const { store } = fixture();
    const id = await store.getState().createBoard();
    store.getState().executeOperation(id, document => addText(document, { x: 0, y: 0 }));
    store.getState().setClosing(true);
    store.getState().executeOperation(id, document => addText(document, { x: 100, y: 0 }));
    store.getState().renameBoard(id, 'ignored');
    expect(store.getState().sessions[id].document.objects).toHaveLength(1);
    await store.getState().flushAll();
    store.getState().setClosing(false);
    store.getState().executeOperation(id, document => addText(document, { x: 100, y: 0 }));
    expect(store.getState().sessions[id].document.objects).toHaveLength(2);
    await store.getState().flushAll();
  });
  it('groups an interaction into one undo step and preserves history across board switches', async () => {
    const { store } = fixture();
    const id = await store.getState().createBoard('one');
    store.getState().executeOperation(id, document => addText(document, { x: 0, y: 0 }));
    const objectId = store.getState().sessions[id].document.objects[0].id;
    store.getState().beginInteraction(id);
    store.getState().updateInteraction(id, document => updateObjects(document, [{ id: objectId, x: 20 }]));
    store.getState().updateInteraction(id, document => updateObjects(document, [{ id: objectId, x: 40 }]));
    store.getState().commitInteraction(id);
    expect(store.getState().sessions[id].past).toHaveLength(2);
    store.getState().undo(id);
    expect(store.getState().sessions[id].document.objects[0].x).toBe(0);
    store.getState().redo(id);
    expect(store.getState().sessions[id].document.objects[0].x).toBe(40);
    const second = await store.getState().createBoard('two');
    await store.getState().openBoard(id);
    expect(store.getState().sessions[id].past).toHaveLength(2);
    expect(store.getState().sessions[second]).toBeDefined();
    await store.getState().flushAll();
  });
  it('does not overwrite newer edits with an older save acknowledgement', async () => {
    const { store, repository } = fixture();
    const id = await store.getState().createBoard();
    const save = repository.save as ReturnType<typeof vi.fn>;
    let release: (document: BoardDocument) => void;
    save.mockImplementationOnce(document => new Promise<BoardDocument>(resolve => { release = () => resolve({ ...document, revision: 2 }); }));
    store.getState().executeOperation(id, document => addText(document, { x: 0, y: 0 }));
    const flush = store.getState().flushBoard(id);
    await Promise.resolve();
    store.getState().executeOperation(id, document => addText(document, { x: 300, y: 0 }));
    const before = store.getState().sessions[id];
    expect(before.document.objects).toHaveLength(2);
    // The second save uses the revision acknowledged by the first write.
    save.mockImplementationOnce(async document => ({ ...document, revision: 3 }));
    release!(before.document);
    await flush;
    expect(store.getState().sessions[id].document.objects).toHaveLength(2);
    expect(store.getState().sessions[id].savedSequence).toBe(store.getState().sessions[id].changeSequence);
    expect(save.mock.calls.at(-1)?.[1]).toBe(2);
  });
  it('keeps errors and content, discards redo on a new operation, and leaves selection out of saves', async () => {
    const { store, repository } = fixture();
    const id = await store.getState().createBoard();
    store.getState().setSelection(id, []);
    expect(store.getState().sessions[id].changeSequence).toBe(0);
    store.getState().executeOperation(id, document => addText(document, { x: 0, y: 0 }));
    store.getState().undo(id);
    store.getState().executeOperation(id, document => addText(document, { x: 100, y: 0 }));
    expect(store.getState().sessions[id].future).toEqual([]);
    (repository.save as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));
    await expect(store.getState().flushBoard(id)).rejects.toThrow('disk full');
    expect(store.getState().sessions[id]).toMatchObject({ saveStatus: 'error', saveError: 'disk full' });
    expect(store.getState().sessions[id].document.objects).toHaveLength(1);
    await store.getState().flushAll();
  });
  it('remaps current content, past, future and an active interaction without adding undo steps', async () => {
    const { store, repository } = fixture();
    const saved = await repository.save(boardWithAsset(), 0);
    store.getState().adoptBoard(saved);
    store.getState().executeOperation(saved.id, document => addText(document, { x: 10, y: 0 }));
    store.getState().undo(saved.id);
    store.getState().beginInteraction(saved.id);
    const before = store.getState().sessions[saved.id];
    store.getState().applyReferenceRemaps([boardRemap('a.png', 'b.png')]);
    const after = store.getState().sessions[saved.id];
    expect(after.past.length).toBe(before.past.length);
    for (const snapshot of [after.document, ...after.past, ...after.future, after.interaction!]) {
      expect(snapshot.objects[0]).toMatchObject({ reference: { locator: { relativePath: 'b.png' } } });
    }
    expect(applyBoardReferenceRemaps(after.document, [boardRemap('a.png', 'b.png')])).toEqual(after.document);
    await store.getState().flushAll();
  });
});

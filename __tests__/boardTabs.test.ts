import { describe, expect, it, vi } from 'vitest';
import { createBoardStore } from '../store/useBoardStore';
import { createBoardDocument, normalizeBoardDocument } from '../services/boards/document.mjs';
import { addText } from '../services/boards/operations';
import type { BoardDocument, BoardRepository } from '../services/boards/types';

function fixture() {
  const documents = new Map<string, BoardDocument>();
  const repository: BoardRepository = { list: async () => [], load: async id => { if (!documents.has(id)) throw new Error('Missing'); return documents.get(id)!; },
    save: vi.fn(async (document, revision) => { const saved = normalizeBoardDocument({ ...document, revision: revision + 1 }); documents.set(saved.id, saved); return saved; }),
    remove: async id => { documents.delete(id); }, remapReferences: async () => {}, flush: async () => {} };
  return { store: createBoardStore(repository, 60000), repository, documents };
}
describe('board tabs', () => {
  it('opens a board once, preserves history and selection, and lists without closing', async () => {
    const { store } = fixture();
    const a = await store.getState().createBoard('A');
    store.getState().executeOperation(a, doc => addText(doc, { x: 0, y: 0 }));
    const object = store.getState().sessions[a].document.objects[0];
    store.getState().setSelection(a, [object.id]);
    store.getState().setViewport(a, { x: 100, y: -200, zoom: 2 });
    const b = await store.getState().createBoard('B');
    await store.getState().openBoard(a);
    await store.getState().openBoard(a);
    expect(store.getState().openBoardIds).toEqual([a, b]);
    expect(store.getState().sessions[a]).toMatchObject({ selectedObjectIds: [object.id], document: { viewport: { x: 100, y: -200, zoom: 2 } } });
    expect(store.getState().sessions[a].past).toHaveLength(1);
    store.getState().showBoardList();
    expect(store.getState().activeBoardId).toBeNull();
    expect(store.getState().openBoardIds).toEqual([a, b]);
    await store.getState().flushAll();
  });
  it('activates right then left neighbors and releases only the closed session', async () => {
    const { store } = fixture();
    const a = await store.getState().createBoard('A');
    const b = await store.getState().createBoard('B');
    const c = await store.getState().createBoard('C');
    await store.getState().openBoard(b);
    await store.getState().closeBoard(b);
    expect(store.getState().activeBoardId).toBe(c);
    expect(store.getState().sessions[b]).toBeUndefined();
    await store.getState().closeBoard(c);
    expect(store.getState().activeBoardId).toBe(a);
    await store.getState().closeBoard(a);
    expect(store.getState().activeBoardId).toBeNull();
  });
  it('retains a tab when save fails and still allows switching to another board', async () => {
    const { store, repository } = fixture();
    const a = await store.getState().createBoard('A');
    const b = await store.getState().createBoard('B');
    store.getState().executeOperation(a, doc => addText(doc, { x: 0, y: 0 }));
    vi.mocked(repository.save).mockRejectedValueOnce(new Error('Disk full'));
    await expect(store.getState().closeBoard(a)).rejects.toThrow('Disk full');
    expect(store.getState().openBoardIds).toContain(a);
    expect(store.getState().sessions[a].saveStatus).toBe('error');
    await store.getState().openBoard(b);
    expect(store.getState().activeBoardId).toBe(b);
    await store.getState().flushAll();
  });
  it('restores order and active tab while skipping unavailable boards', async () => {
    const { store, documents } = fixture();
    const a = createBoardDocument('A'), b = createBoardDocument('B');
    documents.set(a.id, a); documents.set(b.id, b);
    localStorage.setItem('imh-board-tabs-v1', JSON.stringify({ ids: [a.id, crypto.randomUUID(), b.id, a.id], active: a.id }));
    await store.getState().restoreTabs();
    expect(store.getState().openBoardIds).toEqual([a.id, b.id]);
    expect(store.getState().activeBoardId).toBe(a.id);
    expect(store.getState().sessions[a.id].past).toEqual([]);
    localStorage.removeItem('imh-board-tabs-v1');
  });
});

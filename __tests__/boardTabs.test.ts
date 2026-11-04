import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoardStore, useBoardStore } from '../store/useBoardStore';
import { boardService } from '../services/boards/boardService';
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
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => {
    vi.restoreAllMocks();
    useBoardStore.setState({ tabsRestored: false, sessions: {}, openBoardIds: [], activeBoardId: null });
    localStorage.clear();
  });
  it.each(['create', 'open'] as const)('restores saved tabs before a programmatic %s from the Library', async action => {
    const { store, documents } = fixture();
    const a = createBoardDocument('A'), b = createBoardDocument('B'), destination = createBoardDocument('Destination');
    for (const document of [a, b, destination]) documents.set(document.id, document);
    localStorage.setItem('imh-board-tabs-v1', JSON.stringify({ ids: [a.id, b.id], active: a.id }));
    const id = action === 'create' ? await store.getState().createBoard('New')
      : (await store.getState().openBoard(destination.id), destination.id);
    expect(store.getState().openBoardIds).toEqual([a.id, b.id, id]);
    expect(store.getState().activeBoardId).toBe(id);
    expect(store.getState().tabsRestored).toBe(true);
    // Mounting the workspace later must not reactivate the old saved tab.
    await store.getState().restoreTabs();
    expect(store.getState().activeBoardId).toBe(id);
  });
  it('shares in-flight restoration and preserves preferences until all saved tabs are loaded', async () => {
    const a = createBoardDocument('A'), b = createBoardDocument('B'), destination = createBoardDocument('Destination');
    let release!: () => void;
    const loading = new Promise<BoardDocument>(resolve => { release = () => resolve(b); });
    const load = vi.spyOn(boardService, 'load').mockImplementation(async id => {
      if (id === a.id) return a;
      if (id === b.id) return loading;
      if (id === destination.id) return destination;
      throw new Error('Missing');
    });
    const saved = JSON.stringify({ ids: [a.id, b.id], active: a.id });
    localStorage.setItem('imh-board-tabs-v1', saved);
    const opening = useBoardStore.getState().openBoard(destination.id);
    const restoring = useBoardStore.getState().restoreTabs();
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith(b.id));
    expect(useBoardStore.getState().tabsRestored).toBe(false);
    expect(localStorage.getItem('imh-board-tabs-v1')).toBe(saved);
    expect(load).not.toHaveBeenCalledWith(destination.id);
    release();
    await Promise.all([opening, restoring]);
    expect(load).toHaveBeenCalledTimes(3);
    expect(JSON.parse(localStorage.getItem('imh-board-tabs-v1')!)).toEqual({ ids: [a.id, b.id, destination.id], active: destination.id });
  });
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

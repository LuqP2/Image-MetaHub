import { create } from 'zustand';
import { boardService } from '../services/boards/boardService';
import { createBoardAutosave } from '../services/boards/autosave';
import { applyBoardReferenceRemaps, createBoardDocument, duplicateBoardDocument, normalizeBoardDocument, summarizeBoard } from '../services/boards/document.mjs';
import type { BoardDocument, BoardReferenceRemap, BoardRepository, BoardSummary } from '../services/boards/types';

export type BoardContentSnapshot = Pick<BoardDocument, 'objects' | 'connections'>;
export interface BoardSession {
  document: BoardDocument;
  savedRevision: number;
  changeSequence: number;
  savedSequence: number;
  selectedObjectIds: string[];
  selectedConnectionIds: string[];
  past: BoardContentSnapshot[];
  future: BoardContentSnapshot[];
  interaction: BoardContentSnapshot | null;
  saveStatus: 'saved' | 'pending' | 'saving' | 'error';
  saveError: string | null;
  saveErrorCode: string | null;
  recovering: boolean;
}
type Operation = (document: BoardDocument) => BoardDocument;
interface BoardStore {
  closing: boolean;
  setClosing(value: boolean): void;
  summaries: BoardSummary[];
  sessions: Record<string, BoardSession>;
  activeBoardId: string | null;
  loadBoardList(): Promise<void>;
  createBoard(name?: string): Promise<string>;
  openBoard(id: string): Promise<void>;
  renameBoard(id: string, name: string): void;
  duplicateBoard(id: string): Promise<string>;
  saveAsNewBoard(id: string): Promise<string>;
  reloadBoard(id: string): Promise<void>;
  deleteBoard(id: string): Promise<void>;
  closeBoard(): Promise<void>;
  adoptBoard(document: BoardDocument): void;
  executeOperation(id: string, operation: Operation): void;
  beginInteraction(id: string): void;
  updateInteraction(id: string, operation: Operation): void;
  commitInteraction(id: string): void;
  cancelInteraction(id: string): void;
  undo(id: string): void;
  redo(id: string): void;
  setViewport(id: string, viewport: BoardDocument['viewport']): void;
  setSelection(id: string, objectIds: string[], connectionIds?: string[]): void;
  flushBoard(id: string): Promise<void>;
  flushAll(): Promise<void>;
  applyReferenceRemaps(remaps: BoardReferenceRemap[]): void;
}

const content = (document: BoardDocument): BoardContentSnapshot => ({ objects: document.objects, connections: document.connections });
const sameContent = (a: BoardContentSnapshot, b: BoardContentSnapshot) => JSON.stringify(a) === JSON.stringify(b);
const newSession = (document: BoardDocument): BoardSession => ({
  document, savedRevision: document.revision, changeSequence: 0, savedSequence: 0,
  selectedObjectIds: [], selectedConnectionIds: [], past: [], future: [], interaction: null,
  saveStatus: 'saved', saveError: null, saveErrorCode: null, recovering: false,
});

export function createBoardStore(repository: BoardRepository = boardService, delay = 500) {
  const pendingLoads = new Map<string, Promise<void>>();
  const recoveries = new Map<string, Promise<string>>();
  const store = create<BoardStore>((set, get) => {
    const updateSession = (id: string, update: (session: BoardSession) => BoardSession) => set(state => {
      const session = state.sessions[id];
      if (!session) return state;
      const next = update(session);
      if (next === session) return state;
      return { sessions: { ...state.sessions, [id]: next } };
    });
    const edited = (session: BoardSession, document: BoardDocument): BoardSession => ({
      ...session, document, changeSequence: session.changeSequence + 1, saveStatus: 'pending', saveError: null, saveErrorCode: null,
    });
    const setDocument = (id: string, document: BoardDocument) => {
      const normalized = normalizeBoardDocument(document);
      set(state => ({ sessions: { ...state.sessions, [id]: newSession(normalized) }, activeBoardId: id,
        summaries: [summarizeBoard(normalized), ...state.summaries.filter(summary => summary.id !== id)] }));
    };
    return {
      summaries: [], sessions: {}, activeBoardId: null, closing: false,
      setClosing(closing) { set({ closing }); },
      async loadBoardList() { set({ summaries: await repository.list() }); },
      async createBoard(name) {
        if (get().closing) throw new Error('The application is closing.');
        const saved = await repository.save(createBoardDocument(name), 0);
        setDocument(saved.id, saved);
        return saved.id;
      },
      async openBoard(id) {
        const previous = get().activeBoardId;
        if (previous && previous !== id) await get().flushBoard(previous);
        if (!get().sessions[id]) {
          let pending = pendingLoads.get(id);
          if (!pending) {
            pending = repository.load(id).then(document => {
              if (!get().sessions[id]) updateOrAdopt(document);
            }).finally(() => pendingLoads.delete(id));
            pendingLoads.set(id, pending);
          }
          await pending;
        }
        set({ activeBoardId: id });
        function updateOrAdopt(document: BoardDocument) {
          set(state => ({ sessions: { ...state.sessions, [id]: newSession(document) } }));
        }
      },
      renameBoard(id, name) {
        if (get().closing || get().sessions[id]?.recovering) return;
        updateSession(id, session => session.document.name === name ? session : edited(session, normalizeBoardDocument({ ...session.document, name })));
        autosave.schedule(id);
      },
      async duplicateBoard(id) {
        if (get().closing) throw new Error('The application is closing.');
        const document = get().sessions[id]?.document ?? await repository.load(id);
        const saved = await repository.save(duplicateBoardDocument(document), 0);
        setDocument(saved.id, saved);
        return saved.id;
      },
      async saveAsNewBoard(id) {
        if (get().closing) throw new Error('The application is closing.');
        const existing = recoveries.get(id);
        if (existing) return existing;
        if (!get().sessions[id]) throw new Error('Board session is not open.');
        autosave.cancel(id);
        get().commitInteraction(id);
        updateSession(id, session => ({ ...session, recovering: true }));
        const recovery = (async () => {
          await autosave.settle(id);
          const source = get().sessions[id];
          const saved = await repository.save(duplicateBoardDocument(source.document), 0);
          autosave.cancel(id);
          set(state => { const sessions = { ...state.sessions }; delete sessions[id]; return { sessions }; });
          setDocument(saved.id, saved);
          await get().loadBoardList();
          return saved.id;
        })().finally(() => {
          recoveries.delete(id);
          updateSession(id, session => ({ ...session, recovering: false }));
        });
        recoveries.set(id, recovery);
        return recovery;
      },
      async reloadBoard(id) {
        if (recoveries.has(id)) await recoveries.get(id);
        autosave.cancel(id);
        // Wait for an already-running save to settle before replacing its session.
        await autosave.settle(id);
        setDocument(id, await repository.load(id));
      },
      async deleteBoard(id) {
        if (get().closing) throw new Error('The application is closing.');
        await get().flushBoard(id);
        const session = get().sessions[id];
        const summary = get().summaries.find(summary => summary.id === id);
        await repository.remove(id, session?.savedRevision ?? summary?.revision ?? 0);
        autosave.cancel(id);
        set(state => { const sessions = { ...state.sessions }; delete sessions[id]; return {
          sessions, summaries: state.summaries.filter(summary => summary.id !== id), activeBoardId: state.activeBoardId === id ? null : state.activeBoardId,
        }; });
      },
      async closeBoard() {
        const id = get().activeBoardId;
        if (id) await get().flushBoard(id);
        set({ activeBoardId: null });
      },
      adoptBoard(document) { setDocument(document.id, document); },
      executeOperation(id, operation) {
        if (get().closing || get().sessions[id]?.recovering) return;
        get().commitInteraction(id);
        updateSession(id, session => {
          const document = normalizeBoardDocument(operation(session.document));
          if (sameContent(content(document), content(session.document))) return session;
          return { ...edited(session, document), past: [...session.past, content(session.document)].slice(-100), future: [] };
        });
        autosave.schedule(id);
      },
      beginInteraction(id) { updateSession(id, session => session.interaction ? session : { ...session, interaction: content(session.document) }); },
      updateInteraction(id, operation) {
        if (get().closing || get().sessions[id]?.recovering) return;
        get().beginInteraction(id);
        updateSession(id, session => {
          const document = normalizeBoardDocument(operation(session.document));
          return sameContent(content(document), content(session.document)) ? session : edited(session, document);
        });
        autosave.schedule(id);
      },
      commitInteraction(id) {
        updateSession(id, session => !session.interaction ? session : ({ ...session,
          past: sameContent(session.interaction, content(session.document)) ? session.past : [...session.past, session.interaction].slice(-100),
          future: sameContent(session.interaction, content(session.document)) ? session.future : [], interaction: null,
        }));
      },
      cancelInteraction(id) {
        if (get().closing || get().sessions[id]?.recovering) return;
        updateSession(id, session => !session.interaction ? session : { ...edited(session, { ...session.document, ...session.interaction }), interaction: null });
        autosave.schedule(id);
      },
      undo(id) {
        if (get().closing || get().sessions[id]?.recovering) return;
        get().commitInteraction(id);
        updateSession(id, session => {
          const previous = session.past.at(-1);
          return !previous ? session : { ...edited(session, { ...session.document, ...previous }), past: session.past.slice(0, -1), future: [content(session.document), ...session.future] };
        });
        autosave.schedule(id);
      },
      redo(id) {
        if (get().closing || get().sessions[id]?.recovering) return;
        updateSession(id, session => {
          const next = session.future[0];
          return !next ? session : { ...edited(session, { ...session.document, ...next }), past: [...session.past, content(session.document)].slice(-100), future: session.future.slice(1) };
        });
        autosave.schedule(id);
      },
      setViewport(id, viewport) {
        if (get().closing || get().sessions[id]?.recovering) return;
        updateSession(id, session => JSON.stringify(session.document.viewport) === JSON.stringify(viewport) ? session : edited(session, normalizeBoardDocument({ ...session.document, viewport })));
        autosave.schedule(id);
      },
      setSelection(id, objectIds, connectionIds = []) {
        updateSession(id, session => JSON.stringify([session.selectedObjectIds, session.selectedConnectionIds]) === JSON.stringify([objectIds, connectionIds]) ? session : { ...session, selectedObjectIds: objectIds, selectedConnectionIds: connectionIds });
      },
      async flushBoard(id) { const recovery = recoveries.get(id); if (recovery) await recovery; get().commitInteraction(id); await autosave.flush(id); },
      async flushAll() {
        await Promise.all(recoveries.values());
        const ids = Object.keys(get().sessions);
        ids.forEach(id => get().commitInteraction(id));
        await autosave.flushAll(ids);
        await repository.flush();
      },
      applyReferenceRemaps(remaps) {
        for (const id of Object.keys(get().sessions)) updateSession(id, session => {
          const remapContent = (snapshot: BoardContentSnapshot) => content(applyBoardReferenceRemaps({ ...session.document, ...snapshot }, remaps));
          return { ...edited(session, applyBoardReferenceRemaps(session.document, remaps)), past: session.past.map(remapContent), future: session.future.map(remapContent), interaction: session.interaction && remapContent(session.interaction) };
        });
        Object.keys(get().sessions).forEach(id => autosave.schedule(id));
      },
    };
  });
  const autosave = createBoardAutosave({ delay,
    isDirty: id => { const session = store.getState().sessions[id]; return !!session && session.changeSequence !== session.savedSequence; },
    async persist(id) {
      const session = store.getState().sessions[id];
      if (!session) return;
      store.setState(state => ({ sessions: { ...state.sessions, [id]: { ...state.sessions[id], saveStatus: 'saving' } } }));
      const sequence = session.changeSequence;
      const saved = await repository.save({ ...session.document, revision: session.savedRevision }, session.savedRevision);
      store.setState(state => {
        const current = state.sessions[id];
        if (!current) return state;
        const document = sequence === current.changeSequence ? saved : { ...current.document, revision: saved.revision };
        return { sessions: { ...state.sessions, [id]: { ...current, document, savedRevision: saved.revision, savedSequence: sequence,
          saveStatus: sequence === current.changeSequence ? 'saved' : 'pending', saveError: null, saveErrorCode: null,
        } }, summaries: [summarizeBoard(document), ...state.summaries.filter(summary => summary.id !== id)] };
      });
    },
    onError(id, error) {
      store.setState(state => {
        if (!state.sessions[id]) return state;
        return { sessions: { ...state.sessions, [id]: { ...state.sessions[id], saveStatus: 'error', saveError: error instanceof Error ? error.message : String(error), saveErrorCode: error && typeof error === 'object' && 'code' in error ? String(error.code) : null } } };
      });
    },
  });
  return store;
}

export const useBoardStore = createBoardStore();
export const hasPendingBoardChanges = () => Object.values(useBoardStore.getState().sessions).some(session => session.changeSequence !== session.savedSequence);

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BoardVisualGroupingDialog from '../components/boards/BoardVisualGroupingDialog';
import { BoardEditorContext } from '../components/boards/BoardEditorContext';
import { useBoardStore } from '../store/useBoardStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { addAssets, updateObjects } from '../services/boards/operations';
import { boardLocator } from './helpers/boardFixtures';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), worker: vi.fn(), refresh: vi.fn(async () => true), open: vi.fn(), download: vi.fn(), model: 'clip', imageLimit: 2000 }));
vi.mock('../services/boards/visualGroupingService', () => ({ prepareVisualGrouping: (...args) => mocks.prepare(...args), runVisualGroupingWorker: (...args) => mocks.worker(...args) }));
vi.mock('../services/embeddings/semanticSearchEngine', () => ({ getIndex: () => null, canReuseImageEmbedding: () => false }));
vi.mock('../store/useSemanticStore', () => {
  const state = () => ({ modelKey: mocks.model, modelInstalled: true, modelDownloading: false, isBackfilling: false, lastError: null, refreshModelStatus: mocks.refresh, openForLibrary: mocks.open, startModelDownload: mocks.download });
  const use = Object.assign(() => state(), { getState: state });
  return { useSemanticStore: use };
});
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({ semanticSearchImageLimit: mocks.imageLimit }) }));
vi.mock('../components/boards/BoardResultThumbnail', () => ({ default: ({ image }) => <span>{image.name}</span> }));
vi.mock('../services/boards/boardService', () => ({ boardService: { save: async document => ({ ...document, revision: document.revision + 1 }), flush: async () => {} } }));
beforeEach(() => { vi.clearAllMocks(); mocks.model = 'clip'; useBoardStore.setState({ sessions: {}, activeBoardId: null, closing: false }); useSettingsStore.setState({ semanticSearchEnabled: true, enableSafeMode: false }); });
afterEach(async () => { cleanup(); await useBoardStore.getState().flushAll(); });
function fixture() {
  const document = addAssets(createBoardDocument(), ['a.png', 'b.png'].map(name => ({ name, mediaType: 'image' as const, reference: { kind: 'path' as const, locator: boardLocator(name) } })), { x: 0, y: 0 });
  useBoardStore.getState().adoptBoard(document);
  const close = vi.fn();
  mocks.prepare.mockResolvedValue({ vectors: [], failures: [] });
  mocks.worker.mockResolvedValue({ groups: [document.objects.map(object => object.id)], isolated: [] });
  render(<BoardEditorContext.Provider value={{ editable: true, connecting: false, begin() {}, change() {}, commit() {}, cancel() {}, resolveAsset: object => ({ status: 'resolved', image: { id: object.id, name: object.name, fileSize: 1, lastModified: 1 } as any }) }}><BoardVisualGroupingDialog boardId={document.id} close={close} /></BoardEditorContext.Provider>);
  return { document, close };
}
it('keeps the index untouched while disabled and requires an explicit prepare action', async () => {
  useSettingsStore.setState({ semanticSearchEnabled: false });
  fixture();
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Enable Local Visual Search'));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it('previews before applying and creates groups with one undo entry', async () => {
  const { document } = fixture();
  fireEvent.click(screen.getByText('Prepare images and group'));
  await screen.findByText('Apply groups');
  expect(useBoardStore.getState().sessions[document.id].document.objects).toHaveLength(2);
  fireEvent.click(screen.getByText('Apply groups'));
  expect(useBoardStore.getState().sessions[document.id].document.objects).toHaveLength(3);
  expect(useBoardStore.getState().sessions[document.id].past).toHaveLength(1);
  act(() => useBoardStore.getState().undo(document.id));
  expect(useBoardStore.getState().sessions[document.id].document.objects).toEqual(document.objects);
});
it('disables stale previews after a candidate changes', async () => {
  const { document } = fixture();
  fireEvent.click(screen.getByText('Prepare images and group'));
  await screen.findByText('Apply groups');
  act(() => useBoardStore.getState().executeOperation(document.id, doc => updateObjects(doc, [{ id: document.objects[0].id, x: 999 }])));
  expect((screen.getByText('Apply groups') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('Recalculate');
});
it('aborts preparation on Cancel and does not mutate the Canvas', async () => {
  const { document, close } = fixture();
  mocks.prepare.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByText('Prepare images and group'));
  fireEvent.click(screen.getByText('Cancel'));
  expect(mocks.prepare.mock.calls[0][1].signal.aborted).toBe(true);
  expect(close).toHaveBeenCalled();
  expect(useBoardStore.getState().sessions[document.id].document.objects).toEqual(document.objects);
});

import { useBoardQueryStore } from '../store/useBoardQueryStore';
import { useBoardHotkeys } from '../hooks/useBoardHotkeys';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BoardInspector from '../components/boards/BoardInspector';
import { useBoardStore } from '../store/useBoardStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { createSmartFrame, branchSmartFrame, updateSmartFrameQuery } from '../services/boards/smartFrameOperations';
import { removeObjects } from '../services/boards/operations';
import { normalizeLibraryQueryCriteria } from '../services/libraryQuery/criteria';
import type { BoardSmartFrameObject } from '../services/boards/queryTypes';
import { evaluateBoardQueries } from '../services/boards/queryEvaluator';
import { toLibraryQueryImage } from '../services/libraryQuery/dataset';
import { boardImage, boardDirectory } from './helpers/boardIntegrationFixtures';
import { importBoard, exportBoard } from '../services/boards/importExport';

vi.mock('../services/boards/boardService', () => ({ boardService: { save: async (document, revision) => ({ ...document, revision: revision + 1 }), flush: async () => {} } }));
beforeEach(() => useBoardStore.setState({ sessions: {}, activeBoardId: null, closing: false }));
afterEach(async () => { cleanup(); await useBoardStore.getState().flushAll(); });
function fixture() {
  const document = createSmartFrame(createBoardDocument(), { id: 'flux', title: 'Flux', criteria: normalizeLibraryQueryCriteria({ selectedModels: ['Flux'] }) });
  useBoardStore.getState().adoptBoard(document);
  useBoardStore.getState().setSelection(document.id, ['flux']);
  return { id: document.id, current: () => useBoardStore.getState().sessions[document.id].document };
}
const dataset = { images: ['A', 'B', 'none'].map(lora => toLibraryQueryImage({ ...boardImage(`${lora}.png`), models: ['Flux'], loras: lora === 'none' ? [] : [lora] })),
  references: {}, collections: {}, context: { visibleDirectories: [boardDirectory], safeMode: { enableSafeMode: false, blurSensitiveImages: false, sensitiveTags: [] } } };
describe('visual filter branching', () => {
  it('creates a linked branch and a detached duplicate through the inspector', () => {
    const f = fixture();
    render(<BoardInspector boardId={f.id} editable />);
    fireEvent.click(screen.getByRole('button', { name: 'Branch from results' }));
    const child = f.current().objects[1] as BoardSmartFrameObject;
    expect(child.source).toEqual({ kind: 'frame', frameId: 'flux' });
    expect(screen.getByRole('region', { name: 'Inherited filters' }).textContent).toContain('Checkpoints: Flux');
    act(() => useBoardQueryStore.setState({ results: { [f.id]: evaluateBoardQueries(dataset, f.current().objects as BoardSmartFrameObject[], 1, 1) } }));
    fireEvent.click(screen.getByRole('button', { name: /^LoRAs/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Include LoRAs: A' }));
    expect((f.current().objects[0] as BoardSmartFrameObject).criteria.selectedLoras).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate query independently' }));
    const duplicate = f.current().objects[2] as BoardSmartFrameObject;
    expect(duplicate.source.kind).toBe('query');
    act(() => useBoardStore.getState().executeOperation(f.id, document => updateSmartFrameQuery(document, 'flux', normalizeLibraryQueryCriteria({ selectedModels: ['SDXL'] }))));
    const results = evaluateBoardQueries(dataset, f.current().objects as BoardSmartFrameObject[], 1, 1);
    expect(results[child.id].totalCount).toBe(0);
    expect(results[duplicate.id].totalCount).toBe(1);
    const reopened = importBoard(exportBoard(f.current()));
    expect(evaluateBoardQueries(dataset, reopened.objects as BoardSmartFrameObject[], 1, 1)[duplicate.id].totalCount).toBe(1);
  });
  it('defaults difference to spatial A minus B and allows inversion before creating', () => {
    const f = fixture();
    act(() => useBoardStore.getState().executeOperation(f.id, document => createSmartFrame(document, { id: 'right', title: 'Right', x: 900 })));
    act(() => useBoardStore.getState().setSelection(f.id, ['right', 'flux']));
    render(<BoardInspector boardId={f.id} editable />);
    fireEvent.click(screen.getByRole('button', { name: /Difference/ }));
    expect(screen.getByRole('dialog').textContent).toContain('Flux minus Right');
    fireEvent.click(screen.getByRole('button', { name: 'Swap A and B' }));
    expect(screen.getByRole('dialog').textContent).toContain('Right minus Flux');
    fireEvent.click(screen.getByRole('button', { name: 'Create difference' }));
    expect((f.current().objects[2] as BoardSmartFrameObject).source).toEqual({ kind: 'difference', left: { kind: 'frame', frameId: 'right' }, right: { kind: 'frame', frameId: 'flux' } });
  });
  it('contains difference dialog focus and protects selected frames from destructive board hotkeys', () => {
    const f = fixture();
    act(() => useBoardStore.getState().executeOperation(f.id, document => createSmartFrame(document, { id: 'right', title: 'Right', x: 900 })));
    act(() => useBoardStore.getState().setSelection(f.id, ['flux', 'right']));
    function Workspace() {
      const onKeyDownCapture = useBoardHotkeys(f.id, true);
      return <div onKeyDownCapture={onKeyDownCapture}><button>Outside</button><BoardInspector boardId={f.id} editable /></div>;
    }
    render(<Workspace />);
    const trigger = screen.getByRole('button', { name: /Difference/ });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const first = screen.getByRole('button', { name: 'Swap A and B' });
    const last = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(first);
    for (const key of ['Delete', 'Backspace']) fireEvent.keyDown(document.activeElement!, { key });
    expect(f.current().objects.map(object => object.id)).toEqual(['flux', 'right']);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(f.current().objects.map(object => object.id)).toEqual(['flux', 'right']);
  });
  it('restores missing parent dependencies on undo and blocks cyclic reconnections in the picker', () => {
    const f = fixture();
    act(() => useBoardStore.getState().executeOperation(f.id, document => branchSmartFrame(document, 'flux')));
    const child = f.current().objects[1];
    render(<BoardInspector boardId={f.id} editable />);
    expect(screen.queryByRole('option', { name: `Frame: ${(child as BoardSmartFrameObject).title}` })).toBeNull();
    act(() => useBoardStore.getState().executeOperation(f.id, document => removeObjects(document, ['flux'])));
    expect(evaluateBoardQueries(dataset, f.current().objects as BoardSmartFrameObject[], 1, 1)[child.id].status).toBe('source-missing');
    act(() => useBoardStore.getState().undo(f.id));
    expect(evaluateBoardQueries(dataset, f.current().objects as BoardSmartFrameObject[], 1, 1)[child.id].status).toBe('ready');
  });
  it('disables branching for read-only sessions', () => {
    const f = fixture(); render(<BoardInspector boardId={f.id} editable={false} />);
    expect((screen.getByRole('button', { name: 'Branch from results' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Duplicate query independently' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

it('removes a local group constraint without changing the parent query', () => {
  let document = createSmartFrame(createBoardDocument(), { id: 'parent' });
  document = branchSmartFrame(document, 'parent', [{ kind: 'exact', dimension: 'lora', value: 'A' }]);
  const child = document.objects[1];
  useBoardStore.getState().adoptBoard(document);
  useBoardStore.getState().setSelection(document.id, [child.id]);
  render(<BoardInspector boardId={document.id} editable />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove group filter' }));
  const updated = useBoardStore.getState().sessions[document.id].document;
  expect((updated.objects[1] as BoardSmartFrameObject).groupConstraints).toEqual([]);
  expect(updated.objects[0]).toEqual(document.objects[0]);
});

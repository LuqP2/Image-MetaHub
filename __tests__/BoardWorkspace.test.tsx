import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BoardWorkspace from '../components/BoardWorkspace';
import { useBoardStore } from '../store/useBoardStore';

const mock = vi.hoisted(() => ({ documents: new Map(), exported: vi.fn() }));
vi.mock('../services/boards/boardService', () => ({
  boardService: {
    list: async () => [...mock.documents.values()].map(document => ({ ...document, objectCount: document.objects.length })),
    load: async id => mock.documents.get(id),
    save: async (document, revision) => { const saved = { ...document, revision: revision + 1 }; mock.documents.set(saved.id, saved); return saved; },
    remove: async id => { mock.documents.delete(id); }, flush: async () => {}, remapReferences: async () => {},
  },
  exportBoardFile: mock.exported, importBoardFile: async () => null,
}));
// Exercise the workspace/store/inspector without a browser geometry engine.
vi.mock('../components/boards/BoardCanvas', () => ({ default: () => <div data-testid="board-stage" /> }));

beforeEach(() => { mock.documents.clear(); mock.exported.mockClear(); useBoardStore.setState({ sessions: {}, summaries: [], activeBoardId: null }); });
afterEach(async () => { await act(async () => { await useBoardStore.getState().flushAll(); }); cleanup(); });
describe('board workspace flow', () => {
  it('creates a board, adds text, edits through the inspector and preserves undo', async () => {
    render(<BoardWorkspace editable />);
    fireEvent.change(screen.getByLabelText('New board name'), { target: { value: 'Campaign' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create board' }));
    await screen.findByRole('button', { name: 'Text', exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'Text', exact: true }));
    const id = useBoardStore.getState().activeBoardId!;
    const object = useBoardStore.getState().sessions[id].document.objects[0];
    act(() => useBoardStore.getState().setSelection(id, [object.id]));
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Scene one' } });
    fireEvent.blur(screen.getByLabelText('Text'));
    expect(useBoardStore.getState().sessions[id].document.objects[0]).toMatchObject({ text: 'Scene one' });
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    expect(useBoardStore.getState().sessions[id].document.objects[0]).toMatchObject({ text: 'Text' });
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
    await waitFor(() => expect(mock.exported).toHaveBeenCalled());
  });
  it('keeps existing boards viewable/exportable while disabling editing', async () => {
    let id: string;
    await act(async () => { id = await useBoardStore.getState().createBoard('Read only'); });
    await act(async () => { render(<BoardWorkspace editable={false} />); });
    const text = screen.getByRole('button', { name: 'Text', exact: true }) as HTMLButtonElement;
    expect(text.disabled).toBe(true);
    expect((screen.getByLabelText('Board name') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Export', exact: true }) as HTMLButtonElement).disabled).toBe(false);
    expect(useBoardStore.getState().sessions[id!].document.name).toBe('Read only');
  });
});

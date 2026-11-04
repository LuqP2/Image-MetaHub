import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyBoardSelection, pasteBoardSelection } from '../services/boards/commands';
import { useBoardStore } from '../store/useBoardStore';
import { useBoardHotkeys } from '../hooks/useBoardHotkeys';
import { addText } from '../services/boards/operations';

vi.mock('../services/boards/boardService', () => ({ boardService: { save: async (document, revision) => ({ ...document, revision: revision + 1 }), flush: async () => {} } }));
const write = vi.fn(), read = vi.fn();
beforeEach(() => { useBoardStore.setState({ sessions: {}, activeBoardId: null, openBoardIds: [], closing: false }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write.mockReset().mockResolvedValue(undefined), readText: read.mockReset() } }); });
afterEach(async () => { cleanup(); await useBoardStore.getState().flushAll(); });
async function selectedBoard() {
  const id = await useBoardStore.getState().createBoard();
  useBoardStore.getState().executeOperation(id, document => addText(document, { x: 0, y: 0 }));
  useBoardStore.getState().setSelection(id, [useBoardStore.getState().sessions[id].document.objects[0].id]);
  return id;
}
function Keys({ id }: { id: string }) { const key = useBoardHotkeys(id, true); return <section tabIndex={0} data-testid="canvas" onKeyDownCapture={key}><textarea aria-label="Editor" /><div data-board-results><button>Result</button></div></section>; }
describe('system clipboard commands', () => {
  it('retains the source on clipboard failure and only cuts after successful write', async () => {
    const id = await selectedBoard();
    write.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    await expect(copyBoardSelection(id, true)).rejects.toThrow('Clipboard unavailable');
    expect(useBoardStore.getState().sessions[id].document.objects).toHaveLength(1);
    await copyBoardSelection(id, true);
    expect(useBoardStore.getState().sessions[id].document.objects).toHaveLength(0);
    expect(useBoardStore.getState().sessions[id].past).toHaveLength(2);
    useBoardStore.getState().undo(id);
    expect(useBoardStore.getState().sessions[id].document.objects).toHaveLength(1);
  });
  it('copies between boards, selects new IDs and pastes as one undo operation', async () => {
    const a = await selectedBoard();
    await copyBoardSelection(a);
    read.mockResolvedValue(write.mock.calls[0][0]);
    const b = await useBoardStore.getState().createBoard();
    await pasteBoardSelection(b, { x: 250, y: -100 });
    const session = useBoardStore.getState().sessions[b];
    expect(session.document.objects[0]).toMatchObject({ x: 250, y: -100 });
    expect(session.selectedObjectIds).toEqual([session.document.objects[0].id]);
    expect(session.past).toHaveLength(1);
    useBoardStore.getState().undo(b);
    expect(useBoardStore.getState().sessions[b].document.objects).toHaveLength(0);
  });
  it('pastes URLs and ordinary text into editable text objects', async () => {
    const id = await useBoardStore.getState().createBoard();
    read.mockResolvedValue('https://example.org/path');
    await pasteBoardSelection(id, { x: 0, y: 0 });
    expect(useBoardStore.getState().sessions[id].document.objects[0]).toMatchObject({ type: 'text', text: 'https://example.org/path' });
    read.mockResolvedValue('Ideas\nfor next week');
    await pasteBoardSelection(id, { x: 300, y: 0 });
    expect(useBoardStore.getState().sessions[id].document.objects[1]).toMatchObject({ type: 'text', text: 'Ideas\nfor next week' });
  });
  it('rejects bad fragments without modifying the destination', async () => {
    const id = await selectedBoard();
    const before = useBoardStore.getState().sessions[id];
    read.mockResolvedValue('{"format":"image-metahub-board-fragment","version":99}');
    await expect(pasteBoardSelection(id)).rejects.toThrow('Unsupported');
    expect(useBoardStore.getState().sessions[id]).toBe(before);
  });
  it('keeps text editing, composition and Smart Frame results isolated from object shortcuts', async () => {
    const id = await selectedBoard();
    render(<Keys id={id} />);
    fireEvent.keyDown(screen.getByLabelText('Editor'), { key: 'x', ctrlKey: true });
    fireEvent.keyDown(screen.getByLabelText('Editor'), { key: 'v', metaKey: true });
    fireEvent.keyDown(screen.getByTestId('canvas'), { key: 'x', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Result' }), { key: 'Delete' });
    expect(write).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    expect(useBoardStore.getState().sessions[id].document.objects).toHaveLength(1);
    fireEvent.keyDown(screen.getByTestId('canvas'), { key: 'c', metaKey: true });
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
  });
});

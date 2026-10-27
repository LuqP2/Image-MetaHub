import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardHotkeys } from '../hooks/useBoardHotkeys';
import { useBoardStore } from '../store/useBoardStore';
import { addText } from '../services/boards/operations';

vi.mock('../services/boards/boardService', () => ({ boardService: {
  list: async () => [], save: async (document, revision) => ({ ...document, revision: revision + 1 }), flush: async () => {},
} }));
function Harness({ id, editable }: { id: string; editable: boolean }) {
  const onKeyDownCapture = useBoardHotkeys(id, editable);
  return <section data-testid="canvas" tabIndex={0} onKeyDownCapture={onKeyDownCapture}><input aria-label="typing" /></section>;
}
beforeEach(() => useBoardStore.setState({ sessions: {}, summaries: [], activeBoardId: null }));
afterEach(async () => { await act(async () => useBoardStore.getState().flushAll()); cleanup(); });

describe('canvas keyboard isolation', () => {
  it('removes objects locally and stops library-level Delete and Select All handlers', async () => {
    const id = await useBoardStore.getState().createBoard();
    useBoardStore.getState().executeOperation(id, document => addText(document, { x: 0, y: 0 }));
    const object = useBoardStore.getState().sessions[id].document.objects[0];
    useBoardStore.getState().setSelection(id, [object.id]);
    const global = vi.fn(); document.addEventListener('keydown', global);
    try {
      render(<Harness id={id} editable />);
      fireEvent.keyDown(screen.getByTestId('canvas'), { key: 'a', ctrlKey: true });
      expect(global).not.toHaveBeenCalled();
      fireEvent.keyDown(screen.getByTestId('canvas'), { key: 'Delete' });
      expect(global).not.toHaveBeenCalled();
      expect(useBoardStore.getState().sessions[id].document.objects).toHaveLength(0);
      fireEvent.keyDown(screen.getByLabelText('typing'), { key: 'Backspace' });
      expect(global).toHaveBeenCalledOnce();
    } finally { document.removeEventListener('keydown', global); }
  });
  it('blocks Delete in a read-only board without changing its content', async () => {
    const id = await useBoardStore.getState().createBoard();
    useBoardStore.getState().executeOperation(id, document => addText(document, { x: 0, y: 0 }));
    const global = vi.fn(); document.addEventListener('keydown', global);
    try {
      render(<Harness id={id} editable={false} />);
      fireEvent.keyDown(screen.getByTestId('canvas'), { key: 'Delete' });
      expect(global).not.toHaveBeenCalled();
      expect(useBoardStore.getState().sessions[id].document.objects).toHaveLength(1);
    } finally { document.removeEventListener('keydown', global); }
  });
});

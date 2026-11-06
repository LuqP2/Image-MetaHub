import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BoardEditorContext } from '../components/boards/BoardEditorContext';
import BoardSmartFrameFilterPopover from '../components/boards/BoardSmartFrameFilterPopover';
import { useBoardStore } from '../store/useBoardStore';
import { useBoardUIStore } from '../store/useBoardUIStore';
import { createBoardDocument } from '../services/boards/document.mjs';
import { createSmartFrame } from '../services/boards/smartFrameOperations';

vi.mock('@xyflow/react', () => ({ useViewport: () => ({ x: 0, y: 0, zoom: 1 }) }));
vi.mock('../components/boards/BoardSmartFrameFilters', () => ({ default: () => <input aria-label="Local search" /> }));
vi.mock('../services/boards/boardService', () => ({ boardService: { save: async document => ({ ...document, revision: document.revision + 1 }), flush: async () => {} } }));
beforeEach(() => { vi.stubGlobal('CSS', { escape: (value: string) => value }); useBoardStore.setState({ sessions: {}, activeBoardId: null }); useBoardUIStore.setState({ filterTarget: null }); });
afterEach(async () => { cleanup(); await useBoardStore.getState().flushAll(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([700, 20])('anchors to the left or falls back to the right at frame x=%s, then restores focus', x => {
  const document = createSmartFrame(createBoardDocument(), { id: 'frame', title: 'My frame' });
  useBoardStore.getState().adoptBoard(document);
  useBoardUIStore.getState().setFilterTarget({ boardId: document.id, frameId: 'frame' });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: x, right: x + 200, top: 30, width: 200, height: 300 } as DOMRect);
  const view = render(<BoardEditorContext.Provider value={{ editable: true, connecting: false, begin() {}, change() {}, commit() {}, cancel() {} }}><div className="board-stage"><div className="react-flow__node" data-id="frame"><button data-board-filter-trigger="frame">Filters</button></div></div><BoardSmartFrameFilterPopover boardId={document.id} /></BoardEditorContext.Provider>);
  expect(screen.getByRole('dialog').style.left).toBe(x === 700 ? '328px' : '232px');
  expect(window.document.activeElement).toBe(screen.getByLabelText('Local search'));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(window.document.activeElement).toBe(screen.getByText('Filters'));
  act(() => useBoardUIStore.getState().setFilterTarget({ boardId: document.id, frameId: 'frame' }));
  fireEvent.pointerDown(window.document.body);
  expect(screen.queryByRole('dialog')).toBeNull();
  view.unmount();
  expect(useBoardUIStore.getState().filterTarget).toBeNull();
});

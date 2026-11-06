import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BoardStackNode from '../components/boards/BoardStackNode';
import { BoardEditorContext } from '../components/boards/BoardEditorContext';
import { useBoardStore } from '../store/useBoardStore';
import { addAssets } from '../services/boards/operations';
import { createStack } from '../services/boards/stackOperations';
import { createBoardDocument } from '../services/boards/document.mjs';
import { boardLocator } from './helpers/boardFixtures';
import type { BoardStackObject } from '../services/boards/types';

vi.mock('../components/boards/BoardNodeControls', () => ({ default: () => null }));
vi.mock('../components/boards/BoardResultThumbnail', () => ({ default: ({ image, open }) => <button onDoubleClick={open}>{image.name}</button> }));
vi.mock('../services/boards/boardService', () => ({ boardService: { save: async document => ({ ...document, revision: document.revision + 1 }), flush: async () => {} } }));
afterEach(async () => { cleanup(); await useBoardStore.getState().flushAll(); });
it('navigates, persists a chosen cover, expands and unstacks with undo', () => {
  const base = addAssets(createBoardDocument(), ['a.png', 'b.png'].map(name => ({ name, mediaType: 'image' as const, reference: { kind: 'path' as const, locator: boardLocator(name) } })), { x: 0, y: 0 });
  const document = createStack(base, base.objects.map(object => object.id));
  const stack = document.objects.find(object => object.type === 'stack')! as BoardStackObject;
  useBoardStore.getState().adoptBoard(document);
  useBoardStore.setState({ activeBoardId: document.id });
  const open = vi.fn();
  function Fixture() {
    const object = useBoardStore(state => state.sessions[document.id].document.objects.find(object => object.id === stack.id));
    return object ? <BoardStackNode {...({ data: { object }, selected: true } as any)} /> : null;
  }
  render(<BoardEditorContext.Provider value={{ editable: true, connecting: false, begin() {}, change() {}, commit() {}, cancel() {}, openAsset: open, resolveAsset: object => ({ status: 'resolved', image: { id: object.id, name: object.name } as any }) }}><Fixture /></BoardEditorContext.Provider>);
  fireEvent.click(screen.getByLabelText('Next stack image'));
  expect(screen.getByText('b.png')).toBeTruthy();
  fireEvent.click(screen.getByText('Set cover'));
  expect((useBoardStore.getState().sessions[document.id].document.objects.find(object => object.id === stack.id) as BoardStackObject).coverId).toBe(base.objects[1].id);
  fireEvent.doubleClick(screen.getByText('b.png'));
  expect(open).toHaveBeenCalled();
  fireEvent.click(screen.getByText('Expand'));
  expect(screen.getByText('a.png')).toBeTruthy();
  fireEvent.click(screen.getByText('Unstack'));
  expect(useBoardStore.getState().sessions[document.id].document.objects).toHaveLength(2);
  expect(useBoardStore.getState().sessions[document.id].past).toHaveLength(2);
});

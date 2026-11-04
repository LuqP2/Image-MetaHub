import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BoardRichText from '../components/boards/BoardRichText';
import BoardSelectionStyles from '../components/boards/BoardSelectionStyles';
import BoardPanelResizeHandle from '../components/boards/BoardPanelResizeHandle';
import BoardExportDialog from '../components/boards/BoardExportDialog';
import { useBoardUIStore } from '../store/useBoardUIStore';
import { useBoardStore } from '../store/useBoardStore';
import { addText, updateObjects } from '../services/boards/operations';
import { createBoardDocument, normalizeBoardDocument } from '../services/boards/document.mjs';
import { browserMarqueeIds } from '../services/boards/assetSelection';
import { facingBoardSides } from '../services/boards/connectionGeometry';

vi.mock('../services/boards/boardService', () => ({ boardService: { save: async (doc, revision) => ({ ...doc, revision: revision + 1 }), flush: async () => {} } }));
beforeEach(() => { useBoardUIStore.setState({ libraryWidth: 264, inspectorWidth: 320 }); useBoardStore.setState({ sessions: {}, openBoardIds: [], activeBoardId: null, closing: false }); });
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await useBoardStore.getState().flushAll(); });

describe('Canvas usability corrections', () => {
  it('makes inline web URLs clickable without swallowing punctuation or opening the object', () => {
    const edit = vi.fn();
    render(<div onDoubleClick={edit}><BoardRichText text={'Read https://example.org/a, then www.example.com. javascript:alert(1)'} /></div>);
    const links = screen.getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual(['https://example.org/a', 'https://www.example.com']);
    expect(links[0].textContent).toBe('https://example.org/a');
    fireEvent.doubleClick(links[0]); expect(edit).not.toHaveBeenCalled();
  });
  it('provides one font-size input and one color section for mixed selections', () => {
    let document = addText(addText(createBoardDocument(), { x: 0, y: 0 }), { x: 400, y: 0 });
    document = updateObjects(document, [{ id: document.objects[1].id, fontSize: 32, color: '#112233' }]);
    useBoardStore.getState().adoptBoard(document);
    useBoardStore.getState().setSelection(document.id, document.objects.map(object => object.id));
    render(<BoardSelectionStyles boardId={document.id} editable />);
    expect(screen.queryByLabelText('Text size')).toBeNull();
    expect(screen.getAllByLabelText('Custom color')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Font size'), { target: { value: '28' } });
    fireEvent.blur(screen.getByLabelText('Font size'));
    expect(useBoardStore.getState().sessions[document.id].document.objects.every(object => object.type === 'text' && object.fontSize === 28)).toBe(true);
    expect(useBoardStore.getState().sessions[document.id].past).toHaveLength(1);
  });
  it.each(['library', 'inspector'] as const)('resizes the %s panel by drag and keyboard within bounds', side => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    render(<BoardPanelResizeHandle side={side} />);
    const separator = screen.getByRole('separator');
    Object.defineProperty(separator, 'setPointerCapture', { value: vi.fn() });
    fireEvent.pointerDown(separator, { button: 0, clientX: 100 });
    fireEvent.pointerMove(separator, { clientX: side === 'library' ? 180 : 20 });
    fireEvent.pointerUp(separator);
    expect(useBoardUIStore.getState()[side === 'library' ? 'libraryWidth' : 'inspectorWidth']).toBe((side === 'library' ? 264 : 320) + 80);
    act(() => useBoardUIStore.getState().setPanelWidth(side, 10000));
    expect(useBoardUIStore.getState()[side === 'library' ? 'libraryWidth' : 'inspectorWidth']).toBe(560);
  });
  it('opens export choices inside a focused modal and contains keyboard navigation', () => {
    const png = vi.fn(), close = vi.fn();
    render(<BoardExportDialog close={close} exportDocument={vi.fn()} exportPng={png} />);
    expect(screen.getByRole('dialog', { name: 'Export board' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'PNG image' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'PNG image' })); expect(png).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(close).toHaveBeenCalledOnce();
  });
  it('marquee hit testing includes scrolled virtual rows and ignores gaps', () => {
    const ids = Array.from({ length: 10000 }, (_, index) => `image-${index}`);
    expect(browserMarqueeIds(ids, 264, { left: 0, right: 264, top: 0, bottom: 278 })).toEqual(['image-0', 'image-1', 'image-2', 'image-3']);
    expect(browserMarqueeIds(ids, 264, { left: 8, right: 120, top: 14000, bottom: 14139 })).toEqual(['image-200']);
    expect(browserMarqueeIds(ids, 264, { left: 0, right: 7, top: 0, bottom: 300 })).toEqual([]);
  });
  it('chooses facing connection sides and round-trips line thickness', () => {
    const doc = addText(addText(createBoardDocument(), { x: 0, y: 0 }), { x: 400, y: 0 });
    expect(facingBoardSides(doc.objects[0], doc.objects[1])).toEqual({ sourceSide: 'right', targetSide: 'left' });
    const connection = { id: 'edge', type: 'manual', sourceObjectId: doc.objects[0].id, targetObjectId: doc.objects[1].id, sourceSide: 'right', targetSide: 'left', color: '#112233', label: '', width: 6 };
    expect(normalizeBoardDocument({ ...doc, connections: [connection] }).connections[0].width).toBe(6);
    for (const width of [0, 13, NaN]) expect(() => normalizeBoardDocument({ ...doc, connections: [{ ...connection, width }] })).toThrow();
  });
});

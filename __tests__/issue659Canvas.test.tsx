import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import BoardRichText from '../components/boards/BoardRichText';
import BoardTooltips from '../components/boards/BoardTooltips';
import { createBoardDocument, normalizeBoardDocument } from '../services/boards/document.mjs';
import { addAssets, addText, addConnection, reverseConnections } from '../services/boards/operations';
import { copyBoardFragment, parseBoardFragment, pasteBoardFragment } from '../services/boards/clipboard';
import { boardToFlow } from '../services/boards/reactFlowAdapter';
import { searchBoardAssets } from '../services/boards/assetSearch';
import { externalBoardReference } from '../services/boards/externalAssets';
import type { IndexedImage } from '../types';

afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('issue 659 canvas', () => {
  it('keeps URL text draggable and requires a modifier to open the inline link', () => {
    const parent = vi.fn();
    render(<div onPointerDown={parent}><BoardRichText text="https://example.com/test" /></div>);
    const link = screen.getByRole('link');
    expect(link.className).not.toContain('nodrag');
    fireEvent.pointerDown(link);
    expect(parent).toHaveBeenCalledOnce();
    expect(fireEvent.click(link)).toBe(false);
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
  });
  it('renders the dock tooltip outside its clipping container and supports keyboard focus', () => {
    vi.useFakeTimers();
    const view = render(<div style={{ overflow: 'hidden' }}><BoardTooltips /><button title="Draw text">Text</button></div>);
    const button = screen.getByRole('button');
    fireEvent.pointerOver(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('tooltip').parentElement).toBe(document.body);
    expect(view.container.contains(screen.getByRole('tooltip'))).toBe(false);
    fireEvent.pointerLeave(button.parentElement!);
    fireEvent.focusIn(button);
    expect(screen.getByRole('tooltip').textContent).toBe('Draw text');
  });
  it('preserves external references, card labels and connection appearance through clipboard and disk', () => {
    let board = addAssets(createBoardDocument(), [{ name: 'picture.png', mediaType: 'image', reference: externalBoardReference('/synthetic/picture.png') }], { x: 0, y: 0 });
    board = addText(board, { x: 600, y: 0 });
    const asset = board.objects[0];
    board = normalizeBoardDocument({ ...board, objects: board.objects.map(object => object.id === asset.id ? { ...object, label: 'Reference' } : object) });
    board = addConnection(board, { sourceObjectId: asset.id, targetObjectId: board.objects[1].id, sourceSide: 'right', targetSide: 'left', label: 'Composition', color: '#ffffff', routing: 'orthogonal', anchoring: 'automatic', labelFontSize: 24, labelOffset: { x: 80, y: -40 } });
    const restored = normalizeBoardDocument(JSON.parse(JSON.stringify(board)));
    expect(restored.schemaVersion).toBe(6);
    const pasted = pasteBoardFragment(createBoardDocument(), parseBoardFragment(copyBoardFragment(restored, restored.objects.map(object => object.id)))!, { x: 0, y: 0 }).document;
    expect(pasted.objects[0]).toMatchObject({ label: 'Reference', reference: { kind: 'external' } });
    expect(pasted.connections[0]).toMatchObject({ routing: 'orthogonal', labelFontSize: 24, labelOffset: { x: 80, y: -40 } });
    expect(reverseConnections(reverseConnections(restored, [restored.connections[0].id]), [restored.connections[0].id]).connections).toEqual(restored.connections);
    const moved = { ...restored, objects: restored.objects.map((object, index) => index ? { ...object, x: 0, y: 500 } : object) };
    expect(boardToFlow(moved, [], [], true).edges[0]).toMatchObject({ sourceHandle: 'bottom', targetHandle: 'top' });
  });
  it('combines subfolder scope with media and search without mixing roots', () => {
    const images = [{ id: 'a::work/sub/cat.png', name: 'cat.png', directoryId: 'a', lastModified: 1 }, { id: 'a::work2/cat.png', name: 'cat.png', directoryId: 'a', lastModified: 2 }, { id: 'b::work/cat.png', name: 'cat.png', directoryId: 'b', lastModified: 3 }] as IndexedImage[];
    expect(searchBoardAssets(images, '', 'a', 'image', 'work').map(image => image.id)).toEqual(['a::work/sub/cat.png']);
  });
});

import { describe, expect, it } from 'vitest';
import { createBoardDocument, normalizeBoardDocument } from '../services/boards/document.mjs';
import { drawBoardObject, addConnection, createFrame } from '../services/boards/operations';
import { copyBoardFragment, parseBoardFragment, pasteBoardFragment, selectionClosure } from '../services/boards/clipboard';
import { createSmartFrame, branchSmartFrame } from '../services/boards/smartFrameOperations';
import { frameDependencies } from '../services/boards/queryGraph';
import { pngExportDocument, pngExportSize } from '../services/boards/pngExport';
import { importBoard, exportBoard } from '../services/boards/importExport';
import type { BoardTool } from '../services/boards/types';

describe('Canvas creative objects and fragment transport', () => {
  const bounds = { x: 100, y: 200, width: 240, height: 180 };
  it.each(['sticky', 'rectangle', 'ellipse', 'diamond', 'link'] as BoardTool[])('round-trips %s through disk and clipboard', tool => {
    const original = drawBoardObject(createBoardDocument(), tool as Exclude<BoardTool, 'select' | 'connect'>, bounds);
    const imported = importBoard(exportBoard(original));
    expect(imported.schemaVersion).toBe(3);
    expect(imported.objects).toEqual(original.objects);
    const fragment = parseBoardFragment(copyBoardFragment(original, [original.objects[0].id]))!;
    const pasted = pasteBoardFragment(createBoardDocument(), fragment, { x: 10, y: 20 });
    expect(pasted.document.objects[0]).toMatchObject({ x: 10, y: 20, width: 240, height: 180 });
    expect(pasted.ids[0]).not.toBe(original.objects[0].id);
  });
  it('preserves frame members, geometry, style and internal connectors with fresh IDs', () => {
    let doc = drawBoardObject(createBoardDocument(), 'sticky', bounds);
    doc = drawBoardObject(doc, 'diamond', { ...bounds, x: 500 });
    const [a, b] = doc.objects;
    doc = addConnection(doc, { sourceObjectId: a.id, targetObjectId: b.id, sourceSide: 'right', targetSide: 'left', label: 'next', color: '#112233' });
    doc = createFrame(doc, [a.id, b.id]);
    const frame = doc.objects.find(object => object.type === 'frame')!;
    const pasted = pasteBoardFragment(createBoardDocument(), parseBoardFragment(copyBoardFragment(doc, [frame.id]))!, { x: -20, y: -30 }).document;
    const copiedFrame = pasted.objects.find(object => object.type === 'frame')!;
    expect(pasted.objects).toHaveLength(3);
    expect(pasted.objects.filter(object => object.frameId === copiedFrame.id)).toHaveLength(2);
    expect(pasted.connections[0]).toMatchObject({ label: 'next', color: '#112233' });
    expect(pasted.objects.some(object => object.id === pasted.connections[0].sourceObjectId)).toBe(true);
    expect(pasted.objects.some(object => object.id === pasted.connections[0].targetObjectId)).toBe(true);
    expect(pasted.objects.find(object => object.type === 'shape')!.x - pasted.objects.find(object => object.type === 'sticky')!.x).toBe(400);
  });
  it('detaches a lone member from its original frame', () => {
    let doc = drawBoardObject(createBoardDocument(), 'sticky', bounds);
    const id = doc.objects[0].id;
    doc = createFrame(doc, [id]);
    expect(parseBoardFragment(copyBoardFragment(doc, [id]))!.objects[0].frameId).toBeNull();
  });
  it('copies transitive live query dependencies once and remaps links', () => {
    let doc = createSmartFrame(createBoardDocument(), {});
    const parent = doc.objects[0].id;
    doc = branchSmartFrame(doc, parent, []);
    const child = doc.objects.at(-1)!.id;
    const fragment = parseBoardFragment(copyBoardFragment(doc, [child]))!;
    expect(fragment.objects).toHaveLength(2);
    expect(selectionClosure(doc, [child]).size).toBe(1);
    const pasted = pasteBoardFragment(createBoardDocument(), fragment, bounds).document;
    const linked = pasted.objects.find(object => object.type === 'smart-frame' && frameDependencies(object.source).length)!;
    if (linked.type !== 'smart-frame') throw new Error('Expected Smart Frame');
    const dependency = frameDependencies(linked.source)[0];
    expect(dependency).not.toBe(parent);
    expect(pasted.objects.some(object => object.id === dependency)).toBe(true);
  });
  it('keeps a missing query dependency missing even if the destination has its old ID', () => {
    const destination = createSmartFrame(createBoardDocument(), {});
    let source = createSmartFrame(createBoardDocument(), {});
    source = { ...source, objects: source.objects.map(object => object.type === 'smart-frame' ? { ...object, source: { kind: 'frame', frameId: destination.objects[0].id } } : object) };
    const pasted = pasteBoardFragment(destination, parseBoardFragment(copyBoardFragment(source, [source.objects[0].id]))!, bounds).document;
    const copy = pasted.objects.at(-1)!;
    if (copy.type !== 'smart-frame') throw new Error('Expected Smart Frame');
    expect(pasted.objects.some(object => object.id === frameDependencies(copy.source)[0])).toBe(false);
  });
  it('rejects corrupt or newer board clipboard data while accepting ordinary text', () => {
    expect(parseBoardFragment('hello')).toBeNull();
    expect(parseBoardFragment('{"title":"plain JSON"}')).toBeNull();
    expect(() => parseBoardFragment('{"format":"image-metahub-board-fragment","version":2}')).toThrow();
    expect(() => parseBoardFragment('{"format":"image-metahub-board-fragment","version":1,"document":{}}')).toThrow();
  });
  it.each(['javascript:alert(1)', 'file:///private/file', 'bad-url'])('rejects unsafe link %s', url => {
    const doc = drawBoardObject(createBoardDocument(), 'link', bounds);
    expect(() => normalizeBoardDocument({ ...doc, objects: [{ ...doc.objects[0], url }] })).toThrow();
  });
  it.each([1, 2])('migrates schema %i only in memory', schemaVersion => {
    const old = { ...createBoardDocument(), schemaVersion };
    expect(normalizeBoardDocument(old).schemaVersion).toBe(3);
    expect(old.schemaVersion).toBe(schemaVersion);
  });
  it('exports the complete selected frame and enforces pixel budgets', () => {
    let doc = drawBoardObject(createBoardDocument(), 'sticky', bounds);
    doc = createFrame(doc, [doc.objects[0].id]);
    const frame = doc.objects.find(object => object.type === 'frame')!;
    const selected = pngExportDocument(doc, [frame.id]);
    expect(selected.objects).toHaveLength(2);
    expect(pngExportSize(selected, 2).width).toBe((frame.width + 64) * 2);
    expect(pngExportSize({ ...doc, objects: [{ ...frame, width: 10000, height: 10000 }] }, 1).valid).toBe(false);
    expect(pngExportSize(createBoardDocument(), 1).valid).toBe(false);
  });
});

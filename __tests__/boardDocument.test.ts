import { copyBoardFragment, parseBoardFragment, pasteBoardFragment } from '../services/boards/clipboard';
import { boardToFlow } from '../services/boards/reactFlowAdapter';
import { describe, expect, it } from 'vitest';
import { createBoardDocument, duplicateBoardDocument, normalizeBoardDocument, normalizeReferenceRemap, mergeReferenceRemaps } from '../services/boards/document.mjs';
import { boardWithAsset, boardWithTexts, boardRemap } from './helpers/boardFixtures';

describe('board document boundary', () => {
  it('round-trips the persistent schema and strips runtime fields recursively', () => {
    const board = boardWithAsset();
    const normalized = normalizeBoardDocument({ ...board, selected: true, objects: [{ ...board.objects[0], thumbnailUrl: 'blob:private', metadata: { secret: 'not persisted' } }] });
    expect(normalized).toEqual(board);
    expect(normalizeBoardDocument(JSON.parse(JSON.stringify(normalized)))).toEqual(board);
  });
  it('duplicates a document as a fresh revision while preserving local object IDs', () => {
    const board = boardWithTexts();
    const copy = duplicateBoardDocument(board);
    expect(copy.id).not.toBe(board.id);
    expect(copy.revision).toBe(0);
    expect(copy.objects).toEqual(board.objects);
  });
  it.each([
    ['unsupported version', (board) => ({ ...board, schemaVersion: 5 })],
    ['duplicate IDs', (board) => ({ ...board, objects: [board.objects[0], board.objects[0]] })],
    ['non-finite position', (board) => ({ ...board, objects: [{ ...board.objects[0], x: Infinity }] })],
    ['zero dimension', (board) => ({ ...board, objects: [{ ...board.objects[0], width: 0 }] })],
    ['missing frame', (board) => ({ ...board, objects: [{ ...board.objects[0], frameId: 'missing' }] })],
    ['incomplete stable reference', (board) => ({ ...board, objects: [{ ...board.objects[0], reference: { ...board.objects[0].reference, kind: 'stable', assetId: crypto.randomUUID() } }] })],
    ['escaping path', (board) => ({ ...board, objects: [{ ...board.objects[0], reference: { kind: 'path', locator: { ...board.objects[0].reference.locator, relativePath: '../outside.png' } } }] })],
    ['missing endpoint', (board) => ({ ...board, connections: [{ id: 'edge', type: 'manual', sourceObjectId: board.objects[0].id, targetObjectId: 'missing', sourceSide: 'right', targetSide: 'left', label: '', color: '#ffffff' }] })],
  ])('rejects %s', (_name, mutate) => expect(() => normalizeBoardDocument(mutate(boardWithAsset()))).toThrow());
  it('rejects frame nesting and frames pointing at themselves', () => {
    const board = createBoardDocument();
    expect(() => normalizeBoardDocument({ ...board, objects: [{ id: 'frame', type: 'frame', x: 0, y: 0, width: 300, height: 200, zIndex: 0, frameId: 'frame', title: '', color: '#ffffff' }] })).toThrow('Nested');
  });
  it('validates remaps, deduplicates retries and rejects operation ID reuse', () => {
    const remap = boardRemap('a.png', 'b.png');
    expect(mergeReferenceRemaps([remap], [remap])).toEqual([remap]);
    expect(() => mergeReferenceRemaps([remap], [{ ...remap, newLocator: boardRemap('a.png', 'c.png').newLocator }])).toThrow('already used');
    expect(() => normalizeReferenceRemap({ ...remap, stableReference: { assetId: 'incomplete' } })).toThrow();
  });
});

it('preserves text appearance and dashed lines through disk and clipboard', () => {
 const board = boardWithTexts();
 const styled = normalizeBoardDocument({...board,
  objects:board.objects.map(object => ({...object,fontFamily:'Segoe UI',backgroundColor:'#123456',textAlign:'center',backgroundRoundness:16})),
  connections:[{id:'edge',type:'manual',sourceObjectId:board.objects[0].id,targetObjectId:board.objects[1].id,sourceSide:'right',targetSide:'left',label:'',color:'#112233',width:3,lineStyle:'dashed'}],
 });
 const disk = normalizeBoardDocument(JSON.parse(JSON.stringify(styled)));
 expect(disk).toEqual(styled);
 const pasted = pasteBoardFragment(createBoardDocument(), parseBoardFragment(copyBoardFragment(disk, disk.objects.map(object => object.id)))!, {x:0,y:0}).document;
 expect(pasted.objects[0]).toMatchObject({fontFamily:'Segoe UI',backgroundColor:'#123456',textAlign:'center',backgroundRoundness:16});
 expect(pasted.connections[0]).toMatchObject({width:3,lineStyle:'dashed'});
 expect(boardToFlow(pasted, [], [], true).edges[0].data).toMatchObject({lineStyle:'dashed'});
});
it.each([{fontFamily:42},{fontFamily:''},{backgroundColor:'red'},{textAlign:'justify'},{backgroundRoundness:-1},{backgroundRoundness:101},{backgroundRoundness:NaN}])('rejects invalid text appearance %s', patch => {
 const board = boardWithTexts();
 expect(() => normalizeBoardDocument({...board,objects:[{...board.objects[0],...patch}]})).toThrow();
});
it('keeps old text defaults and rejects unsupported connection styles', () => {
 const board = boardWithTexts();
 expect(normalizeBoardDocument(board).objects[0]).not.toHaveProperty('fontFamily');
 expect(() => normalizeBoardDocument({...board,connections:[{id:'edge',type:'manual',sourceObjectId:board.objects[0].id,targetObjectId:board.objects[1].id,lineStyle:'dots'}]})).toThrow('line style');
});

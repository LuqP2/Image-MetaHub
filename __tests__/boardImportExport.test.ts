import { describe, expect, it } from 'vitest';
import { exportBoard, importBoard } from '../services/boards/importExport';
import { boardWithAsset } from './helpers/boardFixtures';

describe('board interchange', () => {
  it('imports as a separate document with references intact, stripping transient data', () => {
    const board = boardWithAsset();
    const text = exportBoard({ ...board, history: ['private'], objects: [{ ...board.objects[0], thumbnailUrl: 'blob:private' }] } as typeof board);
    const copy = importBoard(text);
    expect(copy.id).not.toBe(board.id);
    expect(copy.objects).toEqual(board.objects);
    expect(copy.revision).toBe(0);
    expect(text).not.toMatch(/private|thumbnailUrl|history/);
  });
  it.each(['not json', '{}', '{"format":"image-metahub-board","version":2}', '{"format":"image-metahub-board","version":1}'])('rejects invalid input %s', text => {
    expect(() => importBoard(text)).toThrow();
  });
});

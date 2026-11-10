import { describe, expect, it } from 'vitest';
import { boardBackground, boardGridColor } from '../services/boards/background';
import { pngExportDocument } from '../services/boards/pngExport';
import { boardWithTexts } from './helpers/boardFixtures';

describe('board background rendering and PNG export', () => {
  it('preserves the chosen color in selection exports and uses it unless transparent', () => {
    const board = { ...boardWithTexts(), backgroundColor: '#808080' };
    const selection = pngExportDocument(board, [board.objects[0].id]);
    expect(boardBackground(selection.backgroundColor)).toBe('#808080');
    expect(boardBackground(selection.backgroundColor, true)).toBe('transparent');
    expect(boardBackground(undefined)).toBe('rgb(var(--gray-950))');
  });
  it('keeps the dot grid visible on light and dark custom backgrounds', () => {
    expect(boardGridColor('#ffffff')).toBe('#00000030');
    expect(boardGridColor('#000000')).toBe('#ffffff35');
    expect(boardGridColor(null)).toBe('rgb(var(--gray-700) / .55)');
  });
});

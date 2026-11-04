import { expect, it } from 'vitest';
import { boardFontFamily } from '../services/boards/fontFamily';

it.each(['serif', 'sans-serif', 'monospace', 'system-ui', 'SERIF'])('preserves %s as an unquoted CSS generic family', family => {
  expect(boardFontFamily(family)).toBe(family);
});
it.each(['Segoe UI', 'Arial', 'Font, with comma', 'Font "quoted"'])('keeps installed family %s as one quoted name with fallback', family => {
  expect(boardFontFamily(family)).toBe(`${JSON.stringify(family)}, sans-serif`);
});
it('leaves the inherited font for legacy/default text', () => {
  expect(boardFontFamily()).toBeUndefined();
  expect(boardFontFamily('')).toBeUndefined();
});

import { describe, expect, it } from 'vitest';
import { dropMatchesNativeDragSource } from '../components/DirectoryList';

type DragSource = { directoryPath: string; relativePath: string; imageId?: string };

const source: DragSource = {
  directoryPath: 'D:/library',
  relativePath: 'renders/portrait.png',
  imageId: 'library::renders/portrait.png',
};

const makeDropEvent = (types: string[], files: Array<{ name: string; path?: string }>) => ({
  dataTransfer: { types, files },
}) as unknown as Parameters<typeof dropMatchesNativeDragSource>[0];

/** Stands in for the Electron bridge that resolves a dropped file's real path. */
const resolvePath = (file: File) => (file as unknown as { path?: string }).path ?? '';
/** Browser build, or a bridge that cannot resolve the path. */
const resolveNothing = () => '';

describe('native file drag source gating', () => {
  describe('with absolute paths available', () => {
    it('accepts the drop carrying the exact dragged file', () => {
      const event = makeDropEvent(['Files'], [{ name: 'portrait.png', path: 'D:\\library\\renders\\portrait.png' }]);
      expect(dropMatchesNativeDragSource(event, source, resolvePath)).toBe(true);
    });

    it('finds the dragged file among several dropped files', () => {
      const event = makeDropEvent(['Files'], [
        { name: 'other.png', path: 'D:\\downloads\\other.png' },
        { name: 'portrait.png', path: 'D:/library/renders/portrait.png' },
      ]);
      expect(dropMatchesNativeDragSource(event, source, resolvePath)).toBe(true);
    });

    // The regression this guards: a same-named file from somewhere else must not
    // be mistaken for the recorded drag while its 30s window is still open.
    it('rejects a same-named file from a different directory', () => {
      const event = makeDropEvent(['Files'], [{ name: 'portrait.png', path: 'C:\\Users\\me\\Downloads\\portrait.png' }]);
      expect(dropMatchesNativeDragSource(event, source, resolvePath)).toBe(false);
    });

    it('rejects an unrelated file', () => {
      const event = makeDropEvent(['Files'], [{ name: 'unrelated.png', path: 'D:\\library\\renders\\unrelated.png' }]);
      expect(dropMatchesNativeDragSource(event, source, resolvePath)).toBe(false);
    });
  });

  describe('without absolute paths', () => {
    it('falls back to the filename', () => {
      const event = makeDropEvent(['Files'], [{ name: 'portrait.png' }]);
      expect(dropMatchesNativeDragSource(event, source, resolveNothing)).toBe(true);
    });

    it('still rejects an unrelated filename', () => {
      const event = makeDropEvent(['Files'], [{ name: 'unrelated.png' }]);
      expect(dropMatchesNativeDragSource(event, source, resolveNothing)).toBe(false);
    });

    it('rejects a source without a usable filename', () => {
      const event = makeDropEvent(['Files'], [{ name: 'portrait.png' }]);
      expect(
        dropMatchesNativeDragSource(event, { directoryPath: 'D:/library', relativePath: '' }, resolveNothing)
      ).toBe(false);
    });
  });

  it('rejects drops without OS files', () => {
    expect(dropMatchesNativeDragSource(makeDropEvent(['text/plain'], []), source, resolvePath)).toBe(false);
    expect(dropMatchesNativeDragSource(makeDropEvent(['Files'], []), source, resolvePath)).toBe(false);
  });

  it('rejects when the path resolver throws', () => {
    const event = makeDropEvent(['Files'], [{ name: 'portrait.png' }]);
    const throwingResolver = () => { throw new Error('bridge unavailable'); };
    // No path resolved for any file, so it degrades to the filename check.
    expect(dropMatchesNativeDragSource(event, source, throwingResolver)).toBe(true);
  });
});

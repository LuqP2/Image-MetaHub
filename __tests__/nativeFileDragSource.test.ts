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
const resolveDroppedFilePath = (file: File) => (file as unknown as { path?: string }).path ?? '';
/** Browser build, or a bridge that cannot resolve the path. */
const resolveNothing = () => '';

const onWindows = { resolveDroppedFilePath, platform: 'Win32' };
const onLinux = { resolveDroppedFilePath, platform: 'Linux x86_64' };

describe('native file drag source gating', () => {
  describe('with absolute paths available', () => {
    it('accepts the drop carrying the exact dragged file', () => {
      const event = makeDropEvent(['Files'], [{ name: 'portrait.png', path: 'D:\\library\\renders\\portrait.png' }]);
      expect(dropMatchesNativeDragSource(event, source, onWindows)).toBe(true);
    });

    it('finds the dragged file among several dropped files', () => {
      const event = makeDropEvent(['Files'], [
        { name: 'other.png', path: 'D:\\downloads\\other.png' },
        { name: 'portrait.png', path: 'D:/library/renders/portrait.png' },
      ]);
      expect(dropMatchesNativeDragSource(event, source, onWindows)).toBe(true);
    });

    // The regression this guards: a same-named file from somewhere else must not
    // be mistaken for the recorded drag while its 30s window is still open.
    it('rejects a same-named file from a different directory', () => {
      const event = makeDropEvent(['Files'], [{ name: 'portrait.png', path: 'C:\\Users\\me\\Downloads\\portrait.png' }]);
      expect(dropMatchesNativeDragSource(event, source, onWindows)).toBe(false);
    });

    it('rejects an unrelated file', () => {
      const event = makeDropEvent(['Files'], [{ name: 'unrelated.png', path: 'D:\\library\\renders\\unrelated.png' }]);
      expect(dropMatchesNativeDragSource(event, source, onWindows)).toBe(false);
    });
  });

  describe('case sensitivity follows the platform', () => {
    const linuxSource: DragSource = { directoryPath: '/library/A', relativePath: 'render.png' };

    it('treats paths differing only by case as different files on Linux', () => {
      const event = makeDropEvent(['Files'], [{ name: 'render.png', path: '/library/a/render.png' }]);
      expect(dropMatchesNativeDragSource(event, linuxSource, onLinux)).toBe(false);
    });

    it('still matches the exact path on Linux', () => {
      const event = makeDropEvent(['Files'], [{ name: 'render.png', path: '/library/A/render.png' }]);
      expect(dropMatchesNativeDragSource(event, linuxSource, onLinux)).toBe(true);
    });

    it('ignores case on Windows, where the filesystem does', () => {
      const event = makeDropEvent(['Files'], [{ name: 'PORTRAIT.PNG', path: 'D:\\LIBRARY\\RENDERS\\PORTRAIT.PNG' }]);
      expect(dropMatchesNativeDragSource(event, source, onWindows)).toBe(true);
    });
  });

  describe('without absolute paths', () => {
    it('falls back to the filename', () => {
      const event = makeDropEvent(['Files'], [{ name: 'portrait.png' }]);
      expect(dropMatchesNativeDragSource(event, source, { resolveDroppedFilePath: resolveNothing })).toBe(true);
    });

    it('still rejects an unrelated filename', () => {
      const event = makeDropEvent(['Files'], [{ name: 'unrelated.png' }]);
      expect(dropMatchesNativeDragSource(event, source, { resolveDroppedFilePath: resolveNothing })).toBe(false);
    });

    it('rejects a source without a usable filename', () => {
      const event = makeDropEvent(['Files'], [{ name: 'portrait.png' }]);
      expect(
        dropMatchesNativeDragSource(
          event,
          { directoryPath: 'D:/library', relativePath: '' },
          { resolveDroppedFilePath: resolveNothing },
        )
      ).toBe(false);
    });
  });

  it('rejects drops without OS files', () => {
    expect(dropMatchesNativeDragSource(makeDropEvent(['text/plain'], []), source, onWindows)).toBe(false);
    expect(dropMatchesNativeDragSource(makeDropEvent(['Files'], []), source, onWindows)).toBe(false);
  });

  it('degrades to the filename check when the path resolver throws', () => {
    const event = makeDropEvent(['Files'], [{ name: 'portrait.png' }]);
    const throwingResolver = () => { throw new Error('bridge unavailable'); };
    expect(dropMatchesNativeDragSource(event, source, { resolveDroppedFilePath: throwingResolver })).toBe(true);
  });
});

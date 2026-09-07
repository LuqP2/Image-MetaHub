import { describe, expect, it } from 'vitest';
import { toRelativePath } from '../services/fileWatcher.mjs';
import { isRelativePathInsideRoot } from '../utils/pathContainment.mjs';

describe('path containment', () => {
  it('distinguishes valid dot-prefixed POSIX children from parent traversals', () => {
    expect(isRelativePathInsideRoot('..archive/image.png', 'linux')).toBe(true);
    expect(isRelativePathInsideRoot('.../image.png', 'linux')).toBe(true);
    expect(isRelativePathInsideRoot('', 'linux')).toBe(true);
    expect(isRelativePathInsideRoot('..', 'linux')).toBe(false);
    expect(isRelativePathInsideRoot('../image.png', 'linux')).toBe(false);
    expect(isRelativePathInsideRoot('/outside/image.png', 'linux')).toBe(false);
  });

  it('distinguishes valid dot-prefixed Windows children from parent traversals', () => {
    expect(isRelativePathInsideRoot('..archive\\image.png', 'win32')).toBe(true);
    expect(isRelativePathInsideRoot('...\\image.png', 'win32')).toBe(true);
    expect(isRelativePathInsideRoot('', 'win32')).toBe(true);
    expect(isRelativePathInsideRoot('..', 'win32')).toBe(false);
    expect(isRelativePathInsideRoot('..\\image.png', 'win32')).toBe(false);
    expect(isRelativePathInsideRoot('../image.png', 'win32')).toBe(false);
    expect(isRelativePathInsideRoot('D:\\outside\\image.png', 'win32')).toBe(false);
    expect(isRelativePathInsideRoot('\\\\server\\share\\image.png', 'win32')).toBe(false);
  });

  it('preserves watcher-relative dot-prefixed children on POSIX and Windows', () => {
    expect(toRelativePath('/library', '/library/..archive/image.png', 'linux'))
      .toBe('..archive/image.png');
    expect(toRelativePath('/library', '/library/.../image.png', 'linux'))
      .toBe('.../image.png');
    expect(toRelativePath('/library', '/outside/image.png', 'linux')).toBe('image.png');

    expect(toRelativePath('C:\\library', 'C:\\library\\..archive\\image.png', 'win32'))
      .toBe('..archive/image.png');
    expect(toRelativePath('C:\\library', 'C:\\library\\...\\image.png', 'win32'))
      .toBe('.../image.png');
    expect(toRelativePath('C:\\library', 'D:\\outside\\image.png', 'win32')).toBe('image.png');
  });
});

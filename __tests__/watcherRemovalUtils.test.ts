import { describe, expect, it } from 'vitest';
import type { Directory, IndexedImage } from '../types';
import { resolveWatchedRemovalIdsForDirectory } from '../utils/watcherRemovalUtils';

const directory: Directory = {
  id: 'dir-1',
  name: 'Library',
  path: 'D:/library',
  handle: {} as FileSystemDirectoryHandle,
  visible: true,
};

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: `dir-1::${overrides.name ?? 'image.png'}`,
  name: overrides.name ?? 'image.png',
  handle: {} as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
  directoryId: 'dir-1',
  ...overrides,
});

describe('resolveWatchedRemovalIdsForDirectory', () => {
  it('matches removed nested files using the image relative path from the id', () => {
    const nested = createImage({
      id: 'dir-1::subdir/foo.png',
      name: 'foo.png',
    });
    const sibling = createImage({
      id: 'dir-1::other/bar.png',
      name: 'bar.png',
    });

    const result = resolveWatchedRemovalIdsForDirectory(
      directory,
      {
        files: [{ name: 'foo.png', relativePath: 'subdir/foo.png' }],
      },
      [nested, sibling],
    );

    expect(result.removedIds).toEqual(['dir-1::subdir/foo.png']);
    expect(result.removedNames).toContain('subdir/foo.png');
  });

  it('matches removed folders against nested images using relative paths', () => {
    const nested = createImage({
      id: 'dir-1::subdir/foo.png',
      name: 'foo.png',
    });
    const root = createImage({
      id: 'dir-1::top.png',
      name: 'top.png',
    });

    const result = resolveWatchedRemovalIdsForDirectory(
      directory,
      {
        folders: [{ relativePath: 'subdir' }],
      },
      [nested, root],
    );

    expect(result.removedIds).toEqual(['dir-1::subdir/foo.png']);
    expect(result.removedNames).toContain('subdir');
  });
});

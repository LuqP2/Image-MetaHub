import { describe, expect, it } from 'vitest';

import { buildDetachedViewerLoadTarget } from '../utils/detachedViewerUrl.mjs';
import { resolveNavigationAfterDeletion } from '../utils/viewerNavigation';

describe('detached viewer hotfix helpers', () => {
  it('loads packaged macOS paths with spaces and Unicode through loadFile', () => {
    const indexPath = '/Applications/Image MetaHub á.app/Contents/Resources/app.asar/dist/index.html';
    const target = buildDetachedViewerLoadTarget(indexPath, 'session 1');

    expect(target).toEqual({
      method: 'file',
      filePath: indexPath,
      options: {
        query: {
          window: 'image-modal',
          sessionId: 'session 1',
        },
      },
    });
  });

  it('keeps loadURL for the development server', () => {
    const target = buildDetachedViewerLoadTarget('/unused/index.html', 'session 1', true);

    expect(target.method).toBe('url');
    expect(new URL(target.url).origin).toBe('http://localhost:5173');
    expect(new URL(target.url).searchParams.get('window')).toBe('image-modal');
    expect(new URL(target.url).searchParams.get('sessionId')).toBe('session 1');
  });

  it('keeps the next item, then falls back to the previous item', () => {
    expect(resolveNavigationAfterDeletion(['a', 'b', 'c'], 'b')).toEqual({
      navigationImageIds: ['a', 'c'],
      nextImageId: 'c',
    });
    expect(resolveNavigationAfterDeletion(['a', 'b', 'c'], 'c')).toEqual({
      navigationImageIds: ['a', 'b'],
      nextImageId: 'b',
    });
  });

  it('closes only when no navigation item remains', () => {
    expect(resolveNavigationAfterDeletion(['a'], 'a')).toEqual({
      navigationImageIds: [],
      nextImageId: null,
    });
  });

  it('falls back to the stored playlist when the current scope omits the deleted item', () => {
    expect(resolveNavigationAfterDeletion(['c'], 'b', ['a', 'b', 'c'])).toEqual({
      navigationImageIds: ['a', 'c'],
      nextImageId: 'c',
    });
  });
});

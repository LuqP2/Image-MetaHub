import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';

import { buildDetachedViewerUrl } from '../utils/detachedViewerUrl.mjs';
import { resolveNavigationAfterDeletion } from '../utils/viewerNavigation';

describe('detached viewer hotfix helpers', () => {
  it('builds a file URL for packaged macOS paths with spaces and Unicode', () => {
    const indexPath = '/Applications/Image MetaHub á.app/Contents/Resources/app.asar/dist/index.html';
    const url = buildDetachedViewerUrl(indexPath, 'session 1');

    expect(url.protocol).toBe('file:');
    expect(fileURLToPath(url)).toBe(indexPath);
    expect(url.searchParams.get('window')).toBe('image-modal');
    expect(url.searchParams.get('sessionId')).toBe('session 1');
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

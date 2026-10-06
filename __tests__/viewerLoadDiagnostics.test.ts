import { describe, expect, it } from 'vitest';
import { getViewerLoadErrorDetails } from '../utils/viewerLoadDiagnostics.mjs';

describe('viewer load diagnostics', () => {
  it('keeps Electron failure identity but omits the URL and library path', () => {
    const error = Object.assign(new Error("ERR_ABORTED (-3) loading 'file:///Applications/Test.app/index.html?sessionId=/private/library/image.png'"), {
      code: 'ERR_ABORTED', errno: -3, url: 'file:///private/library/image.png',
    });
    expect(getViewerLoadErrorDetails(error)).toEqual({
      errorCode: 'ERR_ABORTED', errorNumber: -3, errorName: 'Error',
    });
  });

  it('extracts a formatted Electron error when structured fields are absent', () => {
    expect(getViewerLoadErrorDetails(new Error("ERR_FILE_NOT_FOUND (-6) loading 'file:///private/path'")))
      .toEqual({ errorName: 'Error', errorCode: 'ERR_FILE_NOT_FOUND', errorNumber: -6 });
  });

  it('does not persist arbitrary error text or unsafe properties', () => {
    expect(getViewerLoadErrorDetails({ name: '/private/path', code: '/private/path', errno: 'private', message: 'Private image name' })).toEqual({});
    expect(getViewerLoadErrorDetails(null)).toEqual({});
  });
});

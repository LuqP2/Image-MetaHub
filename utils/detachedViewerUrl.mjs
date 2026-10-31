import { pathToFileURL } from 'url';

export function buildDetachedViewerUrl(indexPath, sessionId, isDev = false, windowKind = 'image-modal') {
  const url = isDev
    ? new URL('http://localhost:5173')
    : pathToFileURL(indexPath);
  url.searchParams.set('window', windowKind);
  url.searchParams.set('sessionId', sessionId);
  return url;
}

export function buildDetachedViewerLoadTarget(indexPath, sessionId, isDev = false, windowKind = 'image-modal') {
  const query = {
    window: windowKind,
    sessionId,
  };

  if (isDev) {
    return {
      method: 'url',
      url: buildDetachedViewerUrl(indexPath, sessionId, true, windowKind).toString(),
    };
  }

  return {
    method: 'file',
    filePath: indexPath,
    options: { query },
  };
}

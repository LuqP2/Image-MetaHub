import { pathToFileURL } from 'url';

export function buildDetachedViewerUrl(indexPath, sessionId, isDev = false) {
  const url = isDev
    ? new URL('http://localhost:5173')
    : pathToFileURL(indexPath);
  url.searchParams.set('window', 'image-modal');
  url.searchParams.set('sessionId', sessionId);
  return url;
}

export function buildDetachedViewerLoadTarget(indexPath, sessionId, isDev = false) {
  const query = {
    window: 'image-modal',
    sessionId,
  };

  if (isDev) {
    return {
      method: 'url',
      url: buildDetachedViewerUrl(indexPath, sessionId, true).toString(),
    };
  }

  return {
    method: 'file',
    filePath: indexPath,
    options: { query },
  };
}

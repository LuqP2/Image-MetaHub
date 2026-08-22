import { pathToFileURL } from 'url';

export function buildDetachedViewerUrl(indexPath, sessionId, isDev = false) {
  const url = isDev
    ? new URL('http://localhost:5173')
    : pathToFileURL(indexPath);
  url.searchParams.set('window', 'image-modal');
  url.searchParams.set('sessionId', sessionId);
  return url;
}

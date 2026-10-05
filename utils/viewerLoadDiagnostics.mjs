/** Keep Electron's failure identity without its URL, session ID or local paths. */
export function getViewerLoadErrorDetails(error) {
  const details = {};
  const code = typeof error?.code === 'string' && /^ERR_[A-Z0-9_]+$/.test(error.code)
    ? error.code : undefined;
  if (code) details.errorCode = code;
  if (Number.isInteger(error?.errno)) details.errorNumber = error.errno;
  if (['Error', 'TypeError', 'RangeError', 'SyntaxError'].includes(error?.name)) {
    details.errorName = error.name;
  }
  // Some Electron errors expose only the formatted message. Never persist it:
  // the trailing loading URL can contain the library path in the session ID.
  const formatted = typeof error?.message === 'string'
    ? /^(ERR_[A-Z0-9_]+) \((-?\d+)\) loading /.exec(error.message) : null;
  if (formatted) {
    details.errorCode ??= formatted[1];
    details.errorNumber ??= Number(formatted[2]);
  }
  return details;
}

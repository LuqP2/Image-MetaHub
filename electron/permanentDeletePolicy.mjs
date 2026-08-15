const DEFAULT_GRANT_TTL_MS = 5 * 60 * 1000;

export const createPermanentDeleteGrantStore = ({
  now = () => Date.now(),
  createToken,
  ttlMs = DEFAULT_GRANT_TTL_MS,
} = {}) => {
  const grants = new Map();

  const read = (tokens, webContentsId, consume) => {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      throw new Error('No permanent-delete grants were provided');
    }
    const uniqueTokens = [...new Set(tokens)];
    const resolved = uniqueTokens.map((token) => {
      const grant = grants.get(token);
      if (!grant || grant.webContentsId !== webContentsId || grant.expiresAt < now()) {
        grants.delete(token);
        throw new Error('Permanent-delete authorization is invalid or expired');
      }
      return { token, ...grant };
    });
    if (consume) uniqueTokens.forEach((token) => grants.delete(token));
    return resolved;
  };

  return {
    issue(webContentsId, requestedPath, targetFiles, primaryDeleted = false) {
      if (!Number.isInteger(webContentsId) || !Array.isArray(targetFiles) || targetFiles.length === 0) {
        throw new Error('Invalid permanent-delete grant scope');
      }
      const token = createToken();
      grants.set(token, {
        webContentsId,
        requestedPath,
        targetFiles: targetFiles.map((target) => ({ ...target })),
        primaryDeleted,
        expiresAt: now() + ttlMs,
      });
      return token;
    },
    inspect(tokens, webContentsId) {
      return read(tokens, webContentsId, false);
    },
    consume(tokens, webContentsId) {
      return read(tokens, webContentsId, true);
    },
  };
};

export const requestPermanentDeleteConfirmation = async (
  showMessageBox,
  { itemCount, fileCount, scopeLabel },
) => {
  const offered = await showMessageBox({
    type: 'warning',
    title: 'Could not move to Recycle Bin',
    message: itemCount === 1
      ? 'This item could not be moved to the Recycle Bin.'
      : `${itemCount} selected items could not be moved to the Recycle Bin.`,
    detail: `The remaining files were preserved. You can cancel or choose Delete permanently. Permanent deletion cannot be undone.\n\nScope: ${scopeLabel}`,
    buttons: ['Delete permanently', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (offered.response !== 0) return false;

  const confirmed = await showMessageBox({
    type: 'warning',
    title: 'Confirm permanent deletion',
    message: itemCount === 1
      ? 'Permanently delete this item?'
      : `Permanently delete ${itemCount} selected items?`,
    detail: `This will permanently delete ${fileCount} file${fileCount === 1 ? '' : 's'} and cannot be undone.\n\nScope: ${scopeLabel}`,
    buttons: ['Confirm permanent deletion', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return confirmed.response === 0;
};

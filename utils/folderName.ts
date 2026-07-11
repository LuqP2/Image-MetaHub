// Shared validation for user-supplied folder names (e.g. "Create New Folder" in
// the Move/Copy To panel). Kept as a pure helper so it can be unit-tested and
// reused by both the renderer (pre-flight UX) and mirrored by the main process
// (defense in depth before touching the filesystem).

// Windows reserved device names (case-insensitive), which cannot be used as
// file/folder names even with an extension.
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

// Characters that are illegal in a single path segment on Windows (a superset of
// what POSIX forbids, so validating against it keeps names portable). Spaces and
// hyphens are allowed; control characters, path separators, and Windows-reserved
// punctuation are not.
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHARS = new RegExp('[<>:"/\\\\|?*\\x00-\\x1f]');

export interface FolderNameValidationResult {
  ok: boolean;
  /** Trimmed, filesystem-safe name. Only present when ok is true. */
  value?: string;
  error?: string;
}

/**
 * Validate a single folder-name segment supplied by the user. Rejects empty
 * names, path separators, traversal (`..`), illegal characters, trailing dots/
 * spaces (which Windows silently strips, causing surprises), and reserved
 * device names. Returns the trimmed name on success.
 */
export function validateFolderName(rawName: string): FolderNameValidationResult {
  const name = (rawName ?? '').trim();

  if (!name) {
    return { ok: false, error: 'Folder name cannot be empty.' };
  }

  if (name === '.' || name === '..') {
    return { ok: false, error: 'Folder name is not valid.' };
  }

  if (ILLEGAL_CHARS.test(name)) {
    return { ok: false, error: 'Folder name contains invalid characters.' };
  }

  // Windows strips trailing dots and spaces, so "foo." would become "foo" —
  // reject to avoid a mismatch between what the user typed and what is created.
  if (/[. ]$/.test(name)) {
    return { ok: false, error: 'Folder name cannot end with a space or period.' };
  }

  if (RESERVED_NAMES.has(name.toLowerCase())) {
    return { ok: false, error: 'That folder name is reserved by the system.' };
  }

  if (name.length > 255) {
    return { ok: false, error: 'Folder name is too long.' };
  }

  return { ok: true, value: name };
}

import { describe, expect, it } from 'vitest';
import { validateFolderName } from '../utils/folderName';

describe('validateFolderName', () => {
  it('accepts ordinary names, including spaces and hyphens', () => {
    for (const name of ['renders', 'My Folder', 'text-to-image', 'v2_final', 'SDXL 1.0']) {
      const result = validateFolderName(name);
      expect(result.ok, name).toBe(true);
      expect(result.value).toBe(name);
    }
  });

  it('trims surrounding whitespace', () => {
    const result = validateFolderName('  keepers  ');
    expect(result.ok).toBe(true);
    expect(result.value).toBe('keepers');
  });

  it('rejects empty or whitespace-only names', () => {
    expect(validateFolderName('').ok).toBe(false);
    expect(validateFolderName('   ').ok).toBe(false);
  });

  it('rejects path separators and traversal', () => {
    for (const name of ['a/b', 'a\\b', '..', '.', '../escape', 'nested/deep']) {
      expect(validateFolderName(name).ok, name).toBe(false);
    }
  });

  it('rejects Windows-illegal punctuation and control chars', () => {
    for (const name of ['a<b', 'a>b', 'a:b', 'a"b', 'a|b', 'a?b', 'a*b', 'tab\there']) {
      expect(validateFolderName(name).ok, name).toBe(false);
    }
  });

  it('rejects a trailing dot (silently stripped by Windows)', () => {
    expect(validateFolderName('folder.').ok).toBe(false);
    expect(validateFolderName('a.b.c.').ok).toBe(false);
    // A trailing space is removed by the leading trim, so it is not itself a failure.
    expect(validateFolderName('folder ').value).toBe('folder');
  });

  it('rejects reserved device names case-insensitively', () => {
    for (const name of ['CON', 'con', 'PRN', 'nul', 'COM1', 'lpt9']) {
      expect(validateFolderName(name).ok, name).toBe(false);
    }
  });

  it('allows reserved-like names with extra characters', () => {
    expect(validateFolderName('console').ok).toBe(true);
    expect(validateFolderName('com10').ok).toBe(true);
  });
});

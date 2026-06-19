import { describe, expect, it } from 'vitest';
import {
  areFilesystemPathsEqual,
  isFilesystemPathWithinDirectory,
  normalizeFilesystemPath,
} from '../utils/filesystemPath';

describe('areFilesystemPathsEqual', () => {
  it('compares Windows drive paths without case sensitivity', () => {
    expect(areFilesystemPathsEqual('D:\\ComfyUI\\Output', 'd:/comfyui/output/', 'Win32')).toBe(true);
  });

  it('compares Windows UNC paths without case sensitivity', () => {
    expect(areFilesystemPathsEqual('\\\\Server\\Share\\Output', '//server/share/output', 'Win32')).toBe(true);
  });

  it('preserves case sensitivity for POSIX paths', () => {
    expect(areFilesystemPathsEqual('/data/Out', '/data/out', 'Linux x86_64')).toBe(false);
  });

  it('matches files beneath loaded directories using platform path semantics', () => {
    expect(isFilesystemPathWithinDirectory('D:/Images/run/a.png', 'd:\\images', 'Win32')).toBe(true);
    expect(isFilesystemPathWithinDirectory('/data/out/a.png', '/data/Out', 'Linux')).toBe(false);
    expect(isFilesystemPathWithinDirectory('/data/out/a.png', '/data/out', 'Linux')).toBe(true);
  });

  it('preserves filesystem roots while normalizing paths', () => {
    expect(normalizeFilesystemPath('/')).toBe('/');
    expect(normalizeFilesystemPath('C:/')).toBe('C:/');
  });
});

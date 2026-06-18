import { describe, expect, it } from 'vitest';
import { areFilesystemPathsEqual } from '../utils/filesystemPath';

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
});

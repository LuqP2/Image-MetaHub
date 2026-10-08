import { describe, expect, it } from 'vitest';
import { confirmedCopies, duplicateCandidates, storageSummary, storageUsage } from '../services/modelLibrary/storage';
import type { ModelManagerSnapshot, ModelStorageFile } from '../services/modelLibrary/types';
import { isModelLibraryPathWithinRoots, normalizeModelLibraryPath } from '../electron/modelLibrarySecurity.mjs';

const file = (key: string, sha256?: string, physicalId?: string): ModelStorageFile => ({ key, path: `/synthetic/${key}.safetensors`, locationIds: [key], size: 100, modifiedAt: 1, sha256, physicalId, stale: false });
const a = 'a'.repeat(64);
describe('Storage accounting', () => {
  it('counts logical models, file paths and hardlinked physical storage separately', () => {
    const files = [file('one', a, 'disk:1'), file('link', a, 'disk:1'), file('copy', a, 'disk:2'), file('unknown')];
    files[0].locationIds.push('overlap');
    expect(storageSummary(files)).toEqual({ totalBytes: 300, modelCount: 2, fileCount: 3, pathCount: 4 });
    expect(confirmedCopies(files[0], files)).toBe(2);
  });
  it('never confirms a duplicate by name or size and excludes stale hashes', () => {
    const files = [file('one'), file('two'), { ...file('stale', a), stale: true }, file('verified', a)];
    expect(confirmedCopies(files[0], files)).toBe(1);
    expect(confirmedCopies(files[3], files)).toBe(1);
    expect(duplicateCandidates(files).map((entry) => entry.key)).toEqual(['one', 'two', 'verified']);
  });
  it('does not hash hardlinks as duplicate candidates unless another physical copy exists', () => {
    const files = [file('one', undefined, 'disk:1'), file('link', undefined, 'disk:1')];
    expect(duplicateCandidates(files)).toEqual([]);
    expect(duplicateCandidates([...files, file('other', undefined, 'disk:2')])).toHaveLength(2);
  });
  it('reuses the logical model usage and withholds stale usage', () => {
    const manager = { catalog: { locations: [{ id: 'one' }] }, usage: { [`sha256:${a}`]: { status: 'ready', totalCount: 10 } } } as unknown as ModelManagerSnapshot;
    expect(storageUsage(file('one', a), manager)).toEqual({ status: 'ready', totalCount: 10 });
    expect(storageUsage({ ...file('one', a), stale: true }, manager)).toBeUndefined();
  });
  it('handles Windows path case and rejects adjacent roots and Linux case changes', () => {
    expect(normalizeModelLibraryPath('C:\\Models\\Sub\\..\\one.safetensors', 'win32')).toBe('c:\\models\\one.safetensors');
    expect(isModelLibraryPathWithinRoots('C:\\MODELS\\one.safetensors', ['c:\\models'], 'win32')).toBe(true);
    expect(isModelLibraryPathWithinRoots('C:\\Models-other\\one.safetensors', ['c:\\models'], 'win32')).toBe(false);
    expect(isModelLibraryPathWithinRoots('/Models/one.safetensors', ['/models'], 'linux')).toBe(false);
    expect(isModelLibraryPathWithinRoots('/models/../escape.safetensors', ['/models'], 'linux')).toBe(false);
  });
});

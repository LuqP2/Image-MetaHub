import { describe, expect, it, vi } from 'vitest';
const disk = vi.hoisted(() => ({ readdir: vi.fn(), stat: vi.fn(), rm: vi.fn(), unlink: vi.fn() }));
vi.mock('node:fs/promises', () => ({ default: disk }));
import { resetUserDataContents } from '../electron/cacheReset.mjs';

describe('model manager user data preservation', () => {
  it('clears derived caches while preserving model covers, notes and monitoring state', async () => {
    disk.readdir.mockResolvedValue(['model-manager-user-data', 'json_cache', 'thumbnails']);
    disk.stat.mockResolvedValue({ isDirectory: () => true });
    disk.rm.mockResolvedValue(undefined);
    await resetUserDataContents({ userDataDir: 'D:\\synthetic-user-data' });
    expect(disk.stat.mock.calls.flat().some((path) => String(path).includes('model-manager-user-data'))).toBe(false);
    expect(disk.rm).toHaveBeenCalledTimes(2);
  });
});

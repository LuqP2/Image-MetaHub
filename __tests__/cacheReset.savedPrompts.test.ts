import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetAllCaches } from '../utils/cacheReset';
import { SAVED_PROMPTS_DATABASE_NAME } from '../services/savedPromptStorage';

describe('resetAllCaches saved prompts preservation', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not delete the dedicated browser prompt database', async () => {
    vi.useFakeTimers();
    const deleted: string[] = [];
    const deleteDatabase = vi.fn((name: string) => {
      deleted.push(name);
      const request: Record<string, unknown> = {};
      queueMicrotask(() => (request.onsuccess as (() => void) | undefined)?.());
      return request;
    });
    vi.stubGlobal('indexedDB', {
      databases: vi.fn().mockResolvedValue([
        { name: 'image-metahub-preferences' },
        { name: SAVED_PROMPTS_DATABASE_NAME },
      ]),
      deleteDatabase,
    });
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });

    await resetAllCaches();

    expect(deleted).toEqual(['image-metahub-preferences']);
    expect(deleted).not.toContain(SAVED_PROMPTS_DATABASE_NAME);
  });
});

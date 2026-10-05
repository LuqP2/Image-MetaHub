import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeIndexedDb } from './helpers/fakeIndexedDb';

describe('browser saved prompt storage', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeIndexedDb();
  });

  it('preserves literal text, stores no durable browser source, and removes idempotently', async () => {
    const storage = await import('../services/savedPromptStorage');
    const input = {
      positivePrompt: '  Literal\nPrompt  ',
      negativePrompt: '',
      textBasis: 'original' as const,
      sourceCreatedAt: 1_700_000_000_000,
      source: {
        kind: 'path' as const,
        pathAtSave: {
          directoryPath: 'D:/synthetic',
          relativePath: 'image.png',
          fileSize: 12,
          contentModifiedMs: 34,
        },
      },
    };

    const saved = await storage.saveBrowserPrompt(input);
    expect(saved).toMatchObject({
      status: 'saved',
      prompt: {
        positivePrompt: input.positivePrompt,
        negativePrompt: '',
        textBasis: 'original',
        sourceCreatedAt: 1_700_000_000_000,
        source: null,
      },
    });
    await expect(storage.listBrowserSavedPrompts()).resolves.toEqual([saved.prompt]);
    await expect(storage.removeBrowserSavedPrompt(saved.prompt.id)).resolves.toEqual({ id: saved.prompt.id, removed: true });
    await expect(storage.removeBrowserSavedPrompt(saved.prompt.id)).resolves.toEqual({ id: saved.prompt.id, removed: false });
  });

  it('serializes concurrent exact saves while keeping distinct whitespace', async () => {
    const storage = await import('../services/savedPromptStorage');
    const input = {
      positivePrompt: 'same', negativePrompt: 'pair', textBasis: 'effective' as const, source: null, sourceCreatedAt: 100,
    };
    const results = await Promise.all([
      storage.saveBrowserPrompt(input),
      storage.saveBrowserPrompt(input),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['already-saved', 'saved']);
    expect(new Set(results.map((result) => result.prompt.id)).size).toBe(1);
    expect(results.every((result) => result.prompt.sourceCreatedAt === 100)).toBe(true);

    const whitespace = await storage.saveBrowserPrompt({ ...input, positivePrompt: 'same ' });
    expect(whitespace.status).toBe('saved');
    await expect(storage.listBrowserSavedPrompts()).resolves.toHaveLength(2);
  });
});

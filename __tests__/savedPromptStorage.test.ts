import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeIndexedDb } from './helpers/fakeIndexedDb';
import { normalizeEditor } from '../services/promptLibrary/core.mjs';

describe('browser saved prompt storage', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeIndexedDb({ completionAtTaskEnd: true });
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

  it('persists negative-only saves, deduplicates them, and rejects empty pairs', async () => {
    const storage = await import('../services/savedPromptStorage');
    const input = {
      positivePrompt: '', negativePrompt: '  Negative\nonly  ',
      textBasis: 'effective' as const, source: null, sourceCreatedAt: 100,
      editor: normalizeEditor({ metadata: { model: 'synthetic-model' } }),
    };
    const saved = await storage.saveBrowserPrompt(input);
    expect(saved).toMatchObject({ status: 'saved', prompt: input });
    await expect(storage.saveBrowserPrompt(input)).resolves.toEqual({ status: 'already-saved', prompt: saved.prompt });
    await expect(storage.saveBrowserPrompt({ ...input, positivePrompt: ' \n', negativePrompt: '\t' }))
      .rejects.toThrow('A non-empty prompt is required.');
    await expect(storage.listBrowserSavedPrompts()).resolves.toEqual([saved.prompt]);
  });

  it('stores blocks and negative-only prompts without desktop links and rejects stale revisions', async () => {
    const storage = await import('../services/savedPromptStorage');
    const first = await storage.browserPromptLibrary({ action: 'create', kind: 'block', item: { text: 'literal block' } });
    const block = first.blocks[0];
    const second = await storage.browserPromptLibrary({ action: 'create', kind: 'prompt', item: { negativePrompt: 'negative only' } });
    expect(second.prompts[0]).toMatchObject({ positivePrompt: '', negativePrompt: 'negative only', source: null });
    await storage.browserPromptLibrary({ action: 'update', kind: 'block', expectedRevision: 1, item: { ...block, text: 'changed' } });
    await expect(storage.browserPromptLibrary({ action: 'update', kind: 'block', expectedRevision: 1, item: block })).rejects.toThrow('another window');
    expect((await storage.browserPromptLibrary()).blocks[0]).toMatchObject({ text: 'changed', revision: 2 });
  });
});

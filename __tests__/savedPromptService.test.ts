import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'electronAPI', { value: undefined, configurable: true, writable: true });
});

describe('saved prompt service environment selection', () => {
  it('does not fall back to IndexedDB when the desktop API is unavailable', async () => {
    Object.defineProperty(window, 'electronAPI', { value: {}, configurable: true, writable: true });
    const open = vi.spyOn(indexedDB, 'open');
    const service = await import('../services/savedPromptService');
    const input = { positivePrompt: 'desktop', negativePrompt: '', textBasis: 'effective' as const, source: null };

    await expect(service.listSavedPrompts()).rejects.toThrow('desktop storage is unavailable');
    await expect(service.savePrompt(input)).rejects.toThrow('desktop storage is unavailable');
    await expect(service.removeSavedPrompt(crypto.randomUUID())).rejects.toThrow('desktop storage is unavailable');
    await expect(service.resolveSavedPromptSource(crypto.randomUUID())).rejects.toThrow('desktop storage is unavailable');
    expect(open).not.toHaveBeenCalled();
  });

  it('surfaces a desktop IPC failure without opening browser storage', async () => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        savedPromptsList: vi.fn().mockResolvedValue({ success: false, error: 'catalog unavailable' }),
      },
      configurable: true,
      writable: true,
    });
    const open = vi.spyOn(indexedDB, 'open');
    const service = await import('../services/savedPromptService');

    await expect(service.listSavedPrompts()).rejects.toThrow('catalog unavailable');
    expect(open).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Auto-Tag worker single-image mode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('builds the model from the library but returns tags only for the requested image', async () => {
    const posted: Array<{ type: string; payload: any }> = [];
    const workerScope = { postMessage: (message: { type: string; payload: any }) => posted.push(message) };
    vi.stubGlobal('self', workerScope);
    await import('../services/workers/autoTaggingWorker');

    await (workerScope as typeof workerScope & { onmessage: (event: MessageEvent) => Promise<void> }).onmessage({
      data: {
        type: 'start',
        payload: {
          images: [
            { id: 'one', prompt: 'pine forest' },
            { id: 'two', prompt: 'pine forest, mountain trail' },
          ],
          targetImageId: 'one',
        },
      },
    } as MessageEvent);

    const complete = posted.find(message => message.type === 'complete');
    expect(complete?.payload.tfidfModel.documentCount).toBe(2);
    expect(Object.keys(complete?.payload.autoTags ?? {})).toEqual(['one']);
    expect(complete?.payload.autoTags.one[0].tag).toBe('pine forest');
  });

  it('reports no alternatives without replacing the current tags', async () => {
    const posted: Array<{ type: string; payload: any }> = [];
    const workerScope = { postMessage: (message: { type: string; payload: any }) => posted.push(message) };
    vi.stubGlobal('self', workerScope);
    await import('../services/workers/autoTaggingWorker');

    await (workerScope as typeof workerScope & { onmessage: (event: MessageEvent) => Promise<void> }).onmessage({
      data: {
        type: 'start',
        payload: {
          images: [{ id: 'one', prompt: 'pine forest' }],
          targetImageId: 'one',
          excludeTags: ['pine forest'],
        },
      },
    } as MessageEvent);

    expect(posted.find(message => message.type === 'complete')).toBeUndefined();
    expect(posted.find(message => message.type === 'error')?.payload.error).toMatch(/No other descriptive tags/);
  });
});

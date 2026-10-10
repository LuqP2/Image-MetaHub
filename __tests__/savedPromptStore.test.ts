import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { initializeSavedPromptSynchronization, useSavedPromptStore } from '../store/useSavedPromptStore';

const serviceMocks = vi.hoisted(() => ({
  list: vi.fn(),
  subscribe: vi.fn(),
  library: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock('../services/savedPromptService', () => ({
  listSavedPrompts: serviceMocks.list,
  listPromptLibrary: serviceMocks.library,
  mutatePromptLibrary: serviceMocks.mutate,
  removeSavedPrompt: vi.fn(),
  savePrompt: vi.fn(),
  subscribeSavedPromptChanges: serviceMocks.subscribe,
}));

describe('saved prompt store bootstrap', () => {
  afterEach(() => {
    useSavedPromptStore.setState({ prompts: [], isLoading: false, error: null, selectedPromptId: null });
    vi.restoreAllMocks();
  });

  it('loads persisted prompts and owns the change subscription independently of Prompt Library', async () => {
    const unsubscribe = vi.fn();
    serviceMocks.subscribe.mockReturnValue(unsubscribe);
    serviceMocks.list.mockResolvedValue([{
      id: '00000000-0000-4000-8000-000000000001',
      createdAt: 10,
      sourceCreatedAt: null,
      positivePrompt: 'persisted prompt',
      negativePrompt: '',
      textBasis: 'effective',
      source: null,
    }]);

    const stop = initializeSavedPromptSynchronization();
    await waitFor(() => expect(useSavedPromptStore.getState().prompts).toEqual([
      expect.objectContaining({ positivePrompt: 'persisted prompt' }),
    ]));
    expect(serviceMocks.subscribe).toHaveBeenCalledTimes(1);

    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale load completing after a mutation', async () => {
    let finish: (value: { prompts: never[]; blocks: never[] }) => void;
    serviceMocks.library.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    serviceMocks.mutate.mockResolvedValueOnce({ prompts: [], blocks: [{ id: 'block', text: 'new' }], selectedId: 'block' });
    const read = useSavedPromptStore.getState().loadLibrary();
    await useSavedPromptStore.getState().mutate({ action: 'create', kind: 'block', item: { text: 'new' } });
    finish!({ prompts: [], blocks: [] }); await read;
    expect(useSavedPromptStore.getState().blocks).toMatchObject([{ id: 'block', text: 'new' }]);
  });
});

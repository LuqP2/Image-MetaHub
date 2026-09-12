import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { initializeSavedPromptSynchronization, useSavedPromptStore } from '../store/useSavedPromptStore';

const serviceMocks = vi.hoisted(() => ({
  list: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock('../services/savedPromptService', () => ({
  listSavedPrompts: serviceMocks.list,
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
});

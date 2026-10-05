import { create } from 'zustand';
import type { SavedPrompt, SavedPromptSaveResult, SavePromptInput } from '../types';
import {
  listSavedPrompts,
  removeSavedPrompt,
  savePrompt,
  subscribeSavedPromptChanges,
} from '../services/savedPromptService';

interface SavedPromptState {
  prompts: SavedPrompt[];
  isLoading: boolean;
  error: string | null;
  selectedPromptId: string | null;
  load: () => Promise<void>;
  save: (input: SavePromptInput) => Promise<SavedPromptSaveResult>;
  remove: (id: string) => Promise<void>;
  select: (id: string | null) => void;
}

let readGeneration = 0;
let subscribed = false;

const sortPrompts = (prompts: SavedPrompt[]) => [...prompts].sort(
  (left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id),
);

export const useSavedPromptStore = create<SavedPromptState>((set, get) => ({
  prompts: [],
  isLoading: false,
  error: null,
  selectedPromptId: null,

  load: async () => {
    const generation = ++readGeneration;
    set({ isLoading: true, error: null });
    try {
      const prompts = await listSavedPrompts();
      if (generation !== readGeneration) return;
      set({ prompts: sortPrompts(prompts), isLoading: false });
    } catch (error) {
      if (generation !== readGeneration) return;
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Could not load saved prompts.',
      });
    }
  },

  save: async (input) => {
    readGeneration += 1;
    const result = await savePrompt(input);
    set((state) => {
      const withoutSameId = state.prompts.filter((prompt) => prompt.id !== result.prompt.id);
      return { prompts: sortPrompts([result.prompt, ...withoutSameId]), error: null };
    });
    return result;
  },

  remove: async (id) => {
    readGeneration += 1;
    await removeSavedPrompt(id);
    set((state) => ({
      prompts: state.prompts.filter((prompt) => prompt.id !== id),
      selectedPromptId: state.selectedPromptId === id ? null : state.selectedPromptId,
      error: null,
    }));
  },

  select: (id) => set({ selectedPromptId: id }),
}));

export function initializeSavedPromptSynchronization(): () => void {
  if (subscribed) return () => undefined;
  subscribed = true;
  const unsubscribe = subscribeSavedPromptChanges(() => {
    void useSavedPromptStore.getState().load();
  });
  void useSavedPromptStore.getState().load();
  return () => {
    subscribed = false;
    unsubscribe();
  };
}

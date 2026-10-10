import { create } from 'zustand';
import { duplicateSessionPreview, removeSessionPreview } from '../services/promptLibrary/sessionPreviews';
import type { SavedPrompt, SavedPromptSaveResult, SavePromptInput, PromptBlock, PromptLibraryMutation } from '../types';
import {
  listSavedPrompts,
  removeSavedPrompt,
  savePrompt,
  subscribeSavedPromptChanges,
  listPromptLibrary, mutatePromptLibrary,
} from '../services/savedPromptService';

interface SavedPromptState {
  prompts: SavedPrompt[];
  blocks: PromptBlock[];
  loadLibrary: () => Promise<void>;
  mutate: (command: PromptLibraryMutation) => Promise<string | undefined>;
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
let mutationTail: Promise<unknown> = Promise.resolve();

const sortPrompts = (prompts: SavedPrompt[]) => [...prompts].sort(
  (left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id),
);

export const useSavedPromptStore = create<SavedPromptState>((set, get) => ({
  prompts: [],
  blocks: [],
  isLoading: false,
  error: null,
  loadLibrary: async () => {
    const generation = ++readGeneration;
    set({ isLoading: true, error: null });
    try {
      const snapshot = await listPromptLibrary();
      if (generation !== readGeneration) return;
      set({ prompts: sortPrompts(snapshot.prompts), blocks: snapshot.blocks, isLoading: false });
    } catch (error) {
      if (generation !== readGeneration) return;
      set({ isLoading: false, error: error instanceof Error ? error.message : 'Could not load prompt library.' });
    }
  },
  mutate: (command) => {
    const operation = mutationTail.catch(() => undefined).then(async () => {
      ++readGeneration;
      try {
        const result = await mutatePromptLibrary(command);
        if (!window.electronAPI && command.action === 'duplicate' && result.selectedId) duplicateSessionPreview(command.id, result.selectedId);
        if (command.action === 'remove') removeSessionPreview(command.id);
        ++readGeneration;
        set({ prompts: sortPrompts(result.prompts), blocks: result.blocks, isLoading: false, error: null });
        return result.selectedId;
      } catch (error) {
        set({ isLoading: false });
        throw error;
      }
    });
    mutationTail = operation;
    return operation;
  },
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
    void useSavedPromptStore.getState().loadLibrary();
  });
  void useSavedPromptStore.getState().load();
  return () => {
    subscribed = false;
    unsubscribe();
  };
}

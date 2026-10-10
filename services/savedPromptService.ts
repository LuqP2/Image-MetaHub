import type {
  SavedPrompt,
  SavedPromptSaveResult,
  SavedPromptSourceResolution,
  SavePromptInput,
  PromptLibrarySnapshot, PromptLibraryMutation,
} from '../types';
import {
  listBrowserSavedPrompts,
  removeBrowserSavedPrompt,
  saveBrowserPrompt,
  browserPromptLibrary,
} from './savedPromptStorage';

const listeners = new Set<() => void>();
let browserChannel: BroadcastChannel | null = null;

const emitLocalChange = () => listeners.forEach((listener) => listener());

const ensureBrowserChannel = () => {
  if (browserChannel || typeof BroadcastChannel === 'undefined') return;
  browserChannel = new BroadcastChannel('image-metahub-saved-prompts');
  browserChannel.onmessage = emitLocalChange;
};

const unwrap = <T>(result: { success: true; data: T } | { success: false; error: string }): T => {
  if (result.success === false) throw new Error(result.error);
  return result.data;
};

const missingDesktopApi = (): never => {
  throw new Error('Saved-prompt desktop storage is unavailable.');
};

export async function listSavedPrompts(): Promise<SavedPrompt[]> {
  if (window.electronAPI) {
    if (!window.electronAPI.savedPromptsList) return missingDesktopApi();
    return unwrap(await window.electronAPI.savedPromptsList());
  }
  return listBrowserSavedPrompts();
}

export async function savePrompt(input: SavePromptInput): Promise<SavedPromptSaveResult> {
  if (window.electronAPI) {
    if (!window.electronAPI.savedPromptsSave) return missingDesktopApi();
    return unwrap(await window.electronAPI.savedPromptsSave(input));
  }
  const result = await saveBrowserPrompt({ ...input, source: null });
  if (result.status === 'saved') {
    emitLocalChange();
    ensureBrowserChannel();
    browserChannel?.postMessage('changed');
  }
  return result;
}

export async function removeSavedPrompt(id: string): Promise<{ id: string; removed: boolean }> {
  if (window.electronAPI) {
    if (!window.electronAPI.savedPromptsRemove) return missingDesktopApi();
    return unwrap(await window.electronAPI.savedPromptsRemove(id));
  }
  const result = await removeBrowserSavedPrompt(id);
  if (result.removed) {
    emitLocalChange();
    ensureBrowserChannel();
    browserChannel?.postMessage('changed');
  }
  return result;
}

export async function resolveSavedPromptSource(id: string): Promise<SavedPromptSourceResolution> {
  if (!window.electronAPI) return { status: 'unavailable', reason: 'browser-session-ended' };
  if (!window.electronAPI.savedPromptsResolveSource) return missingDesktopApi();
  return unwrap(await window.electronAPI.savedPromptsResolveSource(id));
}

export function subscribeSavedPromptChanges(listener: () => void): () => void {
  listeners.add(listener);
  ensureBrowserChannel();
  const unsubscribeElectron = window.electronAPI?.onSavedPromptsChanged?.(listener);
  return () => {
    listeners.delete(listener);
    unsubscribeElectron?.();
  };
}

export async function listPromptLibrary(): Promise<PromptLibrarySnapshot> {
  if (window.electronAPI) {
    if (!window.electronAPI.promptLibraryList) return missingDesktopApi();
    return unwrap(await window.electronAPI.promptLibraryList());
  }
  return browserPromptLibrary();
}
export async function mutatePromptLibrary(command: PromptLibraryMutation): Promise<PromptLibrarySnapshot & { selectedId?: string }> {
  if (window.electronAPI) {
    if (!window.electronAPI.promptLibraryMutate) return missingDesktopApi();
    return unwrap(await window.electronAPI.promptLibraryMutate(command));
  }
  const result = await browserPromptLibrary(command);
  emitLocalChange(); ensureBrowserChannel(); browserChannel?.postMessage('changed');
  return result;
}

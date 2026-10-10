import type { PromptBlock, SavedPrompt } from '../../types';
// A draft survives switching app sections; it is never automatically persisted.
type Draft = Partial<SavedPrompt & PromptBlock>;
export let sessionDraft: {
  kind: 'prompt' | 'block';
  initial: Draft;
  draft: Draft;
  pendingFile: File | null;
} | null = null;
export function rememberDraft(kind: 'prompt' | 'block', initial: Draft, draft: Draft, pendingFile: File | null = null) {
  sessionDraft = { kind, initial, draft, pendingFile };
}
export function clearDraft() { sessionDraft = null; }

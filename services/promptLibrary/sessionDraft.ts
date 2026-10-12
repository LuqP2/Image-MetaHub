import type { PromptBlock, SavedPrompt } from '../../types';
// Drafts survive app navigation, but are never automatically persisted.
export type PromptDraftContext = 'library' | 'comfyui' | 'comfyui-block';
type Draft = Partial<SavedPrompt & PromptBlock>;
type SessionDraft = { kind: 'prompt' | 'block'; initial: Draft; draft: Draft; pendingFile: File | null };
export let sessionDraft: SessionDraft | null = null;
let comfyDraft: SessionDraft | null = null;
let comfyBlockDraft: SessionDraft | null = null;
const previewValues = new Map<string, Record<string, string>>();
export function getPreviewValues(context: PromptDraftContext, key: string) { return previewValues.get(context + ':' + key) || {}; }
export function rememberPreviewValues(context: PromptDraftContext, key: string, values: Record<string, string>) { previewValues.set(context + ':' + key, values); }
export function getDraft(context: PromptDraftContext = 'library') { return context === 'library' ? sessionDraft : context === 'comfyui-block' ? comfyBlockDraft : comfyDraft; }
export function rememberDraft(kind: 'prompt' | 'block', initial: Draft, draft: Draft, pendingFile: File | null = null, context: PromptDraftContext = 'library') {
  const entry = { kind, initial, draft, pendingFile };
  if (context === 'library') sessionDraft = entry; else if (context === 'comfyui-block') comfyBlockDraft = entry; else comfyDraft = entry;
}
export function clearDraft(context: PromptDraftContext = 'library') {
  if (context === 'library') sessionDraft = null; else if (context === 'comfyui-block') comfyBlockDraft = null; else comfyDraft = null;
  for (const key of previewValues.keys()) if (key.startsWith(context + ':edit:')) previewValues.delete(key);
}

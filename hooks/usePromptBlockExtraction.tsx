import React, { useState } from 'react';
import type { PromptBlock, SavedPromptSource } from '../types';
import { emptyEditor } from '../services/promptLibrary/core.mjs';
import { useFeatureAccess } from './useFeatureAccess';
import PromptBlockEditor from '../components/promptLibrary/PromptBlockEditor';
export function selectedPromptText(): string | null {
  const selection = window.getSelection();
  if(!selection?.rangeCount || !selection.toString().trim())
    return null;
  const range = selection.getRangeAt(0);
  const element = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const start = element(range.startContainer)?.closest('[data-prompt-text]');
  const end = element(range.endContainer)?.closest('[data-prompt-text]');
  return start && start === end ? selection.toString() : null;
}
export function usePromptBlockExtraction() {
  const [draft, setDraft] = useState<Partial<PromptBlock> | null>(null);
  const { canUseAdvancedPromptLibrary, showProModal } = useFeatureAccess();
  const open = (text: string, preview: SavedPromptSource | null = null) => {
    if(!text.trim())
      return;
    if(!canUseAdvancedPromptLibrary) {
      showProModal('prompt_library_advanced');
      return;
    }
    const editor = emptyEditor();
    editor.preview = preview;
    setDraft({ text, editor });
  };
  return { open, dialog: draft ? <PromptBlockEditor initial={draft} onClose={() => setDraft(null)} /> : null };
}

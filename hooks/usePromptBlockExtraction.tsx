import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PromptBlock, SavedPromptSource } from '../types';
import { emptyEditor } from '../services/promptLibrary/core.mjs';
import { useFeatureAccess } from './useFeatureAccess';
import PromptBlockEditor from '../components/promptLibrary/PromptBlockEditor';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
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
  const [saved, setSaved] = useState<{ id?: string } | null>(null);
  useEffect(() => { if (!saved) return; const timer = setTimeout(() => setSaved(null), 7000); return () => clearTimeout(timer); }, [saved]);
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
  return { open, dialog: <>{draft && <PromptBlockEditor initial={draft} onClose={() => setDraft(null)} onSaved={id => { setDraft(null); setSaved({ id }); }} />}{saved && createPortal(<div role="status" className="fixed bottom-4 right-4 z-[12000] flex items-center gap-3 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-xs text-gray-100 shadow-xl"><span>Block saved.</span>{saved.id && <button className="text-accent" onClick={() => { const block = useSavedPromptStore.getState().blocks.find(entry => entry.id === saved.id); if (block) setDraft(block); setSaved(null); }}>Edit block</button>}</div>, document.body)}</> };
}

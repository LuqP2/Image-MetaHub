import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PromptVariable } from '../types';

export function createSelectionField(text: string, names: string[]): PromptVariable {
  let number = 1;
  const name = () => number === 1 ? 'subject' : `subject_${number}`;
  while (names.includes(name())) number++;
  return { name: name(), label: '', type: 'text', required: true, defaultValue: text, options: [] };
}

export function usePromptSelectionMenu() {
  const [selection, setSelection] = useState<{ text: string; before: string; start: number; end: number; element: HTMLTextAreaElement; x: number; y: number; extract?: (text: string) => void; create?: (text: string, start: number, end: number) => void } | null>(null);
  useEffect(() => { if (!selection) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelection(null); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [selection]);
  const open = (event: React.MouseEvent<HTMLTextAreaElement>, extract: ((text: string) => void) | undefined, create?: (text: string, start: number, end: number) => void) => {
    const element = event.currentTarget, start = element.selectionStart, end = element.selectionEnd;
    const text = element.value.slice(start, end);
    if (!text.trim()) return;
    event.preventDefault();
    setSelection({ text, before: element.value, start, end, element, extract, create: element.readOnly ? undefined : create, x: event.clientX, y: event.clientY });
  };
  const menu = selection && createPortal(<><button aria-label="Dismiss text actions" className="fixed inset-0 z-[12000] cursor-default" onClick={() => setSelection(null)} /><div role="menu" aria-label="Selected text actions" className="fixed z-[12001] w-60 rounded-lg border border-gray-700 bg-gray-900 p-1 text-xs text-gray-100 shadow-xl" style={{ left: Math.max(8, Math.min(selection.x, window.innerWidth - 248)), top: Math.max(8, Math.min(selection.y, window.innerHeight - 130)) }}>
    {selection.create && <button role="menuitem" className="block w-full rounded p-2 text-left hover:bg-gray-800" onClick={() => { if (selection.element.isConnected && selection.element.value === selection.before) selection.create?.(selection.text, selection.start, selection.end); setSelection(null); }}>Make selection a fillable field</button>}
    {selection.extract && <button role="menuitem" className="block w-full rounded p-2 text-left hover:bg-gray-800" onClick={() => { selection.extract?.(selection.text); setSelection(null); }}>Save Selection as Block</button>}
  </div></>, document.body);
  return { open, menu };
}

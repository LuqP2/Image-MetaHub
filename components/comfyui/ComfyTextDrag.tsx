import React from 'react';
import { GripVertical } from 'lucide-react';

export function startComfyTextDrag(event: React.DragEvent, text: string) {
  if (!text.trim()) { event.preventDefault(); return; }
  event.stopPropagation();
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/plain', text);
  event.dataTransfer.setData('application/x-imagemetahub-prompt-text', text);
}

export default function ComfyTextDrag({ text, disabled = false, label = 'Drag to node', resolveText }: { text: string; disabled?: boolean; label?: string; resolveText?: () => string }) {
  const enabled = !disabled && !!text.trim();
  return <span draggable={enabled} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }} onDragStart={event => enabled ? startComfyTextDrag(event, resolveText ? resolveText() : text) : event.preventDefault()} title={enabled ? 'Drag to a text node: drop to add; hold Shift when dropping for Add / Replace' : 'Fill valid template values before dragging'} aria-label={label} aria-disabled={!enabled} className={`inline-flex items-center gap-1 rounded border border-accent/30 px-2 py-1 text-xs text-accent ${enabled ? 'cursor-grab active:cursor-grabbing' : 'opacity-40'}`}><GripVertical size={13} />{label}</span>;
}

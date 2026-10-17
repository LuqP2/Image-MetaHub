import React, { useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react';
import { Reorder, useDragControls, useReducedMotion } from 'framer-motion';
import type { PromptBlock, PromptPart } from '../../types';
import { blockSnapshotContent, normalizeVariables } from '../../services/promptLibrary/core.mjs';
import { buttonClass, fieldClass } from './PromptVariables';

export default function PromptPartCard({ part, index, count, channel, reorderValue, disabled, compact = false, highlighted = false, original, onToggle, onMove, onRemove, onUpdate, onTextChange, onContextMenu }: {
  part: PromptPart;
  index: number;
  count: number;
  channel: 'positive' | 'negative';
  reorderValue?: unknown;
  disabled: boolean;
  compact?: boolean;
  highlighted?: boolean;
  original?: PromptBlock | null;
  onToggle?: (enabled: boolean) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onUpdate?: () => void;
  onTextChange?: (text: string) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLTextAreaElement>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const dragControls = useDragControls();
  const reducedMotion = useReducedMotion();
  const source = original ? blockSnapshotContent(original) : null;
  const changed = source && (source.text !== part.text || source.title !== part.title || JSON.stringify(source.variables) !== JSON.stringify(normalizeVariables(part.variables)));
  const actionClass = 'flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30';
  return <Reorder.Item as="article" value={reorderValue ?? part} layout dragListener={false} dragControls={dragControls} drag={!disabled ? 'y' : false} style={{ position: 'relative' }} whileDrag={{ zIndex: 20, scale: reducedMotion ? 1 : 1.02, boxShadow: '0 12px 28px rgba(0,0,0,0.25)' }} transition={{ duration: reducedMotion ? 0 : 0.18 }} data-part-id={part.id} className={`space-y-2 rounded-lg border bg-gray-950 ${compact ? 'p-2' : 'p-3'} ${highlighted ? 'border-accent ring-1 ring-accent/30' : 'border-gray-700'} ${part.enabled ? '' : 'opacity-60'}`}>
    <div className="flex min-w-0 items-center gap-1.5">
      <span title="Drag to reorder" className="shrink-0 cursor-grab text-gray-500 active:cursor-grabbing" style={{ touchAction: 'none' }} onPointerDown={event => { if (!disabled) { event.preventDefault(); dragControls.start(event); } }}><GripVertical size={14} /></span>
      {onToggle && <input aria-label={`Enable ${channel} part ${index + 1}`} type="checkbox" className="shrink-0 accent-[rgb(var(--accent))]" disabled={disabled} checked={part.enabled} onChange={e => onToggle(e.target.checked)} />}
      <h4 className="min-w-0 flex-1 truncate text-xs font-semibold" title={part.title}>{part.kind === 'block' ? part.title || 'Untitled block' : 'Free text'}</h4>
      {!part.enabled && <span className="text-[10px] text-gray-400">Excluded</span>}
      <button type="button" aria-label={`Move ${channel} part ${index + 1} up`} className={actionClass} disabled={disabled || index === 0} onClick={() => onMove(index - 1)}><ArrowUp size={14} /></button>
      <button type="button" aria-label={`Move ${channel} part ${index + 1} down`} className={actionClass} disabled={disabled || index === count - 1} onClick={() => onMove(index + 1)}><ArrowDown size={14} /></button>
      <button type="button" aria-label={`Remove ${channel} part ${index + 1}`} className={actionClass} disabled={disabled} onClick={onRemove}><X size={14} /></button>
    </div>
    {part.kind === 'text' || expanded ? <textarea aria-label={`${channel} part ${index + 1}`} readOnly={disabled || part.kind === 'block'} className={fieldClass + ' resize-y !text-sm'} rows={part.kind === 'text' ? 2 : 4} value={part.text} onChange={e => onTextChange?.(e.target.value)} onContextMenu={onContextMenu} /> : <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-400">{part.text}</p>}
    {part.kind === 'block' && <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <button type="button" className="text-[11px] text-gray-400 hover:text-accent focus-visible:outline focus-visible:outline-accent" onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide text' : 'Show text'}</button>
      {onUpdate && <details className="min-w-0 flex-1 text-[11px] text-gray-400"><summary className="cursor-pointer">{changed ? 'Update available' : !original ? 'Original unavailable' : 'Block details'}</summary><p className="mt-2">Saved version {part.blockRevision}. Edits to the original do not change this copy.</p>{changed && <button type="button" className={buttonClass + ' mt-2'} disabled={disabled} onClick={onUpdate}>Update this block</button>}</details>}
    </div>}
  </Reorder.Item>;
}

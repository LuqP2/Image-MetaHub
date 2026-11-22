import { useTranslation } from '../../i18n/useTranslation';
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
  const { t } = useTranslation();
  const partValues = { channel: t(channel === 'negative' ? 'promptLibrary.negativeChannel' : 'promptLibrary.positiveChannel'), index: index + 1 };
  const [expanded, setExpanded] = useState(false);
  const dragControls = useDragControls();
  const reducedMotion = useReducedMotion();
  const source = original ? blockSnapshotContent(original) : null;
  const changed = source && (source.text !== part.text || source.title !== part.title || JSON.stringify(source.variables) !== JSON.stringify(normalizeVariables(part.variables)));
  const actionClass = 'flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30';
  return <Reorder.Item as="article" value={reorderValue ?? part} layout dragListener={false} dragControls={dragControls} drag={!disabled ? 'y' : false} style={{ position: 'relative' }} whileDrag={{ zIndex: 20, scale: reducedMotion ? 1 : 1.02, boxShadow: '0 12px 28px rgba(0,0,0,0.25)' }} transition={{ duration: reducedMotion ? 0 : 0.18 }} data-part-id={part.id} className={`space-y-2 border ${compact ? 'rounded p-2' : 'rounded-lg bg-gray-950 p-3'} ${highlighted ? 'border-accent ring-1 ring-accent/30' : compact ? 'border-gray-800' : 'border-gray-700'} ${part.enabled ? '' : 'opacity-60'}`}>
    <div className="flex min-w-0 items-center gap-1.5">
      <span title={t('promptLibrary.dragReorder')} className="shrink-0 cursor-grab text-gray-500 active:cursor-grabbing" style={{ touchAction: 'none' }} onPointerDown={event => { if (!disabled) { event.preventDefault(); dragControls.start(event); } }}><GripVertical size={14} /></span>
      {onToggle && <input aria-label={t('promptLibrary.enablePart', partValues)} type="checkbox" className="shrink-0 accent-[rgb(var(--accent))]" disabled={disabled} checked={part.enabled} onChange={e => onToggle(e.target.checked)} />}
      <h4 className="min-w-0 flex-1 truncate text-xs font-semibold" title={part.title}>{part.kind === 'block' ? part.title || t('promptLibrary.untitledBlock') : t('promptLibrary.freeText')}</h4>
      {!part.enabled && <span className="text-[10px] text-gray-400">{t('promptLibrary.excluded')}</span>}
      <button type="button" aria-label={t('promptLibrary.movePartUp', partValues)} className={actionClass} disabled={disabled || index === 0} onClick={() => onMove(index - 1)}><ArrowUp size={14} /></button>
      <button type="button" aria-label={t('promptLibrary.movePartDown', partValues)} className={actionClass} disabled={disabled || index === count - 1} onClick={() => onMove(index + 1)}><ArrowDown size={14} /></button>
      <button type="button" aria-label={t('promptLibrary.removePart', partValues)} className={actionClass} disabled={disabled} onClick={onRemove}><X size={14} /></button>
    </div>
    {part.kind === 'text' || expanded ? <textarea aria-label={t('promptLibrary.partText', partValues)} readOnly={disabled || part.kind === 'block'} className={fieldClass + ' resize-y !text-sm'} rows={part.kind === 'text' ? 2 : 4} value={part.text} onChange={e => onTextChange?.(e.target.value)} onContextMenu={onContextMenu} /> : <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-400">{part.text}</p>}
    {part.kind === 'block' && <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <button type="button" className="text-[11px] text-gray-400 hover:text-accent focus-visible:outline focus-visible:outline-accent" onClick={() => setExpanded(!expanded)}>{expanded ? t('promptLibrary.hideText') : t('promptLibrary.showText')}</button>
      {onUpdate && <details className="ui-disclosure min-w-0 flex-1 text-[11px] text-gray-400"><summary className="cursor-pointer">{changed ? t('promptLibrary.updateAvailable') : !original ? t('promptLibrary.originalUnavailable') : t('promptLibrary.blockDetails')}</summary><p className="mt-2">{t('promptLibrary.savedVersion', { revision: part.blockRevision ?? '' })}</p>{changed && <button type="button" className={buttonClass + ' mt-2'} disabled={disabled} onClick={onUpdate}>{t('promptLibrary.updateBlock')}</button>}</details>}
    </div>}
  </Reorder.Item>;
}

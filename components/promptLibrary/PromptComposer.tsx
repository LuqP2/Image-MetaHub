import { useTranslation } from '../../i18n/useTranslation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Reorder } from 'framer-motion';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { PromptDocument, PromptBlock, PromptPart, SavedPrompt } from '../../types';
import { appendAdditions, blockAddition, type CompositionAddition } from '../../services/promptLibrary/composition';
import { allVariables } from '../../services/promptLibrary/core.mjs';
import { buttonClass, fieldClass } from './PromptVariables';
import PromptBlockPicker from './PromptBlockPicker';
import PromptPartCard from './PromptPartCard';
import { createSelectionField, usePromptSelectionMenu } from '../../hooks/usePromptSelectionMenu';

export default function PromptComposer({ document, blocks, prompts = [], disabled, onChange, onExtract, onError, compact = false, values = {} }: {
  document: PromptDocument;
  blocks: PromptBlock[];
  prompts?: SavedPrompt[];
  disabled: boolean;
  onChange: (doc: PromptDocument) => void;
  onExtract: (text: string) => void;
  onError: (message: string) => void;
  compact?: boolean;
  values?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const [picker, setPicker] = useState<'positive' | 'negative' | null>(null);
  const hasNegative = document.negative.some(part => part.text.length > 0);
  const [showNegative, setShowNegative] = useState(hasNegative);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const selection = usePromptSelectionMenu();
  const [fieldStatus, setFieldStatus] = useState<{ placeholder: string; text: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const blockById = useMemo(() => new Map(blocks.map(block => [block.id, block])), [blocks]);
  useEffect(() => { if (hasNegative) setShowNegative(true); }, [hasNegative]);
  useEffect(() => {
    if (!highlighted.length) return;
    const first = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-part-id]') || []).find(node => node.dataset.partId === highlighted[0]);
    first?.scrollIntoView?.({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const timer = setTimeout(() => setHighlighted([]), 1600);
    return () => clearTimeout(timer);
  }, [highlighted]);
  const commit = (next: PromptDocument) => {
    if (disabled) return false;
    try { allVariables(next); onChange(next); onError(''); return true; }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'promptLibrary.conflictingBlocks'); return false; }
  };
  const change = (channel: 'positive' | 'negative', parts: PromptPart[]) => commit({ ...document, [channel]: parts });
  const selectedPart = (event: React.MouseEvent<HTMLTextAreaElement>, channel: 'positive' | 'negative', part: PromptPart) => {
    selection.open(event, onExtract, part.kind === 'text' && !disabled ? (text, start, end) => {
      try {
        const field = createSelectionField(text, allVariables(document).map(variable => variable.name));
        const next = { ...document, mode: 'template' as const, variables: [...document.variables, field], [channel]: document[channel].map(entry => entry.id === part.id ? { ...entry, text: entry.text.slice(0, start) + '{{' + field.name + '}}' + entry.text.slice(end) } : entry) };
        if (commit(next)) setFieldStatus({ placeholder: '{{' + field.name + '}}', text });
      } catch (cause) { onError(cause instanceof Error ? cause.message : 'promptLibrary.fieldCreateFailed'); }
    } : undefined);
  };
  const insert = (additions: CompositionAddition[]) => {
    if (!picker || !additions.length) return false;
    try {
      if (!commit(appendAdditions(document, additions))) return false;
      setHighlighted(additions.flatMap(addition => [...addition.positive, ...addition.negative].map(part => part.id)));
      return true;
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'promptLibrary.addSelectedFailed'); return false; }
  };
  const move = (channel: 'positive' | 'negative', from: number, to: number) => {
    if (from < 0 || to < 0 || to >= document[channel].length) return;
    const parts = [...document[channel]]; const [part] = parts.splice(from, 1); parts.splice(to, 0, part); change(channel, parts);
  };
  const negativeVisible = showNegative;
  return <div ref={root} className={compact ? 'space-y-4' : 'space-y-5'}>
    {selection.menu}
    {fieldStatus && <p role="status" className="text-xs text-accent">{t('promptLibrary.fieldReplacedPart', fieldStatus)}</p>}
    {(['positive', 'negative'] as const).map(channel => <section key={channel} className="space-y-2" aria-label={channel === 'positive' ? t('promptLibrary.promptComposition') : t('promptLibrary.negativeComposition')}>
      {channel === 'positive' ? <h3 className="text-sm font-semibold">{t('promptLibrary.promptType')}</h3> : <button type="button" className="flex items-center gap-2 text-xs font-semibold" aria-expanded={negativeVisible} onClick={() => setShowNegative(!negativeVisible)}>{negativeVisible ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{negativeVisible ? t('promptLibrary.negativePrompt') : t('promptLibrary.addNegativePrompt')}</button>}
      {(channel === 'positive' || negativeVisible) && <>
        {!document[channel].length && <p className={`border border-dashed p-3 text-xs text-gray-400 ${compact ? 'rounded border-gray-800' : 'rounded-lg border-gray-700'}`}>{t('promptLibrary.buildHelp')}</p>}
        <Reorder.Group as="div" axis="y" values={document[channel]} onReorder={parts => change(channel, parts)} className="space-y-2">{document[channel].map((part, index) => {
          const original = part.kind === 'block' ? blockById.get(part.blockId || '') || null : null;
          return <PromptPartCard key={part.id} part={part} index={index} count={document[channel].length} channel={channel} disabled={disabled} compact={compact} highlighted={highlighted.includes(part.id)} original={original}
            onToggle={enabled => change(channel, document[channel].map(p => p.id === part.id ? { ...p, enabled } : p))}
            onMove={to => move(channel, index, to)}
            onRemove={() => change(channel, document[channel].filter(p => p.id !== part.id))}
            onTextChange={text => change(channel, document[channel].map(p => p.id === part.id ? { ...p, text } : p))}
            onContextMenu={event => selectedPart(event, channel, part)}
            onUpdate={part.kind === 'block' ? () => {
              if (original && window.confirm(t('promptLibrary.updateInstanceConfirm', { previous: part.text, next: original.text }))) {
                const addition = blockAddition(original, channel);
                commit({ ...document, mode: addition.template ? 'template' : document.mode, [channel]: document[channel].map(p => p.id === part.id ? { ...addition[channel][0], id: part.id, enabled: part.enabled } : p) });
              }
            } : undefined} />;
        })}</Reorder.Group>
        <div className="flex flex-wrap gap-2"><button type="button" aria-label={t(channel === 'negative' ? 'promptLibrary.addNegativeBlocks' : 'promptLibrary.addPositiveBlocks')} className={buttonClass + ' !border-accent/40 !bg-accent/10'} disabled={disabled} onClick={() => setPicker(channel)}><Plus size={14} />{t('promptLibrary.addBlocks')}</button><button type="button" aria-label={channel === 'negative' ? t('promptLibrary.addNegativeText') : t('promptLibrary.addPromptText')} className={buttonClass} disabled={disabled} onClick={() => change(channel, [...document[channel], { id: crypto.randomUUID(), kind: 'text', text: '', enabled: true }])}>{t('promptLibrary.writeText')}</button></div>
      </>}
    </section>)}
    <details className="space-y-2 text-xs text-gray-400"><summary className="cursor-pointer">{t('promptLibrary.compositionOptions')}</summary>{(['positive', 'negative'] as const).filter(channel => channel === 'positive' || negativeVisible).map(channel => <label key={channel} className="flex items-center gap-2">{channel === 'positive' ? t('promptLibrary.promptSeparator') : t('promptLibrary.negativeSeparator')}<select aria-label={t(channel === 'negative' ? 'promptLibrary.negativeSeparatorLabel' : 'promptLibrary.positiveSeparatorLabel')} className={fieldClass + ' !w-auto !text-xs'} disabled={disabled} value={document[`${channel}Separator`]} onChange={e => commit({ ...document, [`${channel}Separator`]: e.target.value })}><option value=", ">{t('promptLibrary.comma')}</option><option value=" ">{t('promptLibrary.space')}</option><option value={'\n'}>{t('promptLibrary.newLine')}</option></select></label>)}</details>
    {picker && <PromptBlockPicker blocks={blocks} prompts={prompts} document={document} channel={picker} values={values} onConfirm={insert} onClose={() => setPicker(null)} />}
  </div>;
}

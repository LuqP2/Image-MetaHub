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
  const [picker, setPicker] = useState<'positive' | 'negative' | null>(null);
  const hasNegative = document.negative.some(part => part.text.length > 0);
  const [showNegative, setShowNegative] = useState(hasNegative);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const selection = usePromptSelectionMenu();
  const [fieldStatus, setFieldStatus] = useState('');
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
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Conflicting block variables'); return false; }
  };
  const change = (channel: 'positive' | 'negative', parts: PromptPart[]) => commit({ ...document, [channel]: parts });
  const selectedPart = (event: React.MouseEvent<HTMLTextAreaElement>, channel: 'positive' | 'negative', part: PromptPart) => {
    selection.open(event, onExtract, part.kind === 'text' && !disabled ? (text, start, end) => {
      try {
        const field = createSelectionField(text, allVariables(document).map(variable => variable.name));
        const next = { ...document, mode: 'template' as const, variables: [...document.variables, field], [channel]: document[channel].map(entry => entry.id === part.id ? { ...entry, text: entry.text.slice(0, start) + '{{' + field.name + '}}' + entry.text.slice(end) } : entry) };
        if (commit(next)) setFieldStatus(`{{${field.name}}} replaces “${text}” in this text part. Its default value preserves the original text.`);
      } catch (cause) { onError(cause instanceof Error ? cause.message : 'Could not create field.'); }
    } : undefined);
  };
  const insert = (additions: CompositionAddition[]) => {
    if (!picker || !additions.length) return false;
    try {
      if (!commit(appendAdditions(document, additions))) return false;
      setHighlighted(additions.flatMap(addition => [...addition.positive, ...addition.negative].map(part => part.id)));
      return true;
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Could not add the selected items.'); return false; }
  };
  const move = (channel: 'positive' | 'negative', from: number, to: number) => {
    if (from < 0 || to < 0 || to >= document[channel].length) return;
    const parts = [...document[channel]]; const [part] = parts.splice(from, 1); parts.splice(to, 0, part); change(channel, parts);
  };
  const negativeVisible = showNegative;
  return <div ref={root} className={compact ? 'space-y-4' : 'space-y-5'}>
    {selection.menu}
    {fieldStatus && <p role="status" className="text-xs text-accent">{fieldStatus}</p>}
    {(['positive', 'negative'] as const).map(channel => <section key={channel} className="space-y-2" aria-label={channel === 'positive' ? 'Prompt composition' : 'Negative prompt composition'}>
      {channel === 'positive' ? <h3 className="text-sm font-semibold">Prompt</h3> : <button type="button" className="flex items-center gap-2 text-xs font-semibold" aria-expanded={negativeVisible} onClick={() => setShowNegative(!negativeVisible)}>{negativeVisible ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{negativeVisible ? 'Negative prompt' : 'Add negative prompt'}</button>}
      {(channel === 'positive' || negativeVisible) && <>
        {!document[channel].length && <p className="rounded-lg border border-dashed border-gray-700 p-3 text-xs text-gray-400">Build your prompt by adding blocks in the order you want, or write your own text.</p>}
        <Reorder.Group as="div" axis="y" values={document[channel]} onReorder={parts => change(channel, parts)} className="space-y-2">{document[channel].map((part, index) => {
          const original = part.kind === 'block' ? blockById.get(part.blockId || '') || null : null;
          return <PromptPartCard key={part.id} part={part} index={index} count={document[channel].length} channel={channel} disabled={disabled} compact={compact} highlighted={highlighted.includes(part.id)} original={original}
            onToggle={enabled => change(channel, document[channel].map(p => p.id === part.id ? { ...p, enabled } : p))}
            onMove={to => move(channel, index, to)}
            onRemove={() => change(channel, document[channel].filter(p => p.id !== part.id))}
            onTextChange={text => change(channel, document[channel].map(p => p.id === part.id ? { ...p, text } : p))}
            onContextMenu={event => selectedPart(event, channel, part)}
            onUpdate={part.kind === 'block' ? () => {
              if (original && window.confirm(`Update this instance?\n\nPrevious:\n${part.text}\n\nNew:\n${original.text}`)) {
                const addition = blockAddition(original, channel);
                commit({ ...document, mode: addition.template ? 'template' : document.mode, [channel]: document[channel].map(p => p.id === part.id ? { ...addition[channel][0], id: part.id, enabled: part.enabled } : p) });
              }
            } : undefined} />;
        })}</Reorder.Group>
        <div className="flex flex-wrap gap-2"><button type="button" aria-label={`Add ${channel} blocks`} className={buttonClass + ' !border-accent/40 !bg-accent/10'} disabled={disabled} onClick={() => setPicker(channel)}><Plus size={14} />Add blocks</button><button type="button" aria-label={channel === 'negative' ? 'Add negative text' : 'Add prompt text'} className={buttonClass} disabled={disabled} onClick={() => change(channel, [...document[channel], { id: crypto.randomUUID(), kind: 'text', text: '', enabled: true }])}>Write text</button></div>
      </>}
    </section>)}
    <details className="space-y-2 text-xs text-gray-400"><summary className="cursor-pointer">Composition options</summary>{(['positive', 'negative'] as const).filter(channel => channel === 'positive' || negativeVisible).map(channel => <label key={channel} className="flex items-center gap-2">{channel === 'positive' ? 'Prompt separator' : 'Negative separator'}<select aria-label={`${channel} separator`} className={fieldClass + ' !w-auto !text-xs'} disabled={disabled} value={document[`${channel}Separator`]} onChange={e => commit({ ...document, [`${channel}Separator`]: e.target.value })}><option value=", ">Comma</option><option value=" ">Space</option><option value={'\n'}>New line</option></select></label>)}</details>
    {picker && <PromptBlockPicker blocks={blocks} prompts={prompts} document={document} channel={picker} values={values} onConfirm={insert} onClose={() => setPicker(null)} />}
  </div>;
}

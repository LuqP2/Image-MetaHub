import React, { useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Plus } from 'lucide-react';
import type { PromptDocument, PromptBlock, PromptPart } from '../../types';
import { allVariables, snapshotBlock } from '../../services/promptLibrary/core.mjs';
import { buttonClass, fieldClass } from './PromptVariables';
import PromptBlockPicker from './PromptBlockPicker';
export default function PromptComposer({ document, blocks, disabled, onChange, onExtract, onError }: {
  document: PromptDocument;
  blocks: PromptBlock[];
  disabled: boolean;
  onChange: (doc: PromptDocument) => void;
  onExtract: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [picker, setPicker] = useState<'positive' | 'negative' | null>(null);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [showNegative, setShowNegative] = useState(document.negative.some(part => !!part.text));
  const toggle = (id: string) => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const insert = (block: PromptBlock) => {
    if (!picker) return;
    const next = { ...document, mode: block.editor.variables.length ? 'template' as const : document.mode };
    const part = snapshotBlock(block);
    try { allVariables({ ...next, [picker]: [...next[picker], part] }); onChange({ ...next, [picker]: [...next[picker], part] }); setPicker(null); }
    catch (error) { onError(error instanceof Error ? error.message : 'Variable conflict'); }
  };
  const change = (channel: 'positive' | 'negative', parts: PromptPart[]) => {
    const next = { ...document, [channel]: parts };
    try {
      allVariables(next);
      onChange(next);
    }
    catch(error) {
      onError(error instanceof Error ? error.message : 'Conflicting block variables');
    }
  };
  const move = (channel: 'positive' | 'negative', from: number, to: number) => {
    if(to < 0 || to >= document[channel].length)
      return; const parts = [...document[channel]]; const [part] = parts.splice(from, 1); parts.splice(to, 0, part); change(channel, parts);
  };
  return <div className="space-y-5">
    <p className="text-xs text-gray-400">Combine blocks and free text. Drag the handle or use the arrows to reorder; disabled parts are left out of the result.</p>
    {(['positive', 'negative'] as const).map((channel) => <section key={channel} className="space-y-2">
      <div className="flex items-center justify-between">
        {channel === 'negative' ? <button type="button" className="flex items-center gap-2 text-sm font-semibold" onClick={() => setShowNegative(!showNegative)}>{showNegative ? <ChevronDown size={15} /> : <ChevronRight size={15} />}Negative prompt</button> : <h3 className="text-sm font-semibold">Positive prompt</h3>}
        <select
          aria-label={`${channel} separator`}
          disabled={disabled}
          className={fieldClass + ' !w-auto'}
          value={document[`${channel}Separator`]}
          onChange={(e) => onChange({ ...document, [`${channel}Separator`]: e.target.value })}>
          <option value=", ">{"Comma"}</option>
          <option value=" ">{"Space"}</option>
          <option value={'\n'}>{"New line"}</option>
        </select>
      </div>

      {(channel === 'positive' || showNegative) && <>
      {document[channel].map((part, index) => {
        const original = part.kind === 'block' ? blocks.find((b) => b.id === part.blockId) : null;
        const changed = original && (original.text !== part.text || original.editor.title !== part.title || JSON.stringify(original.editor.variables) !== JSON.stringify(part.variables || []));
        return <article
          key={part.id}
          onDragOver={(e) => {
            if(!disabled)
              e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault(); const [source, position] = e.dataTransfer.getData('text/plain').split(':'); if(!disabled && source === channel && Number.isInteger(Number(position)) && Number(position) >= 0 && Number(position) < document[channel].length)
              move(channel, Number(position), index);
          }}
          className={`space-y-2 rounded-lg border border-gray-700 bg-gray-950/40 p-3 ${part.enabled ? '' : 'opacity-50'}`}>

          <div className="flex flex-wrap items-center gap-2">
            <span draggable={!disabled} onDragStart={e => e.dataTransfer.setData('text/plain', `${channel}:${index}`)} title="Drag to reorder" className="cursor-grab text-gray-500"><GripVertical size={15} /></span>
            <label className="flex flex-1 items-center gap-2 text-xs">
              <input
                disabled={disabled}
                type="checkbox"
                checked={part.enabled}
                onChange={(e) => change(channel, document[channel].map((p) => p.id === part.id ? { ...p, enabled: e.target.checked } : p))} />
              {part.kind === 'block' ? part.title || 'Block snapshot' : 'Free text'}
            </label>
            {part.kind === 'block' && <button type="button" className="text-xs text-accent" onClick={() => toggle(part.id)}>{expanded.has(part.id) ? 'Hide text' : 'Show text'}</button>}

            <button
              type="button"
              aria-label={`Move ${channel} part ${index + 1} up`}
              className={buttonClass}
              disabled={disabled || index === 0}
              onClick={() => move(channel, index, index - 1)}>{"↑"}</button>
            <button
              type="button"
              aria-label={`Move ${channel} part ${index + 1} down`}
              className={buttonClass}
              disabled={disabled || index === document[channel].length - 1}
              onClick={() => move(channel, index, index + 1)}>{"↓"}</button>
            <button
              type="button"
              disabled={disabled}
              className={buttonClass}
              onClick={() => change(channel, document[channel].filter((p) => p.id !== part.id))}>{"Remove"}</button>
          </div>

          {(part.kind === 'text' || expanded.has(part.id)) ? <textarea
            aria-label={`${channel} part ${index + 1}`}
            readOnly={disabled || part.kind === 'block'}
            className={fieldClass}
            rows={part.kind === 'text' ? 2 : 4}
            value={part.text}
            onChange={(e) => change(channel, document[channel].map((p) => p.id === part.id ? { ...p, text: e.target.value } : p))}
            onContextMenu={(e) => {
              const text = e.currentTarget.value.slice(e.currentTarget.selectionStart, e.currentTarget.selectionEnd); if(text.trim()) {
                e.preventDefault();
                onExtract(text);
              }
            }} /> : <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-gray-400">{part.text}</p>}

          {part.kind === 'block' && <div className="text-[11px] text-gray-400">{"Saved version "}{part.blockRevision}
            {!original ? ' · Original block unavailable' : changed ? <><span>{" · Updated block available"}</span><button
              type="button"
              disabled={disabled}
              className={buttonClass + ' ml-2'}
              onClick={() => {
                if(window.confirm(`Update this instance?\n\nPrevious:\n${part.text}\n\nNew:\n${original.text}`))
                  change(channel, document[channel].map((p) => p.id === part.id ? { ...snapshotBlock(original), id: part.id, enabled: part.enabled } : p));
              }}>{"Update this block"}</button></> : ' · Up to date'}
          </div>}

        </article>;
      })}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          className={buttonClass}
          onClick={() => change(channel, [...document[channel], { id: crypto.randomUUID(), kind: 'text', text: '', enabled: true }])}>{"Add free text"}</button>

        <button type="button" aria-label={`Add ${channel} block`} className={buttonClass + ' !border-accent/30'} disabled={disabled} onClick={() => setPicker(channel)}><Plus size={14} />Add block</button>

      </div>
      </>}
    </section>)}
    {picker && <PromptBlockPicker blocks={blocks} channel={picker} onChoose={insert} onClose={() => setPicker(null)} />}
  </div>;
}

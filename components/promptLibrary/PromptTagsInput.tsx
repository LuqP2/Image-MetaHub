import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { buttonClass, fieldClass } from './PromptVariables';

export default function PromptTagsInput({ tags, onChange, suggestions = [], label = 'Tags', disabled = false, compact = false }: {
  tags: string[]; onChange: (tags: string[]) => void; suggestions?: string[]; label?: string; disabled?: boolean; compact?: boolean;
}) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open && !disabled) inputRef.current?.focus(); }, [open, disabled]);
  const add = (text: string) => {
    if (disabled) return;
    const next = [...new Set([...tags, ...text.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)])];
    if (next.length !== tags.length) onChange(next);
    setInput('');
  };
  const available = [...new Set(suggestions)].filter(tag => !tags.includes(tag) && tag.toLowerCase().includes(input.trim().toLowerCase())).sort();
  return <div className={compact ? 'contents' : 'space-y-1'} onBlur={event => { if (!disabled && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }}>
    {!compact && <p className="text-xs text-gray-400">{label}</p>}
    <div className={compact ? 'contents' : 'flex flex-wrap items-center gap-1.5'}>
      {tags.filter(Boolean).map(tag => <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-gray-700 px-2 py-0.5 text-xs">
        {tag}<button type="button" disabled={disabled} aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter(t => t !== tag))}><X size={12} /></button>
      </span>)}
      <div className="relative">
        <button type="button" className={buttonClass + (compact ? ' !h-6 !min-h-0 !px-2 !py-0 !text-[11px] !leading-4' : ' !py-1')} disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>+ Tag</button>
        {open && <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-lg border border-gray-700 bg-gray-900 p-2 shadow-xl">
          <input ref={inputRef} autoFocus aria-label="Search or create tag" readOnly={disabled} className={fieldClass + ' !py-1 !text-xs'} placeholder="Search or create…" value={input}
            onChange={event => { const text = event.target.value; if (text.includes(',')) add(text); else setInput(text); }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(input); } }} />
          <div className="mt-1 max-h-48 overflow-y-auto">
            {available.map(tag => <button type="button" disabled={disabled} key={tag} className="block w-full rounded p-2 text-left text-xs hover:bg-gray-800" onClick={() => add(tag)}>{tag}</button>)}
            {input.trim() && !suggestions.some(tag => tag.toLowerCase() === input.trim().toLowerCase()) && !tags.includes(input.trim().toLowerCase()) && <button type="button" disabled={disabled} className="w-full rounded p-2 text-left text-xs hover:bg-gray-800" onClick={() => add(input)}>Create “{input.trim().toLowerCase()}”</button>}
            {!available.length && !input.trim() && <p className="p-2 text-xs text-gray-400">Type a name to create a tag.</p>}
          </div>
        </div>}
      </div>
    </div>
  </div>;
}

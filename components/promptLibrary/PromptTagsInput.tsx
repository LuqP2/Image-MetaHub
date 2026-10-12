import React, { useId, useState } from 'react';
import { X } from 'lucide-react';
import { fieldClass } from './PromptVariables';

export default function PromptTagsInput({ tags, onChange, suggestions = [], label = 'Tags', disabled = false, compact = false }: {
  tags: string[]; onChange: (tags: string[]) => void; suggestions?: string[]; label?: string; disabled?: boolean; compact?: boolean;
}) {
  const [input, setInput] = useState('');
  const id = useId();
  const add = (text: string) => {
    const next = [...new Set([...tags, ...text.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)])];
    if (disabled) return;
    onChange(next); setInput('');
  };
  return <div className="space-y-2">
    <label htmlFor={id} className="text-xs text-gray-400">{label}</label>
    <div className="flex flex-wrap gap-1.5">
      {tags.filter(Boolean).map(tag => <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-gray-700 bg-gray-800/60 px-2 py-1 text-xs">
        {tag}<button type="button" disabled={disabled} aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter(t => t !== tag))}><X size={12} /></button>
      </span>)}
    </div>
    <input id={id} disabled={disabled} className={fieldClass + (compact ? ' !py-1.5 !text-xs' : '')} list={`${id}-options`} placeholder="Add tag…" value={input}
      onChange={e => { const text = e.target.value; if (text.includes(',')) add(text); else setInput(text); }}
      onBlur={() => { if (input.trim()) add(input); }}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(input); } }} />
    <datalist id={`${id}-options`}>{suggestions.filter(t => !tags.includes(t)).map(t => <option key={t} value={t} />)}</datalist>
    {!compact && <p className="text-[11px] text-gray-500">Press Enter or comma to add a tag.</p>}
  </div>;
}

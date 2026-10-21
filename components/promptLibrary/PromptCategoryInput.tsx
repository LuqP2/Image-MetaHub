import React, { useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { buttonClass, fieldClass } from './PromptVariables';

export default function PromptCategoryInput({ value, suggestions, disabled = false, compact = false, onChange }: {
  value: string; suggestions: string[]; disabled?: boolean; compact?: boolean; onChange: (category: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const categories = [...new Set([value, ...suggestions].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const choose = (category: string) => { onChange(category); setOpen(false); setQuery(''); };
  const existing = categories.find(category => category.toLowerCase() === query.trim().toLowerCase());
  return <div className="relative" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }}>
    <button type="button" className={buttonClass + (compact ? ' !h-6 !min-h-0 !gap-1 !px-2 !py-0 !text-[11px] !leading-4' : ' !py-1')} disabled={disabled} aria-label="Category" aria-expanded={open} onClick={() => { setOpen(!open); setQuery(''); }}>{value || '+ Category'}<ChevronDown size={12} /></button>
    {open && <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-gray-700 bg-gray-900 p-2 shadow-xl">
      <input autoFocus aria-label="Search or create category" className={fieldClass + ' !py-1 !text-xs'} placeholder="Search or create…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && query.trim()) { event.preventDefault(); choose(existing || query.trim()); } }} />
      <div className="mt-1 max-h-48 overflow-y-auto">{categories.filter(category => category.toLowerCase().includes(query.trim().toLowerCase())).map(category => <button type="button" key={category} className="flex w-full items-center justify-between rounded p-2 text-left text-xs hover:bg-gray-800" onClick={() => choose(category)}>{category}{category === value && <Check size={12} />}</button>)}
        {query.trim() && !existing && <button type="button" className="w-full rounded p-2 text-left text-xs hover:bg-gray-800" onClick={() => choose(query.trim())}>Create “{query.trim()}”</button>}
        {value && <button type="button" className="w-full border-t border-gray-700 p-2 text-left text-xs" onClick={() => choose('')}>Remove category</button>}
      </div>
    </div>}
  </div>;
}

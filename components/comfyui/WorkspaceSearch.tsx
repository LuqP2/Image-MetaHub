import { useTranslation } from '../../i18n/useTranslation';
import React, { useRef } from 'react';
import { Search, X } from 'lucide-react';

export const workspaceCardClass = 'rounded border border-gray-800';
export const workspaceFieldClass = 'h-7 min-w-0 rounded border border-gray-800 bg-gray-950 px-2 text-xs text-gray-200 focus:border-accent focus:outline-none';
export const workspaceButtonClass = 'inline-flex h-7 items-center justify-center gap-1.5 rounded border border-gray-800 px-2 text-xs text-gray-300 hover:bg-gray-800 focus-visible:outline focus-visible:outline-accent disabled:opacity-40';

export default function WorkspaceSearch({ label, placeholder = label + '…', query, onChange }: {
  label: string;
  placeholder?: string;
  query: string;
  onChange: (query: string) => void;
}) {
  const { t, language } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  return <div className={workspaceFieldClass + ' flex items-center gap-1.5 focus-within:border-accent'}>
    <Search size={14} className="shrink-0 text-gray-400" />
    <input ref={inputRef} type="search" aria-label={label} placeholder={placeholder} value={query}
      className="min-w-0 flex-1 bg-transparent outline-none [&::-webkit-search-cancel-button]:hidden"
      onChange={event => onChange(event.target.value)}
    />
    {query && <button type="button" aria-label={t('integrations.clearSearch', { label: language === 'en' ? label.toLowerCase() : label })} className="rounded p-0.5 text-gray-400 hover:bg-gray-800 focus-visible:outline focus-visible:outline-accent"
      onClick={() => { onChange(''); inputRef.current?.focus(); }}><X size={14} /></button>}
  </div>;
}

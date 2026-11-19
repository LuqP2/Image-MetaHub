import { useTranslation } from '../../i18n/useTranslation';
import React from 'react';
import { Heart, X } from 'lucide-react';
import type { PromptLibraryItem } from '../../types';
import { emptyFilters, type PromptLibraryFilters } from '../../services/promptLibrary/search';
import { buttonClass, fieldClass } from './PromptVariables';

export default function PromptLibraryFiltersPanel({ all, filters, onChange, onClose, kind }: {
  all: PromptLibraryItem[]; filters: PromptLibraryFilters; onChange: (value: PromptLibraryFilters) => void; onClose: () => void; kind: 'prompt' | 'block';
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<PromptLibraryFilters>) => onChange({ ...filters, ...patch });
  const tags = [...new Set(all.flatMap(i => i.editor?.tags || []))].sort();
  const models = [...new Set(all.map(i => i.editor?.metadata.model || '').filter(Boolean))].sort();
  const categories = [...new Set(all.map(i => i.editor?.category || '').filter(Boolean))].sort();
  return <aside aria-label={t('promptLibrary.promptFilters')} className="flex h-full min-h-0 w-full flex-col rounded-xl border border-gray-700 bg-gray-900/50">
    <div className="flex items-center justify-between border-b border-gray-700 p-3"><h3 className="text-sm font-semibold">{t('promptLibrary.filters')}</h3><button className="app-top-icon-button" aria-label={t('promptLibrary.closeFilters')} onClick={onClose}><X size={16} /></button></div>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3 text-xs">
      <button aria-pressed={filters.favorite} className={`${buttonClass} w-full ${filters.favorite ? '!border-accent/40 !bg-accent/15 !text-gray-100' : ''}`} onClick={() => set({ favorite: !filters.favorite })}><Heart size={15} fill={filters.favorite ? 'currentColor' : 'none'} />{t('promptLibrary.favoritesOnly')}</button>
      {kind === 'prompt' && <label className="block space-y-1">{t('promptLibrary.type')}<select aria-label={t('promptLibrary.filterType')} className={fieldClass} value={filters.type} onChange={e => set({ type: e.target.value })}><option value="">{t('promptLibrary.allTypes')}</option><option value="prompt">{t('promptLibrary.prompts')}</option><option value="template">{t('promptLibrary.templates')}</option></select></label>}
      {tags.length > 0 && <section className="space-y-2"><h4 className="text-gray-400">{t('promptLibrary.tagsAny')}</h4><div className="flex flex-wrap gap-1.5">{tags.map(tag => <button key={tag} aria-pressed={filters.tags.includes(tag)} className={`rounded-full border px-2 py-1 ${filters.tags.includes(tag) ? 'border-accent/40 bg-accent/15 text-gray-100' : 'border-gray-700 text-gray-400'}`} onClick={() => set({ tags: filters.tags.includes(tag) ? filters.tags.filter(t => t !== tag) : [...filters.tags, tag] })}>{tag}</button>)}</div></section>}
      {models.length > 0 && <section className="space-y-2"><h4 className="text-gray-400">{t('promptLibrary.modelsAny')}</h4>{models.map(model => <label key={model} className="flex items-start gap-2 break-all"><input type="checkbox" checked={filters.models.includes(model)} onChange={() => set({ models: filters.models.includes(model) ? filters.models.filter(m => m !== model) : [...filters.models, model] })} />{model}</label>)}</section>}
      {kind === 'block' && <label className="block space-y-1">{t('promptLibrary.category')}<select aria-label={t('promptLibrary.filterCategory')} className={fieldClass} value={filters.category} onChange={e => set({ category: e.target.value })}><option value="">{t('promptLibrary.allCategories')}</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>}
      <details className="space-y-2"><summary className="cursor-pointer text-gray-400">{t('promptLibrary.dateRange')}</summary><label className="block pt-2">{t('promptLibrary.dateField')}<select aria-label={t('promptLibrary.dateField')} className={fieldClass} value={filters.dateField} onChange={e => set({ dateField: e.target.value as PromptLibraryFilters['dateField'] })}><option value="saved">{t('promptLibrary.saved')}</option><option value="updated">{t('promptLibrary.updated')}</option>{kind === 'prompt' && <option value="source">{t('promptLibrary.sourceDate')}</option>}</select></label><label className="block">{t('promptLibrary.from')}<input aria-label={t('promptLibrary.from')} type="date" className={fieldClass} value={filters.from} onChange={e => set({ from: e.target.value })} /></label><label className="block">{t('promptLibrary.to')}<input aria-label={t('promptLibrary.to')} type="date" className={fieldClass} value={filters.to} onChange={e => set({ to: e.target.value })} /></label></details>
    </div>
    <div className="border-t border-gray-700 p-3"><button className={buttonClass + ' w-full justify-center'} onClick={() => onChange({ ...emptyFilters, query: filters.query, sort: filters.sort, descending: filters.descending })}>{t('promptLibrary.resetFilters')}</button></div>
  </aside>;
}

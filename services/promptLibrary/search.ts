import type { PromptLibraryItem } from '../../types';
export const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
export const itemTitle = (item: PromptLibraryItem) => item.editor?.title || ('text' in item ? item.text : item.positivePrompt || item.negativePrompt).split('\n')[0].slice(0, 80);
export const itemType = (item: PromptLibraryItem) => 'text' in item ? 'block' : item.editor?.document?.mode === 'template' ? 'template' : 'prompt';
export interface PromptLibraryFilters {
  query: string;
  tags: string[];
  models: string[];
  type: string;
  favorite: boolean;
  category: string;
  dateField: 'saved' | 'updated' | 'source';
  from: string;
  to: string;
  sort: 'saved' | 'updated' | 'source' | 'title';
  descending: boolean;
}
export const emptyFilters: PromptLibraryFilters = { query: '', tags: [], models: [], type: '', favorite: false, category: '', dateField: 'saved', from: '', to: '', sort: 'saved', descending: true };
const searchCache = new WeakMap<PromptLibraryItem, string>();
export function searchText(item: PromptLibraryItem) {
  let text = searchCache.get(item);
  if(text === undefined) {
    text = fold([itemTitle(item), 'text' in item ? item.text : `${item.positivePrompt} ${item.negativePrompt}`, item.editor?.notes, ...(item.editor?.tags || []), item.editor?.category, ...Object.values(item.editor?.metadata || {}).flat()].join(' '));
    searchCache.set(item, text);
  }
  return text;
}
const date = (item: PromptLibraryItem, field: string) => field === 'updated' ? item.updatedAt || item.createdAt : field === 'source' ? ('sourceCreatedAt' in item ? item.sourceCreatedAt : null) : item.createdAt;
export function filterItems(items: PromptLibraryItem[], filters: PromptLibraryFilters) {
  const terms = [...filters.query.matchAll(/"([^"]+)"|(\S+)/g)].map((match) => fold(match[1] || match[2]));
  const start = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : null;
  const end = filters.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : null;
  return items.filter((item) => {
    const timestamp = date(item, filters.dateField);
    return terms.every((term) => searchText(item).includes(term))
      && (!filters.tags.length || filters.tags.some((tag) => item.editor?.tags.includes(tag)))
      && (!filters.models.length || filters.models.includes(item.editor?.metadata.model || ''))
      && (!filters.type || itemType(item) === filters.type) && (!filters.favorite || item.editor?.favorite)
      && (!filters.category || filters.category === item.editor?.category)
      && (start === null || (timestamp !== null && timestamp >= start)) && (end === null || (timestamp !== null && timestamp <= end));
  }).sort((a, b) => {
    if(filters.sort === 'title')
      return (filters.descending ? -1 : 1) * itemTitle(a).localeCompare(itemTitle(b)) || a.id.localeCompare(b.id);
    const left = date(a, filters.sort);
    const right = date(b, filters.sort);
    if(left == null || right == null)
      return left == null ? right == null ? a.id.localeCompare(b.id) : 1 : -1;
    return (filters.descending ? -1 : 1) * (left - right) || a.id.localeCompare(b.id);
  });
}

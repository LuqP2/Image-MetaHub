import { useEffect, useRef, useState } from 'react';
export interface BoardBrowseEntry { key: string; label: string; ids: string[] }
export function useBoardBrowse(resolve: (key: string) => BoardBrowseEntry | undefined) {
  const [key, setKey] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const scroll = useRef({ left: 0, top: 0 });
  const selected = key ? resolve(key) : undefined;
  useEffect(() => { if (key && !selected) { setKey(null); setNotice('The opened group is no longer available. Showing all groups.'); } }, [key, selected]);
  return { selected, scroll, notice, open: (entry: string) => { setNotice(''); setKey(entry); }, back: () => setKey(null) };
}
export function BoardBrowseHeader({ entry, back }: { entry: BoardBrowseEntry; back(): void }) {
  return <div className="board-browse-header"><button className="board-button" onClick={back}>Back to overview</button><strong tabIndex={0} title={entry.label}>{entry.label}</strong><span>{entry.ids.length.toLocaleString()} {entry.ids.length === 1 ? 'image' : 'images'}</span></div>;
}
export function BoardGroupSort({ value, change }: { value: 'count' | 'name'; change(value: 'count' | 'name'): void }) {
  return <label className="board-group-sort">Order groups<select className="board-input" value={value} onChange={event => change(event.target.value as 'count' | 'name')}><option value="count">Most images</option><option value="name">Name</option></select></label>;
}
export const compareBoardGroups = (order: 'count' | 'name') => (a: { count: number; label: string; key: string }, b: { count: number; label: string; key: string }) =>
  (order === 'count' ? b.count - a.count : 0) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key);

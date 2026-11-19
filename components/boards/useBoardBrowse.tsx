import { useBoardUIStore } from '../../store/useBoardUIStore';
import { useBoardStore } from '../../store/useBoardStore';
import { useBoardPresentation } from '../../i18n/useBoardPresentation';
import { useTranslation } from '../../i18n/useTranslation';
import { useEffect, useRef, useState } from 'react';
export interface BoardBrowseEntry { key: string; label: string; rawLabel?: string; ids: string[] }
export function useBoardBrowse(resolve: (key: string) => BoardBrowseEntry | undefined) {
  const { t } = useTranslation();
  const [key, setKey] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const scroll = useRef({ left: 0, top: 0 });
  const selected = key ? resolve(key) : undefined;
  useEffect(() => { if (key && !selected) { setKey(null); setNotice(true); } }, [key, selected]);
  return { selected, scroll, notice: notice ? t('canvas.groupGone') : '', open: (entry: string) => { setNotice(false); setKey(entry); }, back: () => setKey(null) };
}
export function BoardBrowseHeader({ frameId, entry, back }: { frameId: string; entry: BoardBrowseEntry; back(): void }) {
  const { t } = useTranslation();
  const { boardSourceLabel } = useBoardPresentation();
  const objects = useBoardStore(state => state.activeBoardId ? state.sessions[state.activeBoardId]?.document.objects : undefined);
  const frame = objects?.find(item => item.id === frameId);
  const path = `${frame?.type === 'smart-frame' ? boardSourceLabel(frame.source, objects) : t('canvas.frame')} › ${entry.label}`;
  return <div className="board-browse-header"><button className="board-button" onClick={back}>{t('canvas.backOverview')}</button><strong tabIndex={0} title={entry.rawLabel ?? path}>{path}</strong><span>{t('canvas.imagesCount', { count: entry.ids.length })}</span></div>;
}
export function BoardGroupSort({ value, change }: { value: 'count' | 'name'; change(value: 'count' | 'name'): void }) {
  const { t } = useTranslation();
  return <label className="board-group-sort">{t('canvas.orderGroups')}<select className="board-input" value={value} onChange={event => change(event.target.value as 'count' | 'name')}><option value="count">{t('canvas.mostImages')}</option><option value="name">{t('canvas.nameOrder')}</option></select></label>;
}
export const compareBoardGroups = (order: 'count' | 'name') => (a: { count: number; label: string; key: string }, b: { count: number; label: string; key: string }) =>
  (order === 'count' ? b.count - a.count : 0) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key);

export function useBoardGroupOrder(frameId: string) {
  const boardId = useBoardStore(state => state.activeBoardId);
  const key = `${boardId}:${frameId}`;
  const order = useBoardUIStore(state => state.groupOrders[key] ?? 'count');
  return [order, (value: 'count' | 'name') => useBoardUIStore.getState().setGroupOrder(key, value)] as const;
}

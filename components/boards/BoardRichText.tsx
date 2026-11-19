import { useTranslation } from '../../i18n/useTranslation';
import type { ReactNode } from 'react';

/** Plain text with clickable web URLs; editing remains a native textarea. */
export default function BoardRichText({ text }: { text: string }): ReactNode {
  const { t } = useTranslation();
  const pattern = /(?:https?:\/\/|www\.)[^\s<>]+/gi;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index!;
    let url = match[0].replace(/[.,;:!?'"]+$/, '');
    const brackets: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    while (brackets[url.at(-1)!] && url.split(url.at(-1)!).length > url.split(brackets[url.at(-1)!]).length) url = url.slice(0, -1);
    parts.push(text.slice(cursor, index));
    parts.push(<a key={index} className="board-inline-link" href={/^www\./i.test(url) ? `https://${url}` : url} target="_blank" rel="noreferrer" draggable={false} title={t('canvasFeedback.inlineUrlHint')} onClick={event => { event.stopPropagation(); if (!event.ctrlKey && !event.metaKey) event.preventDefault(); }}>{url}</a>);
    cursor = index + url.length;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

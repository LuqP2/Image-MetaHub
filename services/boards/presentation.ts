import type { Translate } from '../../i18n/useTranslation';
import { formatMessage } from '../../i18n/messages.mjs';
import type { BoardSetExpression, BoardSmartFrameObject, BoardGroupConstraint } from './queryTypes';
import type { BoardObject } from './types';

export function createBoardPresentation(t: Translate, language?: string) {
  /** Presentation only: raw metadata remains the identity of a group and its criteria. */
  function boardValueLabel(value: string): string {
    return /<(?:[^>]*\bobject at 0x[\da-f]+|class ['"][^>]+)[^>]*>/i.test(value) || value === '[object Object]' ? t('canvas.unidentifiedModel') : value;
  }
  function boardConstraintLabel(constraint: BoardGroupConstraint): string {
    if (constraint.kind === 'missing') return t('canvas.noValue');
    if (constraint.kind === 'session') return `${new Date(constraint.start).toLocaleString(language)} – ${new Date(constraint.endExclusive - 1).toLocaleString(language)}`;
    return constraint.dimension === 'rating' && Number.isFinite(Number(constraint.value)) ? t('canvas.stars', { count: Number(constraint.value) })
      : constraint.dimension === 'favorite' ? t(constraint.value === 'true' ? 'canvas.favorite' : 'canvas.notFavorite')
      : boardValueLabel(constraint.value);
  }
  function boardSourceLabel(source: BoardSetExpression, objects: BoardObject[] = []): string {
    switch (source.kind) {
      case 'library': return t('settings.library.library');
      case 'collection': return t('canvas.liveCollection');
      case 'snapshot': return t('canvas.snapshot');
      case 'query': return t('canvas.independentQuery');
      case 'frame': { const parent = objects.find((item): item is BoardSmartFrameObject => item.id === source.frameId && item.type === 'smart-frame'); return parent ? t('canvas.refines', { title: parent.title }) : t('canvas.sourceUnavailable'); }
      case 'intersection': return t('canvas.intersection');
      case 'difference': return t('canvas.difference');
    }
  }
  function boardSourceMode(source: BoardSetExpression): string {
    if (source.kind === 'snapshot') return t('canvas.snapshot');
    if (source.kind === 'query') return boardSourceMode(source.source);
    return source.kind === 'frame' || source.kind === 'intersection' || source.kind === 'difference' ? t('libraryGallery.linked') : t('canvas.dynamic');
  }

  function boardGroupLabel(group: { label: string; constraint: BoardGroupConstraint }): string {
    if (language && group.constraint.kind === 'exact' && group.constraint.dimension === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(group.constraint.value)) {
      return new Date(group.constraint.value + 'T00:00:00').toLocaleDateString(language);
    }
    return group.constraint.kind === 'missing' || (group.constraint.kind === 'session' && Boolean(language)) || (group.constraint.kind === 'exact' && ['rating', 'favorite'].includes(group.constraint.dimension))
      ? boardConstraintLabel(group.constraint) : boardValueLabel(group.label);
  }

  return { boardValueLabel, boardConstraintLabel, boardSourceLabel, boardSourceMode, boardGroupLabel };
}

const english: Translate = (key, values) => formatMessage('en', key, values);
export const { boardValueLabel, boardConstraintLabel, boardSourceLabel, boardSourceMode, boardGroupLabel } = createBoardPresentation(english);

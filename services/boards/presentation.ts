import type { BoardSetExpression, BoardSmartFrameObject, BoardGroupConstraint } from './queryTypes';
import type { BoardObject } from './types';

/** Presentation only: raw metadata remains the identity of a group and its criteria. */
export function boardValueLabel(value: string): string {
  return /<(?:[^>]*\bobject at 0x[\da-f]+|class ['"][^>]+)[^>]*>/i.test(value) || value === '[object Object]' ? 'Unidentified model' : value;
}
export function boardConstraintLabel(constraint: BoardGroupConstraint): string {
  if (constraint.kind === 'missing') return 'No value';
  if (constraint.kind === 'session') return `${new Date(constraint.start).toLocaleString()} – ${new Date(constraint.endExclusive - 1).toLocaleString()}`;
  return constraint.dimension === 'rating' ? `${constraint.value} ${constraint.value === '1' ? 'star' : 'stars'}` : boardValueLabel(constraint.value);
}
export function boardSourceLabel(source: BoardSetExpression, objects: BoardObject[] = []): string {
  switch (source.kind) {
    case 'library': return 'Library';
    case 'collection': return 'Live collection';
    case 'snapshot': return 'Snapshot';
    case 'query': return 'Independent query';
    case 'frame': { const parent = objects.find((item): item is BoardSmartFrameObject => item.id === source.frameId && item.type === 'smart-frame'); return parent ? `Refines “${parent.title}”` : 'Unavailable source frame'; }
    case 'intersection': return 'Intersection';
    case 'difference': return 'Difference';
  }
}
export function boardSourceMode(source: BoardSetExpression): string {
  if (source.kind === 'snapshot') return 'Snapshot';
  if (source.kind === 'query') return boardSourceMode(source.source);
  return source.kind === 'frame' || source.kind === 'intersection' || source.kind === 'difference' ? 'Linked' : 'Dynamic';
}

export function boardGroupLabel(group: { label: string; constraint: BoardGroupConstraint }): string {
  return group.constraint.dimension === 'rating' && group.constraint.kind === 'exact' ? boardConstraintLabel(group.constraint) : boardValueLabel(group.label);
}

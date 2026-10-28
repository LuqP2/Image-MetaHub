import type { BoardGroupConstraint } from './queryTypes';
import type { LibraryQueryImage } from '../libraryQuery/types';
import type { BoardGroupingContext } from './grouping';

export class BoardGroupingSourceMissing extends Error {}
export function compileGroupConstraints(constraints: BoardGroupConstraint[], context: BoardGroupingContext) {
  for (const constraint of constraints) if (constraint.kind === 'exact') {
    if (constraint.dimension === 'collection' && !Object.hasOwn(context.dataset.collections, constraint.value)) throw new BoardGroupingSourceMissing('The grouped collection is unavailable.');
    if (constraint.dimension === 'cluster' && !Object.hasOwn(context.dataset.clusters ?? {}, constraint.value)) throw new BoardGroupingSourceMissing('The grouped cluster is unavailable.');
  }
  return (image: LibraryQueryImage) => constraints.every(constraint => {
    if (constraint.kind === 'session') return image.lastModified >= constraint.start && image.lastModified < constraint.endExclusive;
    if (constraint.dimension === 'session') return constraint.kind === 'missing' ? !Number.isFinite(image.lastModified) : false;
    const values = context.values(image, constraint.dimension);
    return constraint.kind === 'missing' ? values.length === 0 : values.some(value => value.value === constraint.value);
  });
}

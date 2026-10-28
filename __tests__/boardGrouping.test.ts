import type { BoardSmartFrameObject } from '../services/boards/queryTypes';
import { describe, expect, it } from 'vitest';
import { buildBoardGroupedLayout, createGroupingContext, groupBoardImages, matrixCellKey, groupingLabels } from '../services/boards/grouping';
import { compileGroupConstraints } from '../services/boards/groupConstraints';
import type { BoardQueryDataset } from '../services/boards/queryProtocol';
import type { BoardGroupingDimension } from '../services/boards/queryTypes';
import { toLibraryQueryImage } from '../services/libraryQuery/dataset';
import { boardImage, boardDirectory } from './helpers/boardIntegrationFixtures';
import { SESSION_GAP_MS } from '../utils/imageGrouping';
import { createSmartFrame, branchSmartFrameGroup, updateSmartFrameLayout } from '../services/boards/smartFrameOperations';
import { createBoardDocument } from '../services/boards/document.mjs';
import { evaluateBoardQueries, createBoardEvaluationCache } from '../services/boards/queryEvaluator';

function fixture(): BoardQueryDataset {
  const a = toLibraryQueryImage({ ...boardImage('a.png'), models: ['Flux'], loras: ['A', 'B', 'A'], tags: ['No value', 'forest'], rating: 5, isFavorite: true, lastModified: 100 });
  const b = toLibraryQueryImage({ ...boardImage('b.png'), models: ['SDXL'], loras: [], tags: [], lastModified: 100 + SESSION_GAP_MS });
  return { images: [a, b], grouping: { [a.id]: { seed: '18446744073709551615', folder: 'C:/images' }, [b.id]: { seed: '18446744073709551614', folder: 'C:/images/sub' } },
    collections: { one: [a.id], two: [a.id] }, collectionLabels: { one: 'One', two: 'Two' }, clusters: { cluster: { label: 'Forest', imageIds: [a.id] } }, references: {},
    context: { visibleDirectories: [boardDirectory], safeMode: { enableSafeMode: false, blurSensitiveImages: false, sensitiveTags: [] } } };
}

describe('metadata grouping and constraints', () => {
  it.each(Object.keys(groupingLabels) as BoardGroupingDimension[])('branches exactly the members of each %s group', dimension => {
    const dataset = fixture(), context = createGroupingContext(dataset);
    const groups = groupBoardImages(dataset.images, dimension, context);
    for (const group of groups) {
      const accepts = compileGroupConstraints([group.constraint], context);
      expect(dataset.images.filter(accepts).map(image => image.id).sort()).toEqual(group.imageIds.slice().sort());
      expect(group.count).toBe(new Set(group.imageIds).size);
    }
  });
  it('separates a missing bucket from an actual value with the same display label', () => {
    const dataset = fixture(); dataset.images[0].models = ['No value']; dataset.images[1].models = [];
    const groups = groupBoardImages(dataset.images, 'model', createGroupingContext(dataset));
    expect(groups.filter(group => group.label === 'No value')).toHaveLength(2);
    expect(new Set(groups.map(group => group.key)).size).toBe(groups.length);
  });
  it('places multi-valued images in each group and preserves exact large seeds', () => {
    const dataset = fixture(), context = createGroupingContext(dataset);
    const loras = groupBoardImages(dataset.images, 'lora', context);
    expect(loras.find(group => group.label === 'A')?.count).toBe(1);
    expect(loras.find(group => group.label === 'B')?.count).toBe(1);
    expect(loras.reduce((sum, group) => sum + group.count, 0)).toBe(3);
    expect(groupBoardImages(dataset.images, 'seed', context).map(group => group.label)).toEqual(expect.arrayContaining(['18446744073709551615', '18446744073709551614']));
  });
  it('uses the existing 45-minute session gap and exclusive end boundaries', () => {
    const dataset = fixture(), context = createGroupingContext(dataset);
    expect(groupBoardImages(dataset.images, 'session', context)).toHaveLength(1);
    dataset.images[1].lastModified++;
    const groups = groupBoardImages(dataset.images, 'session', context);
    expect(groups).toHaveLength(2);
    const constraint = groups[0].constraint;
    expect(constraint.kind).toBe('session');
    if (constraint.kind === 'session') expect(compileGroupConstraints([constraint], context)({ ...dataset.images[0], lastModified: constraint.endExclusive })).toBe(false);
  });
  it('builds hierarchical groups and a sparse matrix with empty combinations derived', () => {
    const dataset = fixture(), context = createGroupingContext(dataset);
    const grouped = buildBoardGroupedLayout(dataset.images, { kind: 'groups', groupBy: 'model', subgroupBy: 'lora' }, context);
    expect(grouped?.kind).toBe('groups');
    if (grouped?.kind === 'groups') expect(grouped.groups.find(group => group.label === 'Flux')?.subgroups).toHaveLength(2);
    const matrix = buildBoardGroupedLayout(dataset.images, { kind: 'matrix', rows: 'lora', columns: 'model' }, context);
    if (matrix?.kind !== 'matrix') throw new Error('matrix');
    expect(Object.keys(matrix.cells)).toHaveLength(3);
    const row = matrix.rows.find(group => group.label === 'A')!, column = matrix.columns.find(group => group.label === 'SDXL')!;
    expect(matrix.cells[matrixCellKey(row.key, column.key)]).toBeUndefined();
  });
  it('does not allocate the Cartesian product for high-cardinality axes', () => {
    const dataset = fixture();
    dataset.images = Array.from({ length: 1000 }, (_, i) => ({ ...dataset.images[0], id: String(i), models: [`model-${i}`], loraNames: [`lora-${i}`] }));
    const matrix = buildBoardGroupedLayout(dataset.images, { kind: 'matrix', rows: 'lora', columns: 'model' }, createGroupingContext(dataset));
    if (matrix?.kind !== 'matrix') throw new Error('matrix');
    expect(matrix.rows.length * matrix.columns.length).toBe(1000000);
    expect(Object.keys(matrix.cells)).toHaveLength(1000);
  });
  it('keeps a cell branch independent of later parent layout changes and reuses filtered results', () => {
    const dataset = fixture(), cache = createBoardEvaluationCache();
    let document = createSmartFrame(createBoardDocument(), { id: 'parent', layout: { kind: 'matrix', rows: 'lora', columns: 'model' } });
    const first = evaluateBoardQueries(dataset, document.objects as BoardSmartFrameObject[], 1, 1, cache);
    const matrix = first.parent.grouped;
    if (matrix?.kind !== 'matrix') throw new Error('matrix');
    const row = matrix.rows.find(group => group.label === 'A')!, column = matrix.columns.find(group => group.label === 'Flux')!;
    document = branchSmartFrameGroup(document, 'parent', [row.constraint, column.constraint]);
    const childId = document.objects[1].id;
    document = updateSmartFrameLayout(document, 'parent', { kind: 'groups', groupBy: 'rating', subgroupBy: null });
    const second = evaluateBoardQueries(dataset, document.objects as BoardSmartFrameObject[], 1, 2, cache);
    expect(second[childId].imageIds).toEqual([dataset.images[0].id]);
    expect(second.parent.imageIds).toBe(first.parent.imageIds);
  });
  it('reports removed cluster or collection sources and respects Safe Mode in groups', () => {
    const dataset = fixture();
    let document = createSmartFrame(createBoardDocument(), { id: 'parent', layout: { kind: 'groups', groupBy: 'model', subgroupBy: null } });
    document = branchSmartFrameGroup(document, 'parent', [{ kind: 'exact', dimension: 'cluster', value: 'cluster' }]);
    delete dataset.clusters!.cluster;
    dataset.context.safeMode = { enableSafeMode: true, blurSensitiveImages: false, sensitiveTags: ['forest'] };
    const results = evaluateBoardQueries(dataset, document.objects as BoardSmartFrameObject[], 2, 1);
    expect(results[document.objects[1].id].status).toBe('source-missing');
    expect(results.parent.totalCount).toBe(1);
    if (results.parent.grouped?.kind === 'groups') expect(results.parent.grouped.groups.map(group => group.label)).toEqual(['SDXL']);
  });
});

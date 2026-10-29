import { describe, expect, it } from 'vitest';
import { createBoardDocument } from '../services/boards/document.mjs';
import { createSmartFrame, branchSmartFrame, intersectSmartFrames, subtractSmartFrames } from '../services/boards/smartFrameOperations';
import type { BoardSmartFrameObject } from '../services/boards/queryTypes';
import type { BoardQueryDataset } from '../services/boards/queryProtocol';
import { evaluateBoardQueries, createBoardEvaluationCache } from '../services/boards/queryEvaluator';
import { toLibraryQueryImage } from '../services/libraryQuery/dataset';
import { boardImage, boardDirectory } from './helpers/boardIntegrationFixtures';
import { normalizeLibraryQueryCriteria } from '../services/libraryQuery/criteria';
import { orderQueryFrames } from '../services/boards/queryGraph';

const a = boardImage('a.png'), b = boardImage('b.png');
const dataset = (): BoardQueryDataset => ({ images: [toLibraryQueryImage({ ...a, models: ['Flux'], tags: ['private'] }), toLibraryQueryImage({ ...b, models: ['SDXL'] })],
  context: { visibleDirectories: [{ id: boardDirectory.id, path: boardDirectory.path }], safeMode: { enableSafeMode: false, blurSensitiveImages: false, sensitiveTags: ['private'] } },
  collections: { selected: [a.id] }, references: {} });
const frames = () => {
  let document = createSmartFrame(createBoardDocument(), { id: 'all' });
  document = branchSmartFrame(document, 'all');
  const child = document.objects[1] as BoardSmartFrameObject;
  child.criteria = normalizeLibraryQueryCriteria({ selectedModels: ['Flux'] });
  return document.objects as BoardSmartFrameObject[];
};
describe('board query graph and evaluation', () => {
  it('orders parents before children and evaluates independent criteria on one revision', () => {
    const definitions = frames();
    expect(orderQueryFrames([...definitions].reverse()).map(frame => frame.id)).toEqual(definitions.map(frame => frame.id));
    const output = evaluateBoardQueries(dataset(), [...definitions].reverse(), 3, 7);
    expect(output.all.imageIds).toHaveLength(2);
    expect(output[definitions[1].id].imageIds).toEqual([a.id]);
    expect(Object.values(output).every(result => result.datasetRevision === 3 && result.queryRevision === 7)).toBe(true);
    definitions[0].criteria.selectedModels = ['SDXL'];
    expect(evaluateBoardQueries(dataset(), definitions, 3, 8)[definitions[1].id].totalCount).toBe(0);
  });
  it('does not broaden missing sources and rejects cyclic graphs', () => {
    const definitions = frames();
    definitions[0].source = { kind: 'collection', collectionId: 'removed' };
    const output = evaluateBoardQueries(dataset(), definitions, 1, 1);
    expect(output.all.status).toBe('source-missing');
    expect(output[definitions[1].id].status).toBe('source-missing');
    definitions[0].source = { kind: 'frame', frameId: definitions[1].id };
    expect(() => evaluateBoardQueries(dataset(), definitions, 1, 1)).toThrow();
  });
  it('deduplicates set operations and reflects live collection changes', () => {
    let document = createSmartFrame(createBoardDocument(), { id: 'all' });
    document = createSmartFrame(document, { id: 'collection', source: { kind: 'collection', collectionId: 'selected' } });
    document = intersectSmartFrames(document, ['all', 'collection']);
    document = subtractSmartFrames(document, 'all', 'collection');
    const definitions = document.objects as BoardSmartFrameObject[];
    const source = dataset(); source.collections.selected.push(a.id);
    const output = evaluateBoardQueries(source, definitions, 1, 1);
    expect(output[definitions[2].id].imageIds).toEqual([a.id]);
    expect(output[definitions[3].id].imageIds).toEqual([b.id]);
    source.collections.selected = [b.id];
    expect(evaluateBoardQueries(source, definitions, 2, 1).collection.imageIds).toEqual([b.id]);
  });
  it('applies global hiding to counts and facets before local criteria', () => {
    const source = dataset(); source.context.safeMode.enableSafeMode = true;
    const output = evaluateBoardQueries(source, frames(), 1, 1);
    expect(output.all.imageIds).toEqual([b.id]);
    expect(output.all.facets?.availableModels).toEqual(['SDXL']);
  });
  it('evaluates ten frames without modifying their definitions', () => {
    const definitions = Array.from({ length: 10 }, (_, index) => ({ ...frames()[0], id: `frame-${index}` }));
    const before = JSON.stringify(definitions);
    expect(Object.keys(evaluateBoardQueries(dataset(), definitions, 1, 1))).toHaveLength(10);
    expect(JSON.stringify(definitions)).toBe(before);
  });
});

it('reuses equivalent query results and invalidates cache on a dataset change', () => {
  const cache = createBoardEvaluationCache();
  const source = dataset();
  const definitions = frames();
  const first = evaluateBoardQueries(source, definitions, 1, 1, cache);
  const second = evaluateBoardQueries(source, definitions, 1, 2, cache);
  expect(second.all.imageIds).toBe(first.all.imageIds);
  const changed = { ...source, images: source.images.slice(1) };
  const third = evaluateBoardQueries(changed, definitions, 2, 2, cache);
  expect(third.all.imageIds).not.toBe(first.all.imageIds);
  expect(third.all.imageIds).toEqual([b.id]);
});

it('explores Flux through LoRA A, LoRA B and neither without changing sibling queries', () => {
  const source = dataset();
  const first = source.images[0];
  source.images = [
    { ...first, id: 'a', models: ['Flux'], loraNames: ['A'], tags: [] },
    { ...first, id: 'b', models: ['Flux'], loraNames: ['B'], tags: [] },
    { ...first, id: 'both', models: ['Flux'], loraNames: ['A', 'B'], tags: [] },
    { ...first, id: 'neither', models: ['Flux'], loraNames: [], tags: [] },
    { ...first, id: 'sdxl', models: ['SDXL'], loraNames: ['A'], tags: [] },
  ];
  let document = createSmartFrame(createBoardDocument(), { id: 'flux', criteria: normalizeLibraryQueryCriteria({ selectedModels: ['Flux'] }) });
  for (const [id, criteria] of [['a-set', { selectedLoras: ['A'] }], ['b-set', { selectedLoras: ['B'] }], ['neither-set', { excludedLoras: ['A', 'B'] }]] as const) {
    document = createSmartFrame(document, { id, source: { kind: 'frame', frameId: 'flux' }, criteria: normalizeLibraryQueryCriteria(JSON.parse(JSON.stringify(criteria))) });
  }
  document = intersectSmartFrames(document, ['a-set', 'b-set']);
  document = subtractSmartFrames(document, 'a-set', 'b-set');
  const output = evaluateBoardQueries(source, document.objects as BoardSmartFrameObject[], 1, 1);
  expect(output.flux.totalCount).toBe(4);
  expect(output['a-set'].imageIds.slice().sort()).toEqual(['a', 'both']);
  expect(output['b-set'].imageIds.slice().sort()).toEqual(['b', 'both']);
  expect(output['neither-set'].imageIds).toEqual(['neither']);
  expect(output[document.objects[4].id].imageIds).toEqual(['both']);
  expect(output[document.objects[5].id].imageIds).toEqual(['a']);
});

it('counts facets in the visible source before local filtering and shares them between layouts', () => {
  const source = dataset(); const definitions = frames();
  definitions[0].criteria.selectedModels = ['Flux'];
  const cache = createBoardEvaluationCache();
  const result = evaluateBoardQueries(source, definitions, 1, 1, cache);
  expect(result.all.imageIds).toEqual([a.id]);
  expect(result.all.facets?.sourceCounts?.Models).toEqual(expect.arrayContaining([['SDXL', 1], ['Flux', 1]]));
  definitions[0].layout = { kind: 'matrix', rows: 'generator', columns: 'rating' };
  const next = evaluateBoardQueries(source, definitions, 1, 2, cache);
  expect(next.all.facets).toBe(result.all.facets);
  source.context.safeMode.enableSafeMode = true;
  const hidden = evaluateBoardQueries({ ...source }, definitions, 2, 3, cache);
  expect(hidden.all.facets?.sourceCounts?.Models).toEqual([['SDXL', 1]]);
});

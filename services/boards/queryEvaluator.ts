import { buildBoardGroupedLayout, createGroupingContext } from './grouping';
import { compileGroupConstraints, BoardGroupingSourceMissing } from './groupConstraints';
import type { BoardQueryFrame } from './queryProtocol';
import { executeLibraryQuery } from '../libraryQuery/execute';
import type { LibraryQueryImage } from '../libraryQuery/types';
import type { BoardSetExpression, BoardSmartFrameObject } from './queryTypes';
import type { BoardQueryDataset, BoardQueryResult } from './queryProtocol';
import { orderQueryFrames } from './queryGraph';

class MissingSource extends Error {}
interface ResolvedSet { ids: Set<string>; unavailable: number }
export interface BoardEvaluationCache { dataset: BoardQueryDataset | null; entries: Map<string, ReturnType<typeof executeLibraryQuery>>; sourceFacets?: Map<string, import('./queryProtocol').BoardQueryFacets> }
export const createBoardEvaluationCache = (): BoardEvaluationCache => ({ dataset: null, entries: new Map() });

export function evaluateBoardQueries(dataset: BoardQueryDataset, frames: BoardQueryFrame[], datasetRevision: number, queryRevision: number, cache = createBoardEvaluationCache()): Record<string, BoardQueryResult> {
  if (cache.dataset !== dataset) { cache.dataset = dataset; cache.entries.clear(); cache.sourceFacets = new Map(); }
  const nextEntries: BoardEvaluationCache['entries'] = new Map();
  const nextFacets = new Map<string, import('./queryProtocol').BoardQueryFacets>();
  const groupingContext = createGroupingContext(dataset);
  const images = new Map(dataset.images.map(image => [image.id, image]));
  const results: Record<string, BoardQueryResult> = Object.create(null);
  const evaluateQuery = (source: ResolvedSet, criteria: BoardSmartFrameObject['criteria'], constraints: BoardSmartFrameObject['groupConstraints']) => {
    const acceptsGroup = compileGroupConstraints(constraints, groupingContext);
    const key = JSON.stringify([[...source.ids], criteria, constraints]);
    const cached = nextEntries.get(key) ?? cache.entries.get(key);
    if (cached) { nextEntries.set(key, cached); return cached; }
    const candidates = [...source.ids].map(id => images.get(id)).filter((image): image is LibraryQueryImage => !!image && acceptsGroup(image));
    const computed = executeLibraryQuery(candidates, criteria, dataset.context);
    nextEntries.set(key, computed);
    return computed;
  };
  const resolve = (source: BoardSetExpression): ResolvedSet => {
    switch (source.kind) {
      case 'library': return { ids: new Set(images.keys()), unavailable: 0 };
      case 'collection': {
        if (!Object.hasOwn(dataset.collections, source.collectionId)) throw new MissingSource('The source collection is unavailable.');
        return { ids: new Set(dataset.collections[source.collectionId]), unavailable: 0 };
      }
      case 'snapshot': {
        const ids = new Set<string>(); let unavailable = 0;
        for (const reference of source.references) {
          const id = dataset.references[JSON.stringify(reference)];
          if (id && images.has(id)) ids.add(id); else unavailable++;
        }
        return { ids, unavailable };
      }
      case 'frame': {
        const parent = results[source.frameId];
        if (!parent || parent.status === 'source-missing') throw new MissingSource('The source frame is unavailable.');
        if (parent.status !== 'ready') throw new Error(parent.error ?? 'The source frame could not be evaluated.');
        return { ids: new Set(parent.imageIds), unavailable: parent.unavailableReferences };
      }
      case 'intersection': {
        const sets = source.inputs.map(resolve);
        return { ids: new Set([...sets[0].ids].filter(id => sets.every(set => set.ids.has(id)))), unavailable: sets.reduce((count, set) => count + set.unavailable, 0) };
      }
      case 'difference': {
        const left = resolve(source.left), right = resolve(source.right);
        return { ids: new Set([...left.ids].filter(id => !right.ids.has(id))), unavailable: left.unavailable };
      }
      case 'query': {
        const resolved = resolve(source.source);
        return { ids: new Set(evaluateQuery(resolved, source.criteria, source.groupConstraints).imageIds), unavailable: resolved.unavailable };
      }
    }
  };
  for (const frame of orderQueryFrames(frames)) {
    const base = { definitionKey: JSON.stringify({ source: frame.source, criteria: frame.criteria, groupConstraints: frame.groupConstraints }), frameId: frame.id, datasetRevision, queryRevision, imageIds: [], totalCount: 0, unavailableReferences: 0 };
    try {
      const source = resolve(frame.source);
      const result = evaluateQuery(source, frame.criteria, frame.groupConstraints);
      const sourceResult = evaluateQuery(source, { ...frame.criteria,
        searchQuery: '', selectedModels: [], excludedModels: [], selectedLoras: [], excludedLoras: [], selectedSamplers: [], excludedSamplers: [], selectedSchedulers: [], excludedSchedulers: [], selectedGenerators: [], excludedGenerators: [], selectedGpuDevices: [], excludedGpuDevices: [], selectedTags: [], excludedTags: [], selectedAutoTags: [], excludedAutoTags: [], favoriteFilterMode: 'neutral', selectedRatings: [], advancedFilters: {}, selectedFolders: [], excludedFolders: [] }, []);
      const sourceKey = JSON.stringify(sourceResult.imageIds);
      let sourceFacets = nextFacets.get(sourceKey) ?? cache.sourceFacets?.get(sourceKey);
      if (!sourceFacets) {
        const counts: Record<string, Map<string, number>> = Object.fromEntries(['Models', 'Loras', 'Samplers', 'Schedulers', 'Generators', 'GpuDevices', 'Tags', 'AutoTags', 'Folders'].map(key => [key, new Map<string, number>()]));
        for (const id of sourceResult.imageIds) {
          const image = images.get(id)!;
          const values: Record<string, string[]> = { Models: image.models, Loras: image.loraNames, Samplers: [image.sampler], Schedulers: [image.scheduler], Generators: [image.generator], GpuDevices: [image.gpuDevice ?? ''], Tags: image.tags, AutoTags: image.autoTags, Folders: [dataset.grouping?.[id]?.folder ?? ''] };
          for (const [dimension, entries] of Object.entries(values)) for (const value of new Set(entries)) if (value) counts[dimension].set(value, (counts[dimension].get(value) ?? 0) + 1);
        }
        sourceFacets = { ...sourceResult.facets, sourceCounts: Object.fromEntries(Object.entries(counts).map(([key, counts]) => [key, [...counts]])) };
      }
      nextFacets.set(sourceKey, sourceFacets);
      const grouped = buildBoardGroupedLayout(result.imageIds.map(id => images.get(id)!), frame.layout ?? { kind: 'grid' }, groupingContext);
      results[frame.id] = { ...base, ...result, grouped, status: 'ready', unavailableReferences: source.unavailable, facets: sourceFacets };
    } catch (error) {
      results[frame.id] = { ...base, status: error instanceof MissingSource || error instanceof BoardGroupingSourceMissing ? 'source-missing' : 'error', error: error instanceof Error ? error.message : String(error) };
    }
  }
  cache.entries = nextEntries;
  cache.sourceFacets = nextFacets;
  return results;
}

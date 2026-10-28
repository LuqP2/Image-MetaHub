import { vi } from 'vitest';
import * as searchText from '../utils/imageSearchText';
import { toLazyLibraryQueryImage } from '../services/libraryQuery/dataset';
import { compileWorkerPredicate } from '../services/libraryQuery/predicates';
import { createLibraryQueryKey, normalizeLibraryQueryCriteria } from '../services/libraryQuery/criteria';
import { describe, expect, it } from 'vitest';
import { toLibraryQueryImage } from '../services/libraryQuery/dataset';
import { executeWorkerQuery } from '../services/libraryQuery/execute';
import type { LibraryWorkerCriteria } from '../services/libraryQuery/types';
import type { IndexedImage } from '../types';

function criteria(overrides: Partial<LibraryWorkerCriteria> = {}): LibraryWorkerCriteria {
  return {
    searchQuery: '', selectedModels: [], excludedModels: [], selectedLoras: [], excludedLoras: [],
    selectedSamplers: [], excludedSamplers: [], selectedSchedulers: [], excludedSchedulers: [],
    selectedGenerators: [], excludedGenerators: [], selectedGpuDevices: [], excludedGpuDevices: [],
    selectedTags: [], excludedTags: [], selectedAutoTags: [], excludedAutoTags: [], selectedTagsMatchMode: 'any',
    favoriteFilterMode: 'neutral', selectedRatings: [], advancedFilters: {}, sortOrder: 'date-desc', randomSeed: 42,
    selectedFolders: [], excludedFolders: [], includeSubfolders: true,
    visibleDirectories: [{ id: 'root', path: 'D:/images' }],
    safeMode: { enableSafeMode: false, blurSensitiveImages: false, sensitiveTags: [] }, ...overrides,
  };
}
function image(id: string, overrides: Partial<IndexedImage> = {}) {
  return toLibraryQueryImage({ id, name: `${id}.png`, directoryId: 'root', lastModified: 100,
    models: ['Flux'], loras: [], tags: [], autoTags: [], ...overrides } as IndexedImage);
}
const images = [image('a', { tags: ['forest', 'private'], rating: 5, isFavorite: true, lastModified: 200 }),
  image('b', { models: ['SDXL'], tags: ['forest'], rating: 4 }), image('c', { tags: ['portrait'] })];
const ids = (overrides: Partial<LibraryWorkerCriteria>) => executeWorkerQuery(images, criteria(overrides)).filteredIds;

describe('shared library query execution', () => {
  it('keeps independent criteria and never changes the dataset', () => {
    const before = JSON.stringify(images);
    expect(ids({ selectedModels: ['Flux'] })).toEqual(['a', 'c']);
    expect(ids({ selectedModels: ['SDXL'] })).toEqual(['b']);
    expect(ids({})).toEqual(['a', 'b', 'c']);
    expect(JSON.stringify(images)).toBe(before);
  });
  it('combines inclusion, exclusion, ratings and favorites', () => {
    expect(ids({ selectedTags: ['forest'], excludedModels: ['SDXL'], selectedRatings: [5] })).toEqual(['a']);
    expect(ids({ favoriteFilterMode: 'exclude' })).toEqual(['b', 'c']);
    expect(ids({ selectedTags: ['forest', 'private'], selectedTagsMatchMode: 'all' })).toEqual(['a']);
  });
  it('applies safe mode before reporting results and facets', () => {
    const result = executeWorkerQuery(images, criteria({ safeMode: {
      enableSafeMode: true, blurSensitiveImages: false, sensitiveTags: ['private'],
    } }));
    expect(result.filteredIds).toEqual(['b', 'c']);
    expect(result.facets.modelFacetCounts).toEqual([['SDXL', 1], ['Flux', 1]]);
    expect(ids({ safeMode: { enableSafeMode: true, blurSensitiveImages: true, sensitiveTags: ['private'] } })).toContain('a');
  });
  it('preserves deterministic random ordering and scope restrictions', () => {
    expect(ids({ sortOrder: 'random' })).toEqual(ids({ sortOrder: 'random' }));
    expect(ids({ visibleDirectories: [] })).toEqual([]);
  });
});


describe('execution path equivalence', () => {
  it.each([
    {}, { selectedModels: ['Flux'] }, { excludedModels: ['Flux'] },
    { selectedTags: ['forest'], excludedTags: ['private'] },
    { selectedRatings: [4, 5] }, { advancedFilters: { steps: { min: 10 } } },
    { selectedFolders: ['D:/images'], includeSubfolders: false },
    { safeMode: { enableSafeMode: true, blurSensitiveImages: false, sensitiveTags: ['private'] } },
    { searchQuery: 'forest' },
  ] as Partial<LibraryWorkerCriteria>[])('shares full and per-image membership: %j', overrides => {
    const query = criteria(overrides);
    const expected = executeWorkerQuery(images, query).filteredIds.slice().sort();
    expect(images.filter(compileWorkerPredicate(query)).map(image => image.id).sort()).toEqual(expected);
  });
  it('captures detached criteria and canonicalizes object keys', () => {
    const original = normalizeLibraryQueryCriteria({ selectedModels: ['Flux'] });
    const copy = normalizeLibraryQueryCriteria(original);
    copy.selectedModels.push('SDXL');
    expect(original.selectedModels).toEqual(['Flux']);
    expect(createLibraryQueryKey(original)).toBe(createLibraryQueryKey({ ...original, advancedFilters: {} }));
  });
});

describe('lazy synchronous adaptation', () => {
  it('does not build text, metadata or resource arrays without matching predicates', () => {
    const catalog = vi.spyOn(searchText, 'buildCatalogSearchText');
    const compact = vi.spyOn(searchText, 'buildCompactSearchText');
    try {
      const source = { id: 'lazy', name: 'lazy.png', directoryId: 'root', lastModified: 1,
        get metadata() { throw new Error('metadata must remain lazy'); },
        get models() { throw new Error('models must remain lazy'); },
      } as unknown as IndexedImage;
      expect(compileWorkerPredicate(criteria())(toLazyLibraryQueryImage(source))).toBe(true);
      expect(compileWorkerPredicate(criteria({ visibleDirectories: [] }))(toLazyLibraryQueryImage(source))).toBe(false);
      expect(compileWorkerPredicate(criteria({ favoriteFilterMode: 'include' }))(toLazyLibraryQueryImage(source))).toBe(false);
      expect(catalog).not.toHaveBeenCalled();
      expect(compact).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); }
  });
  it('evaluates text only when reached and memoizes each field', () => {
    const catalog = vi.spyOn(searchText, 'buildCatalogSearchText');
    try {
      const record = toLazyLibraryQueryImage({ id: 'lazy', name: 'forest.png', directoryId: 'root' } as IndexedImage);
      expect(compileWorkerPredicate(criteria({ searchQuery: 'forest' }))(record)).toBe(true);
      expect(record.catalogText).toContain('forest');
      expect(catalog).toHaveBeenCalledTimes(1);
    } finally { vi.restoreAllMocks(); }
  });
});

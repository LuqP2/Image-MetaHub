import { compileWorkerPredicate } from './predicates';
import type { LibraryQueryImage, LibraryWorkerCriteria, LibraryQueryResult } from './types';

const collator = new Intl.Collator(undefined, { sensitivity: 'accent' });

const caseInsensitiveSort = (a: string, b: string) =>
  collator.compare(a, b);

const stringHash = (str: string) => {
  let hash = 0;
  for (let index = 0; index < str.length; index += 1) {
    const char = str.charCodeAt(index);
    hash = ((hash << 5) - hash) + char;
    hash &= hash;
  }
  return hash;
};

const compareById = (a: Pick<LibraryQueryImage, 'id' | 'name' | 'lastModified'>, b: Pick<LibraryQueryImage, 'id' | 'name' | 'lastModified'>) =>
  collator.compare(a.id, b.id);

const compareByNameAsc = (a: Pick<LibraryQueryImage, 'id' | 'name' | 'lastModified'>, b: Pick<LibraryQueryImage, 'id' | 'name' | 'lastModified'>) => {
  const nameComparison = collator.compare(a.name || '', b.name || '');
  return nameComparison !== 0 ? nameComparison : compareById(a, b);
};

const compareByNameDesc = (a: Pick<LibraryQueryImage, 'id' | 'name' | 'lastModified'>, b: Pick<LibraryQueryImage, 'id' | 'name' | 'lastModified'>) => {
  const nameComparison = collator.compare(b.name || '', a.name || '');
  return nameComparison !== 0 ? nameComparison : compareById(a, b);
};

const compareByDateAsc = (a: Pick<LibraryQueryImage, 'id' | 'name' | 'lastModified'>, b: Pick<LibraryQueryImage, 'id' | 'name' | 'lastModified'>) => {
  const dateComparison = a.lastModified - b.lastModified;
  return dateComparison !== 0 ? dateComparison : compareByNameAsc(a, b);
};

const compareByDateDesc = (a: Pick<LibraryQueryImage, 'id' | 'name' | 'lastModified'>, b: Pick<LibraryQueryImage, 'id' | 'name' | 'lastModified'>) => {
  const dateComparison = b.lastModified - a.lastModified;
  return dateComparison !== 0 ? dateComparison : compareByNameAsc(a, b);
};

export function executeWorkerQuery(workerImages: readonly LibraryQueryImage[], criteria: LibraryWorkerCriteria): LibraryQueryResult {
  const accepts = compileWorkerPredicate(criteria);
  const results: LibraryQueryImage[] = [];

  // Facet collection variables
  const generatorsFacet = new Set<string>();
  const gpuDevicesFacet = new Set<string>();
  const dimensionsFacet = new Set<string>();
  const modelFacetCounts = new Map<string, number>();
  const loraFacetCounts = new Map<string, number>();
  const samplerFacetCounts = new Map<string, number>();
  const schedulerFacetCounts = new Map<string, number>();

  for (let i = 0; i < workerImages.length; i++) {
    const image = workerImages[i];
    if (!accepts(image)) continue;
    // --- ALL FILTERS PASSED ---
    results.push(image);

    // Update Facets
    for (let j = 0; j < image.models.length; j++) {
      const model = image.models[j];
      modelFacetCounts.set(model, (modelFacetCounts.get(model) ?? 0) + 1);
    }
    for (let j = 0; j < image.loraNames.length; j++) {
      const lora = image.loraNames[j];
      loraFacetCounts.set(lora, (loraFacetCounts.get(lora) ?? 0) + 1);
    }
    if (image.sampler) {
      samplerFacetCounts.set(image.sampler, (samplerFacetCounts.get(image.sampler) ?? 0) + 1);
    }
    if (image.scheduler) {
      schedulerFacetCounts.set(image.scheduler, (schedulerFacetCounts.get(image.scheduler) ?? 0) + 1);
    }
    generatorsFacet.add(image.generator);
    if (image.gpuDevice) gpuDevicesFacet.add(image.gpuDevice);
    if (image.dimensions && image.dimensions !== '0x0') dimensionsFacet.add(image.dimensions);
  }

  results.sort(createLibraryComparator(criteria.sortOrder, criteria.randomSeed));

  return {
    filteredIds: results.map(img => img.id),
    facets: {
      availableModels: Array.from(modelFacetCounts.keys()).sort(caseInsensitiveSort),
      availableLoras: Array.from(loraFacetCounts.keys()).sort(caseInsensitiveSort),
      availableSamplers: Array.from(samplerFacetCounts.keys()).sort(caseInsensitiveSort),
      availableSchedulers: Array.from(schedulerFacetCounts.keys()).sort(caseInsensitiveSort),
      availableGenerators: Array.from(generatorsFacet).sort(caseInsensitiveSort),
      availableGpuDevices: Array.from(gpuDevicesFacet).sort(caseInsensitiveSort),
      availableDimensions: Array.from(dimensionsFacet).sort((a, b) => {
        const [aWidth, aHeight] = a.split('x').map(Number);
        const [bWidth, bHeight] = b.split('x').map(Number);
        return (aWidth * aHeight) - (bWidth * bHeight);
      }),
      modelFacetCounts: Array.from(modelFacetCounts.entries()),
      loraFacetCounts: Array.from(loraFacetCounts.entries()),
      samplerFacetCounts: Array.from(samplerFacetCounts.entries()),
      schedulerFacetCounts: Array.from(schedulerFacetCounts.entries()),
    },
  };
}


export function executeLibraryQuery(
  images: readonly LibraryQueryImage[],
  criteria: import('./types').LibraryQueryCriteria,
  context: import('./types').LibraryQueryExecutionContext,
) {
  const result = executeWorkerQuery(images, { ...criteria, ...context });
  return { imageIds: result.filteredIds, totalCount: result.filteredIds.length, facets: result.facets };
}

export function createLibraryComparator(sortOrder: LibraryWorkerCriteria['sortOrder'], randomSeed: number) {
  if (sortOrder === 'random') {
    const hashes = new Map<string, number>();
    return (a: Pick<LibraryQueryImage, 'id' | 'name' | 'lastModified'>, b: Pick<LibraryQueryImage, 'id' | 'name' | 'lastModified'>) => {
      for (const image of [a, b]) if (!hashes.has(image.id)) hashes.set(image.id, stringHash(image.id + (randomSeed || 0).toString()));
      return hashes.get(a.id)! - hashes.get(b.id)! || collator.compare(a.id, b.id);
    };
  }
  return sortOrder === 'asc' ? compareByNameAsc : sortOrder === 'desc' ? compareByNameDesc
    : sortOrder === 'date-asc' ? compareByDateAsc : sortOrder === 'date-desc' ? compareByDateDesc : compareById;
}

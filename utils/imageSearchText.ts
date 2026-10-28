import type { IndexedImage } from '../types';
import { MAX_SEARCH_TEXT_LENGTH } from './imageSearchQuery';
import { normalizeFacetValue } from './facetNormalization';
import { getImageGenerator, getImageGpuDevice } from './analyticsUtils';
const getRelativeImagePath = (image: IndexedImage): string => {
    if (!image?.id) return image?.name ?? '';
    if (image.directoryId) {
        const prefix = `${image.directoryId}::`;
        if (image.id.startsWith(prefix)) {
            return image.id.slice(prefix.length) || image.name;
        }
    }

    const sepIndex = image.id.lastIndexOf('::');
    const relative = sepIndex === -1 ? '' : image.id.slice(sepIndex + 2);
    return relative || image.name;
};

// Memoized by object identity, so that repeated filterAndSort /
// buildSearchWorkerDataset passes (e.g. one per keystroke of a search query)
// don't rebuild the same strings for the whole library.
//
// LOAD-BEARING INVARIANT: IndexedImage objects are treated as immutable —
// every content change must produce a *new* object. That holds today across
// every producer (sanitizeIndexedImageFacets and applyAnnotationsToImages
// return the input unchanged when nothing differs and a spread copy when it
// does; processEnrichmentResult, updateImage, the tag/auto-tag actions and the
// cache loader all spread as well), which is why no manual invalidation is
// needed. If any path ever mutates an image in place instead, these caches
// will silently serve stale text and search will return wrong results with no
// other symptom — see the regression test in useImageStore.filters.test.ts.
const catalogSearchTextCache = new WeakMap<IndexedImage, string>();
const compactSearchTextCache = new WeakMap<IndexedImage, string>();

export const buildCatalogSearchText = (image: IndexedImage): string => {
    const cached = catalogSearchTextCache.get(image);
    if (cached !== undefined) {
        return cached;
    }
    const relativePath = getRelativeImagePath(image).replace(/\\/g, '/').toLowerCase();
    const name = (image.name || '').toLowerCase();
    const directory = (image.directoryName || '').replace(/\\/g, '/').toLowerCase();
    const text = [name, relativePath, directory].filter(Boolean).join(' ');
    catalogSearchTextCache.set(image, text);
    return text;
};

export const buildCompactSearchTextUncached = (image: IndexedImage): string => {
    const segments: string[] = [];
    const pushValue = (value: unknown) => {
        if (typeof value === 'number') {
            segments.push(String(value));
            return;
        }

        if (typeof value !== 'string') {
            return;
        }

        const normalized = value.trim().toLowerCase();
        if (normalized) {
            segments.push(normalized);
        }
    };

    pushValue(image.prompt);
    pushValue(image.negativePrompt);

    const models = image.models;
    if (models) {
        for (let i = 0; i < models.length; i++) {
            pushValue(normalizeFacetValue(models[i]));
        }
    }

    const loras = image.loras;
    if (loras) {
        for (let i = 0; i < loras.length; i++) {
            pushValue(normalizeFacetValue(loras[i]));
        }
    }

    pushValue(normalizeFacetValue(image.sampler));
    pushValue(normalizeFacetValue(image.scheduler));
    pushValue(image.board);
    pushValue(getImageGenerator(image));
    pushValue(normalizeFacetValue(image.dimensions));

    if (typeof image.seed === 'number') {
        pushValue(image.seed);
    }
    if (typeof image.steps === 'number') {
        pushValue(image.steps);
    }
    if (typeof image.cfgScale === 'number') {
        pushValue(image.cfgScale);
    }

    const tags = image.tags;
    if (tags) {
        for (let i = 0; i < tags.length; i++) {
            pushValue(tags[i]);
        }
    }

    const autoTags = image.autoTags;
    if (autoTags) {
        for (let i = 0; i < autoTags.length; i++) {
            pushValue(autoTags[i]);
        }
    }

    const workflowNodes = image.workflowNodes;
    if (workflowNodes) {
        for (let i = 0; i < workflowNodes.length; i++) {
            pushValue(workflowNodes[i]);
        }
    }

    pushValue(getImageGpuDevice(image));

    const searchText = segments.join(' ');
    if (searchText.length <= MAX_SEARCH_TEXT_LENGTH) {
        return searchText;
    }

    return searchText.slice(0, MAX_SEARCH_TEXT_LENGTH);
};

export const buildCompactSearchText = (image: IndexedImage): string => {
    const cached = compactSearchTextCache.get(image);
    if (cached !== undefined) {
        return cached;
    }
    const text = buildCompactSearchTextUncached(image);
    compactSearchTextCache.set(image, text);
    return text;
};

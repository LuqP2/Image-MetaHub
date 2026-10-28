import type { IndexedImage } from '../../types';
import type { LibraryQueryImage } from './types';
import { buildCatalogSearchText, buildCompactSearchText } from '../../utils/imageSearchText';
import { normalizeFacetValue } from '../../utils/facetNormalization';
import { getImageGenerator, getImageGpuDevice, hasTelemetryData } from '../../utils/analyticsUtils';
import { hasVerifiedTelemetry } from '../../utils/telemetryDetection';
import { resolveMediaType } from '../../utils/mediaTypes.js';

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

const getImageAnalyticsSnapshot = (image: IndexedImage) => {
    return image.metadata?.normalizedMetadata?.analytics ??
        (image.metadata?.normalizedMetadata as { _analytics?: Record<string, unknown> } | undefined)?._analytics ??
        null;
};

const getImageGenerationType = (image: IndexedImage): 'txt2img' | 'img2img' | null => {
    const generationType = image.metadata?.normalizedMetadata?.generationType;
    return generationType === 'txt2img' || generationType === 'img2img' ? generationType : null;
};

export const toLibraryQueryImage = (image: IndexedImage): LibraryQueryImage => {
    const analytics = getImageAnalyticsSnapshot(image);
    const generationTimeMs = typeof analytics?.generation_time_ms === 'number' ? analytics.generation_time_ms : null;
    const stepsPerSecond = typeof analytics?.steps_per_second === 'number' ? analytics.steps_per_second : null;
    const vramPeakMb = typeof analytics?.vram_peak_mb === 'number' ? analytics.vram_peak_mb : null;
    const relativePath = getRelativeImagePath(image);
    const metadataMediaType = image.metadata?.normalizedMetadata?.media_type;
    const inferredMediaType = resolveMediaType(image.name, image.fileType);
    const mediaType =
        metadataMediaType === 'video' || metadataMediaType === 'audio' || metadataMediaType === 'model3d' || metadataMediaType === 'image'
            ? metadataMediaType
            : inferredMediaType === 'video' || inferredMediaType === 'audio' || inferredMediaType === 'model3d'
                ? inferredMediaType
                : 'image';

    return {
        id: image.id,
        name: image.name || '',
        catalogText: buildCatalogSearchText(image),
        searchText: buildCompactSearchText(image),
        relativePath,
        directoryId: image.directoryId || '',
        directoryName: image.directoryName || '',
        models: (image.models || [])
            .map(model => normalizeFacetValue(model))
            .filter((model): model is string => Boolean(model)),
        loraNames: (image.loras || [])
            .map(lora => normalizeFacetValue(typeof lora === 'string' ? lora : lora))
            .filter((lora): lora is string => Boolean(lora)),
        sampler: normalizeFacetValue(image.sampler) ?? '',
        scheduler: normalizeFacetValue(image.scheduler) ?? '',
        board: image.board ? String(image.board) : '',
        dimensions: normalizeFacetValue(image.dimensions) ?? '',
        lastModified: image.lastModified,
        steps: typeof image.steps === 'number' ? image.steps : null,
        cfgScale: typeof image.cfgScale === 'number' ? image.cfgScale : null,
        generationType: getImageGenerationType(image),
        mediaType,
        generator: getImageGenerator(image),
        gpuDevice: getImageGpuDevice(image),
        hasTelemetry: hasTelemetryData(image),
        hasVerifiedTelemetry: hasVerifiedTelemetry(image),
        generationTimeMs,
        stepsPerSecond,
        vramPeakMb,
        isFavorite: image.isFavorite === true,
        rating: image.rating ?? null,
        tags: (image.tags || []).map(tag => String(tag).toLowerCase()),
        autoTags: (image.autoTags || []).map(tag => String(tag).toLowerCase()),
    };
};


/** Renderer-only view: expensive fields are evaluated only after cheaper predicates pass. */
class LazyLibraryQueryImage implements LibraryQueryImage {
constructor(private readonly image: IndexedImage) {}
get id() {
const image = this.image;

const value = image.id;
Object.defineProperty(this, 'id', { value, enumerable: true });
return value;
}
get name() {
const image = this.image;

const value = image.name || '';
Object.defineProperty(this, 'name', { value, enumerable: true });
return value;
}
get catalogText() {
const image = this.image;

const value = buildCatalogSearchText(image);
Object.defineProperty(this, 'catalogText', { value, enumerable: true });
return value;
}
get searchText() {
const image = this.image;

const value = buildCompactSearchText(image);
Object.defineProperty(this, 'searchText', { value, enumerable: true });
return value;
}
get relativePath() {
const image = this.image;
const relativePath = getRelativeImagePath(image);
const value = relativePath;
Object.defineProperty(this, 'relativePath', { value, enumerable: true });
return value;
}
get directoryId() {
const image = this.image;

const value = image.directoryId || '';
Object.defineProperty(this, 'directoryId', { value, enumerable: true });
return value;
}
get directoryName() {
const image = this.image;

const value = image.directoryName || '';
Object.defineProperty(this, 'directoryName', { value, enumerable: true });
return value;
}
get models() {
const image = this.image;

const value = (image.models || [])
            .map(model => normalizeFacetValue(model))
            .filter((model): model is string => Boolean(model));
Object.defineProperty(this, 'models', { value, enumerable: true });
return value;
}
get loraNames() {
const image = this.image;

const value = (image.loras || [])
            .map(lora => normalizeFacetValue(typeof lora === 'string' ? lora : lora))
            .filter((lora): lora is string => Boolean(lora));
Object.defineProperty(this, 'loraNames', { value, enumerable: true });
return value;
}
get sampler() {
const image = this.image;

const value = normalizeFacetValue(image.sampler) ?? '';
Object.defineProperty(this, 'sampler', { value, enumerable: true });
return value;
}
get scheduler() {
const image = this.image;

const value = normalizeFacetValue(image.scheduler) ?? '';
Object.defineProperty(this, 'scheduler', { value, enumerable: true });
return value;
}
get board() {
const image = this.image;

const value = image.board ? String(image.board) : '';
Object.defineProperty(this, 'board', { value, enumerable: true });
return value;
}
get dimensions() {
const image = this.image;

const value = normalizeFacetValue(image.dimensions) ?? '';
Object.defineProperty(this, 'dimensions', { value, enumerable: true });
return value;
}
get lastModified() {
const image = this.image;

const value = image.lastModified;
Object.defineProperty(this, 'lastModified', { value, enumerable: true });
return value;
}
get steps() {
const image = this.image;

const value = typeof image.steps === 'number' ? image.steps : null;
Object.defineProperty(this, 'steps', { value, enumerable: true });
return value;
}
get cfgScale() {
const image = this.image;

const value = typeof image.cfgScale === 'number' ? image.cfgScale : null;
Object.defineProperty(this, 'cfgScale', { value, enumerable: true });
return value;
}
get generationType() {
const image = this.image;

const value = getImageGenerationType(image);
Object.defineProperty(this, 'generationType', { value, enumerable: true });
return value;
}
get mediaType() {
const image = this.image;
const metadataMediaType = image.metadata?.normalizedMetadata?.media_type;
const inferredMediaType = resolveMediaType(image.name, image.fileType);
const mediaType =
        metadataMediaType === 'video' || metadataMediaType === 'audio' || metadataMediaType === 'model3d' || metadataMediaType === 'image'
            ? metadataMediaType
            : inferredMediaType === 'video' || inferredMediaType === 'audio' || inferredMediaType === 'model3d'
                ? inferredMediaType
                : 'image';
const value = mediaType;
Object.defineProperty(this, 'mediaType', { value, enumerable: true });
return value;
}
get generator() {
const image = this.image;

const value = getImageGenerator(image);
Object.defineProperty(this, 'generator', { value, enumerable: true });
return value;
}
get gpuDevice() {
const image = this.image;

const value = getImageGpuDevice(image);
Object.defineProperty(this, 'gpuDevice', { value, enumerable: true });
return value;
}
get hasTelemetry() {
const image = this.image;

const value = hasTelemetryData(image);
Object.defineProperty(this, 'hasTelemetry', { value, enumerable: true });
return value;
}
get hasVerifiedTelemetry() {
const image = this.image;

const value = hasVerifiedTelemetry(image);
Object.defineProperty(this, 'hasVerifiedTelemetry', { value, enumerable: true });
return value;
}
get generationTimeMs() {
const image = this.image;
const analytics = getImageAnalyticsSnapshot(image);
const generationTimeMs = typeof analytics?.generation_time_ms === 'number' ? analytics.generation_time_ms : null;
const value = generationTimeMs;
Object.defineProperty(this, 'generationTimeMs', { value, enumerable: true });
return value;
}
get stepsPerSecond() {
const image = this.image;
const analytics = getImageAnalyticsSnapshot(image);
const stepsPerSecond = typeof analytics?.steps_per_second === 'number' ? analytics.steps_per_second : null;
const value = stepsPerSecond;
Object.defineProperty(this, 'stepsPerSecond', { value, enumerable: true });
return value;
}
get vramPeakMb() {
const image = this.image;
const analytics = getImageAnalyticsSnapshot(image);
const vramPeakMb = typeof analytics?.vram_peak_mb === 'number' ? analytics.vram_peak_mb : null;
const value = vramPeakMb;
Object.defineProperty(this, 'vramPeakMb', { value, enumerable: true });
return value;
}
get isFavorite() {
const image = this.image;

const value = image.isFavorite === true;
Object.defineProperty(this, 'isFavorite', { value, enumerable: true });
return value;
}
get rating() {
const image = this.image;

const value = image.rating ?? null;
Object.defineProperty(this, 'rating', { value, enumerable: true });
return value;
}
get tags() {
const image = this.image;

const value = (image.tags || []).map(tag => String(tag).toLowerCase());
Object.defineProperty(this, 'tags', { value, enumerable: true });
return value;
}
get autoTags() {
const image = this.image;

const value = (image.autoTags || []).map(tag => String(tag).toLowerCase());
Object.defineProperty(this, 'autoTags', { value, enumerable: true });
return value;
}
}

export function toLazyLibraryQueryImage(image: IndexedImage): LibraryQueryImage {
return new LazyLibraryQueryImage(image);
}

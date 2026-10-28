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


// @ts-check

export const IMAGE_METAHUB_AVIF_EXTENSION_VERSION = 1;

/** @typedef {Record<string, unknown>} UnknownRecord */

/**
 * @param {unknown} value
 * @returns {value is UnknownRecord}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {UnknownRecord | undefined}
 */
function nonEmptyRecord(value) {
  return isRecord(value) && Object.keys(value).length > 0 ? value : undefined;
}

/**
 * Collect the normalized sampling and model fields Image MetaHub extracts from
 * the workflow at generation time. These are kept in the extension as an
 * authoritative snapshot on purpose: re-deriving seed/steps/model/sampler from
 * arbitrary custom-node graphs is unreliable, which is exactly the failure mode
 * the extraction exists to avoid. Only the redundant full prompt/workflow graph
 * copy is dropped, never the extraction. Field names mirror the PNG
 * `imagemetahub_data` payload so both carriers describe parameters the same way.
 *
 * @param {UnknownRecord} source
 * @returns {UnknownRecord | undefined}
 */
function buildExtractedParameters(source) {
  /** @type {UnknownRecord} */
  const parameters = {};
  if (typeof source.model === 'string' && source.model.trim()) {
    parameters.model = source.model.trim();
  }
  if (Number.isFinite(source.seed)) parameters.seed = source.seed;
  if (Number.isFinite(source.steps)) parameters.steps = source.steps;
  if (Number.isFinite(source.cfg_scale)) parameters.cfg = source.cfg_scale;
  if (typeof source.sampler === 'string' && source.sampler.trim()) {
    parameters.sampler_name = source.sampler.trim();
  }
  if (typeof source.scheduler === 'string' && source.scheduler.trim()) {
    parameters.scheduler = source.scheduler.trim();
  }
  if (typeof source.negativePrompt === 'string' && source.negativePrompt.trim()) {
    parameters.negativePrompt = source.negativePrompt;
  }
  return Object.keys(parameters).length > 0 ? parameters : undefined;
}

/**
 * Build the intentionally small Image MetaHub extension stored in AVIF XMP.
 * Standard prompt and workflow documents stay in their established XMP fields;
 * this object contains only app-specific information those fields cannot carry.
 *
 * @param {UnknownRecord | null | undefined} metadata
 * @returns {UnknownRecord}
 */
export function buildImageMetaHubAvifExtension(metadata) {
  const source = isRecord(metadata) ? metadata : {};
  /** @type {UnknownRecord} */
  const extension = { version: IMAGE_METAHUB_AVIF_EXTENSION_VERSION };

  if (typeof source.generator === 'string' && source.generator.trim() && source.generator !== 'Image MetaHub') {
    extension.source_generator = source.generator.trim();
  }

  if (Array.isArray(source.tags)) {
    const tags = Array.from(new Set(
      source.tags
        .filter((tag) => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ));
    if (tags.length > 0) extension.tags = tags;
  }

  if (typeof source.notes === 'string' && source.notes.trim()) {
    extension.notes = source.notes;
  }

  const attribution = nonEmptyRecord(source.imh_attribution);
  if (attribution) extension.attribution = attribution;

  const analytics = nonEmptyRecord(source.analytics) ?? nonEmptyRecord(source._analytics);
  if (analytics) extension.analytics = analytics;

  const lineage = nonEmptyRecord(source.lineage);
  if (lineage) extension.lineage = lineage;

  const parameters = buildExtractedParameters(source);
  if (parameters) extension.extracted_parameters = parameters;

  return extension;
}

/**
 * Apply the compact AVIF extension after the standard metadata parser has
 * resolved prompts, workflows, models, and sampling parameters.
 *
 * @param {UnknownRecord | null | undefined} metadata
 * @param {unknown} extensionValue
 * @returns {UnknownRecord | null}
 */
export function applyImageMetaHubAvifExtension(metadata, extensionValue) {
  if (!isRecord(extensionValue)) return isRecord(metadata) ? metadata : null;

  const extension = extensionValue;
  const hasRecognizedField = [
    'source_generator',
    'tags',
    'notes',
    'attribution',
    'analytics',
    'lineage',
    'extracted_parameters',
  ].some((key) => key in extension);
  if (!hasRecognizedField) return isRecord(metadata) ? metadata : null;

  /** @type {UnknownRecord} */
  const result = isRecord(metadata)
    ? { ...metadata }
    : { prompt: '', model: '', width: 0, height: 0, steps: 0, scheduler: '' };

  if (typeof extension.source_generator === 'string' && extension.source_generator.trim()) {
    result.generator = extension.source_generator.trim();
  }
  if (Array.isArray(extension.tags)) {
    result.tags = Array.from(new Set(
      extension.tags
        .filter((tag) => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ));
  }
  if (typeof extension.notes === 'string') result.notes = extension.notes;

  const attribution = nonEmptyRecord(extension.attribution);
  if (attribution) result.imh_attribution = attribution;

  const analytics = nonEmptyRecord(extension.analytics);
  if (analytics) {
    // Copy into each field so a later in-place mutation of `analytics` cannot
    // silently leak into `_analytics` (or vice versa) through a shared reference.
    result.analytics = { ...analytics };
    result._analytics = { ...analytics };
  }

  const lineage = nonEmptyRecord(extension.lineage);
  if (lineage) result.lineage = lineage;

  // The extracted snapshot is authoritative: it overrides whatever the standard
  // parser managed to re-derive from the graph, since the snapshot was captured
  // when the parameters were still known. Missing fields fall back to the parse.
  const parameters = nonEmptyRecord(extension.extracted_parameters);
  if (parameters) {
    if (typeof parameters.model === 'string' && parameters.model.trim()) {
      result.model = parameters.model.trim();
    }
    if (Number.isFinite(parameters.seed)) result.seed = parameters.seed;
    if (Number.isFinite(parameters.steps)) result.steps = parameters.steps;
    if (Number.isFinite(parameters.cfg)) result.cfg_scale = parameters.cfg;
    if (typeof parameters.sampler_name === 'string' && parameters.sampler_name.trim()) {
      result.sampler = parameters.sampler_name.trim();
    }
    if (typeof parameters.scheduler === 'string' && parameters.scheduler.trim()) {
      result.scheduler = parameters.scheduler.trim();
    }
    if (typeof parameters.negativePrompt === 'string') {
      result.negativePrompt = parameters.negativePrompt;
    }
  }

  return result;
}

/**
 * @param {unknown} metadata
 * @returns {{ field: 'prompt' | 'workflow', canonicalSource: string, conflictingSource: string }[]}
 */
export function getAvifCarrierConflicts(metadata) {
  if (!isRecord(metadata) || !Array.isArray(metadata._carrierConflicts)) return [];
  return metadata._carrierConflicts.filter((value) => (
    isRecord(value)
    && (value.field === 'prompt' || value.field === 'workflow')
    && typeof value.canonicalSource === 'string'
    && typeof value.conflictingSource === 'string'
  ));
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInvokeAIMetadata = isInvokeAIMetadata;
exports.isSwarmUIMetadata = isSwarmUIMetadata;
exports.isEasyDiffusionMetadata = isEasyDiffusionMetadata;
exports.isEasyDiffusionJson = isEasyDiffusionJson;
exports.isMidjourneyMetadata = isMidjourneyMetadata;
exports.isForgeMetadata = isForgeMetadata;
exports.isDalleMetadata = isDalleMetadata;
exports.isDreamStudioMetadata = isDreamStudioMetadata;
exports.isAutomatic1111Metadata = isAutomatic1111Metadata;
exports.isComfyUIMetadata = isComfyUIMetadata;
// Type guard functions
function isInvokeAIMetadata(metadata) {
    // More permissive detection - check for common InvokeAI fields
    var hasInvokeAIFields = ('positive_prompt' in metadata) ||
        ('negative_prompt' in metadata) ||
        ('generation_mode' in metadata) ||
        ('app_version' in metadata) ||
        ('model_name' in metadata) ||
        ('cfg_scale' in metadata) ||
        ('scheduler' in metadata);
    // Also check for legacy prompt field with generation parameters
    var hasLegacyFields = ('prompt' in metadata) &&
        (('model' in metadata) || ('width' in metadata) || ('height' in metadata) || ('steps' in metadata));
    // Check if it has InvokeAI-specific structure (not ComfyUI or A1111)
    var notComfyUI = !('workflow' in metadata) && !('prompt' in metadata && typeof metadata.prompt === 'object');
    var notA1111 = !('parameters' in metadata && typeof metadata.parameters === 'string');
    return (hasInvokeAIFields || hasLegacyFields) && notComfyUI && notA1111;
}
function isSwarmUIMetadata(metadata) {
    return 'sui_image_params' in metadata && typeof metadata.sui_image_params === 'object';
}
function isEasyDiffusionMetadata(metadata) {
    return 'parameters' in metadata &&
        typeof metadata.parameters === 'string' &&
        metadata.parameters.includes('Prompt:') &&
        !('sui_image_params' in metadata) &&
        !metadata.parameters.includes('Model hash:'); // Distinguish from A1111
}
function isEasyDiffusionJson(metadata) {
    return 'prompt' in metadata && typeof metadata.prompt === 'string' && !('parameters' in metadata);
}
function isMidjourneyMetadata(metadata) {
    return 'parameters' in metadata &&
        typeof metadata.parameters === 'string' &&
        (metadata.parameters.includes('Midjourney') ||
            metadata.parameters.includes('--v') ||
            metadata.parameters.includes('--ar') ||
            metadata.parameters.includes('--q') ||
            metadata.parameters.includes('--s'));
}
function isForgeMetadata(metadata) {
    return 'parameters' in metadata &&
        typeof metadata.parameters === 'string' &&
        (metadata.parameters.includes('Forge') ||
            metadata.parameters.includes('Gradio') ||
            (metadata.parameters.includes('Steps:') &&
                metadata.parameters.includes('Sampler:') &&
                metadata.parameters.includes('Model hash:'))); // Similar to A1111 but with Forge/Gradio indicators
}
function isDalleMetadata(metadata) {
    var _a, _b, _c, _d;
    // Check for C2PA manifest (primary indicator)
    if ('c2pa_manifest' in metadata) {
        return true;
    }
    // Check for OpenAI/DALL-E specific EXIF data
    if ('exif_data' in metadata && typeof metadata.exif_data === 'object') {
        var exif = metadata.exif_data;
        // Look for OpenAI/DALL-E indicators in EXIF
        if (exif['openai:dalle'] || ((_a = exif['Software']) === null || _a === void 0 ? void 0 : _a.includes('DALL-E')) || ((_b = exif['Software']) === null || _b === void 0 ? void 0 : _b.includes('OpenAI'))) {
            return true;
        }
    }
    // Check for DALL-E specific fields
    if ('prompt' in metadata && 'model_version' in metadata &&
        (((_c = metadata.model_version) === null || _c === void 0 ? void 0 : _c.includes('dall-e')) || ((_d = metadata.model_version) === null || _d === void 0 ? void 0 : _d.includes('DALL-E')))) {
        return true;
    }
    return false;
}
function isDreamStudioMetadata(metadata) {
    return 'parameters' in metadata &&
        typeof metadata.parameters === 'string' &&
        (metadata.parameters.includes('DreamStudio') ||
            metadata.parameters.includes('Stability AI') ||
            (metadata.parameters.includes('Prompt:') &&
                metadata.parameters.includes('Steps:') &&
                !metadata.parameters.includes('Model hash:') && // Exclude A1111
                !metadata.parameters.includes('Forge') && // Exclude Forge
                !metadata.parameters.includes('Gradio'))); // Exclude Forge
}
function isAutomatic1111Metadata(metadata) {
    return 'parameters' in metadata && typeof metadata.parameters === 'string' && !('sui_image_params' in metadata);
}
function isComfyUIMetadata(metadata) {
    // The presence of a 'workflow' property is the most reliable and unique indicator for ComfyUI.
    // This check is intentionally lenient, trusting the dedicated parser to handle the details.
    // An overly strict type guard was the cause of previous parsing failures.
    if ('workflow' in metadata && (typeof metadata.workflow === 'object' || typeof metadata.workflow === 'string')) {
        return true;
    }
    // As a fallback, check for the API-style 'prompt' object. This format, where keys are
    // node IDs, is also unique to ComfyUI and distinct from other formats.
    if ('prompt' in metadata && typeof metadata.prompt === 'object' && metadata.prompt !== null && !Array.isArray(metadata.prompt)) {
        // A minimal structural check to ensure it's not just a random object.
        // It should contain values that look like ComfyUI nodes.
        return Object.values(metadata.prompt).some(function (node) { return node && typeof node === 'object' && 'class_type' in node && 'inputs' in node; });
    }
    return false;
}

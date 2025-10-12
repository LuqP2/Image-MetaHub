"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDreamStudioMetadata = parseDreamStudioMetadata;
var types_1 = require("../../types");
/**
 * DreamStudio Parser - Handles DreamStudio (Stability AI) metadata
 * DreamStudio uses A1111-like format but with Stability AI specific indicators
 * Reuses A1111 parsing logic since DreamStudio maintains compatibility
 */
function parseDreamStudioMetadata(metadata) {
    if (!(0, types_1.isDreamStudioMetadata)(metadata)) {
        return null;
    }
    var parameters = metadata.parameters;
    console.log('🎨 Parsing DreamStudio metadata...');
    // Extract basic parameters using regex patterns similar to A1111
    var steps = extractSteps(parameters);
    var sampler = extractSampler(parameters);
    var cfgScale = extractCFGScale(parameters);
    var seed = extractSeed(parameters);
    var size = extractSize(parameters);
    var model = extractModel(parameters);
    // Extract prompts (positive and negative)
    var _a = extractPrompts(parameters), positivePrompt = _a.positivePrompt, negativePrompt = _a.negativePrompt;
    // Extract LoRAs and embeddings
    var loras = extractLoRAs(parameters);
    var embeddings = extractEmbeddings(parameters);
    // Extract DreamStudio-specific parameters
    var guidanceScale = extractGuidanceScale(parameters);
    var stylePreset = extractStylePreset(parameters);
    // Extract size dimensions from size string (e.g., "512x512")
    var width = 0;
    var height = 0;
    if (size) {
        var sizeMatch = size.match(/(\d+)x(\d+)/);
        if (sizeMatch) {
            width = parseInt(sizeMatch[1]);
            height = parseInt(sizeMatch[2]);
        }
    }
    console.log('✅ DreamStudio parsing successful:', {
        prompt: (positivePrompt === null || positivePrompt === void 0 ? void 0 : positivePrompt.substring(0, 50)) + '...',
        model: model,
        steps: steps,
        width: width,
        height: height,
        stylePreset: stylePreset
    });
    return {
        prompt: positivePrompt || '',
        negativePrompt: negativePrompt,
        model: model || 'DreamStudio',
        models: model ? [model] : ['DreamStudio'],
        width: width || 512, // Default DreamStudio resolution
        height: height || 512,
        seed: seed,
        steps: steps || 20, // Default DreamStudio steps
        cfg_scale: cfgScale || guidanceScale, // Use guidance scale if CFG not found
        scheduler: sampler || 'K_EULER',
        sampler: sampler,
        loras: loras,
        // DreamStudio-specific fields
        stylePreset: stylePreset,
        guidanceScale: guidanceScale,
    };
}
// Helper functions for parameter extraction (similar to A1111)
function extractSteps(parameters) {
    var match = parameters.match(/Steps:\s*(\d+)/i);
    return match ? parseInt(match[1]) : undefined;
}
function extractSampler(parameters) {
    var match = parameters.match(/Sampler:\s*([^,\n]+)/i);
    return match ? match[1].trim() : undefined;
}
function extractCFGScale(parameters) {
    var match = parameters.match(/CFG scale:\s*([\d.]+)/i);
    return match ? parseFloat(match[1]) : undefined;
}
function extractGuidanceScale(parameters) {
    var match = parameters.match(/Guidance scale:\s*([\d.]+)/i);
    return match ? parseFloat(match[1]) : undefined;
}
function extractSeed(parameters) {
    var match = parameters.match(/Seed:\s*(\d+)/i);
    return match ? parseInt(match[1]) : undefined;
}
function extractSize(parameters) {
    var match = parameters.match(/Size:\s*([^,\n]+)/i);
    return match ? match[1].trim() : undefined;
}
function extractModel(parameters) {
    var match = parameters.match(/Model:\s*([^,\n]+)/i);
    return match ? match[1].trim() : undefined;
}
function extractStylePreset(parameters) {
    var match = parameters.match(/Style preset:\s*([^,\n]+)/i);
    return match ? match[1].trim() : undefined;
}
function extractPrompts(parameters) {
    // Split by common separators used in DreamStudio (similar to A1111)
    var parts = parameters.split(/\n\n|\nNegative prompt:/i);
    var positivePrompt = '';
    var negativePrompt = '';
    if (parts.length >= 2) {
        positivePrompt = parts[0].trim();
        negativePrompt = parts[1].trim();
    }
    else {
        // Fallback: look for "Negative prompt:" within the text
        var negMatch = parameters.match(/Negative prompt:\s*(.+)$/i);
        if (negMatch) {
            positivePrompt = parameters.substring(0, negMatch.index).trim();
            negativePrompt = negMatch[1].trim();
        }
        else {
            positivePrompt = parameters.trim();
        }
    }
    return { positivePrompt: positivePrompt, negativePrompt: negativePrompt };
}
function extractLoRAs(parameters) {
    var loraMatches = parameters.matchAll(/<lora:([^:>]+):[^>]*>/gi);
    return Array.from(loraMatches, function (match) { return match[1]; });
}
function extractEmbeddings(parameters) {
    var embeddingMatches = parameters.matchAll(/\b([A-Z][a-zA-Z0-9_]*)\b/g);
    // Filter for likely embeddings (capitalized words that aren't common parameters)
    var commonWords = new Set(['Steps', 'Sampler', 'CFG', 'Guidance', 'Seed', 'Size', 'Model', 'Style', 'Preset', 'Negative', 'Prompt', 'DreamStudio', 'Stability']);
    return Array.from(embeddingMatches, function (match) { return match[1]; })
        .filter(function (word) { return !commonWords.has(word) && word.length > 2; });
}

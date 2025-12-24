/**
 * @file extractors.ts
 * @description Reusable extractor functions for ComfyUI node parameter extraction.
 * These extractors provide declarative, composable logic for common extraction patterns.
 */

import { ParserNode } from './nodeRegistry';

/**
 * Concatenates multiple text inputs into a single string.
 * Used by nodes like ttN concat, JWStringConcat.
 */
export function concatTextExtractor(
  node: ParserNode,
  state: any,
  graph: any,
  traverseFromLink: any,
  inputNames: string[],
  delimiterKey: string = 'delimiter'
): string | null {
  const texts: string[] = [];
  const delimiter = node.inputs?.[delimiterKey] || ' ';

  for (const inputName of inputNames) {
    const input = node.inputs?.[inputName];

    if (!input) continue;

    let text = '';
    if (Array.isArray(input)) {
      const result = traverseFromLink(input as any, state, graph, []);
      if (result) text = String(result);
    } else {
      text = String(input);
    }

    if (text.trim()) {
      texts.push(text);
    }
  }

  const combined = texts
    .join(String(delimiter))
    .replace(/,\s*,/g, ',')      // Remove double commas
    .replace(/\s+,/g, ',')       // Remove spaces before comma
    .replace(/,\s+/g, ', ')      // Normalize spaces after comma
    .replace(/\s+/g, ' ')        // Normalize multiple spaces
    .trim();

  return combined || null;
}

/**
 * Extracts LoRA names from text that contains <lora:name> tags.
 * Used by nodes like ImpactWildcardEncode.
 */
export function extractLorasFromText(text: string): string[] {
  const loraMatches = text.matchAll(/<lora:([^>]+)>/gi);
  const loras: string[] = [];

  for (const match of loraMatches) {
    let loraPath = match[1];

    // Remove common prefixes
    loraPath = loraPath.replace(/^(?:Flux|flux|FLUX)[\\/]+/i, '');

    // Remove .safetensors extension
    loraPath = loraPath.replace(/\.safetensors$/i, '');

    if (loraPath) {
      loras.push(loraPath);
    }
  }

  return loras;
}

/**
 * Removes LoRA tags from text, leaving only the prompt.
 * Used by nodes like ImpactWildcardEncode.
 */
export function removeLoraTagsFromText(text: string): string {
  return text.replace(/<lora:[^>]+>/gi, '').trim();
}

/**
 * Cleans wildcard text by removing unresolved wildcards and artifacts.
 * Used by nodes like ImpactWildcardProcessor.
 */
export function cleanWildcardText(text: string): string | null {
  // Remove unresolved wildcards (e.g., __bo/random/anything__)
  let cleaned = text.replace(/__[a-zA-Z0-9/_-]+__/g, '');

  // Clean common artifacts
  cleaned = cleaned
    .replace(/,\s*,/g, ',')      // Remove double commas
    .replace(/\s+,/g, ',')       // Remove spaces before comma
    .replace(/,\s+/g, ', ')      // Normalize spaces after comma
    .replace(/\s+/g, ' ')        // Normalize multiple spaces
    .trim();

  return cleaned || null;
}

/**
 * Extracts LoRAs from a LoRA Stack node (like CR LoRA Stack).
 * Each LoRA is represented by a group of widgets: switch, name, model_weight, clip_weight.
 */
export function extractLorasFromStack(
  widgets: any[],
  lorasPerGroup: number = 4,
  switchIndex: number = 0,
  nameIndex: number = 1
): string[] {
  const loras: string[] = [];
  const maxLoras = Math.floor(widgets.length / lorasPerGroup);

  for (let i = 0; i < maxLoras; i++) {
    const switchIdx = i * lorasPerGroup + switchIndex;
    const loraNameIdx = i * lorasPerGroup + nameIndex;

    const switchValue = widgets[switchIdx];
    const loraValue = widgets[loraNameIdx];

    // Check if switch is "On" and LoRA is valid
    if (switchValue === 'On' && loraValue && loraValue !== 'None') {
      let loraPath = String(loraValue);

      // Remove common prefixes
      loraPath = loraPath.replace(/^(?:flux|Flux|FLUX)[\\/\-\s]+/i, '');

      // Remove .safetensors extension
      loraPath = loraPath.replace(/\.safetensors$/i, '');

      // Clean extra spaces
      loraPath = loraPath.trim();

      if (loraPath) {
        loras.push(loraPath);
      }
    }
  }

  return loras;
}

/**
 * Gets the populated text or wildcard text from a wildcard processor node.
 * Prioritizes populated_text (result after wildcard) over wildcard_text (template).
 */
export function getWildcardOrPopulatedText(node: ParserNode): string {
  const populated = node.inputs?.populated_text || node.widgets_values?.[1];
  const wildcard = node.inputs?.wildcard_text || node.widgets_values?.[0];

  return (populated || wildcard || '').trim();
}

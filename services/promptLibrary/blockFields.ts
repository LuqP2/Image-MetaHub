import type { PromptBlock, PromptVariable } from '../../types';
import { compilePrompt, makeDocument, normalizeEditor } from './core.mjs';

export function blockFieldNames(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g), match => match[1]))];
}

export function activeBlockFields(text: string, definitions: PromptVariable[]): PromptVariable[] {
  const known = new Map(definitions.map(variable => [variable.name, variable]));
  return blockFieldNames(text).map((name): PromptVariable => known.get(name) || {
    name, label: '', type: 'text', defaultValue: '', required: true, options: [],
  });
}

// Keep inactive definitions in the draft so temporarily editing a placeholder does not erase its settings.
// Only active definitions are included when the user explicitly saves the block.
export function rememberBlockFields(text: string, definitions: PromptVariable[]): PromptVariable[] {
  const known = new Set(definitions.map(variable => variable.name));
  return [...definitions, ...activeBlockFields(text, definitions).filter(variable => !known.has(variable.name))];
}

// Resolve once per use, never while displaying the saved template. A repeated
// placeholder shares one value, and both drag payload formats use that result.
export function compileBlockForUse(block: PromptBlock, random: () => number = Math.random) {
  const editor = normalizeEditor(block.editor);
  const variables = activeBlockFields(block.text, editor.variables);
  const values: Record<string, string> = {};
  for (const variable of variables) {
    const options = [...new Set(variable.options.filter(option => option.trim()))];
    values[variable.name] = options.length ? options[Math.floor(random() * options.length)] : variable.defaultValue;
  }
  const result = compilePrompt({ editor: { ...editor, document: { ...makeDocument(block.text), mode: 'template', variables } } }, values);
  return { ...result, errors: result.errors.map(error => {
    const missing = variables.find(variable => error === `Fill ${variable.label}.`);
    return missing ? `Add suggested values or a default for ${missing.label || missing.name} in the block editor.` : error;
  }) };
}

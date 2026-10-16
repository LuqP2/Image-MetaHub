import type { PromptBlock, PromptDocument, PromptPart, PromptVariable, SavedPrompt } from '../../types';
import { allVariables, documentText, normalizeEditor, sameVariableDefinition, snapshotBlock } from './core.mjs';

export interface CompositionAddition {
  id: string;
  title: string;
  kind: 'block' | 'prompt';
  positive: PromptPart[];
  negative: PromptPart[];
  variables: PromptVariable[];
  template: boolean;
}

export function blockAddition(block: PromptBlock, channel: 'positive' | 'negative'): CompositionAddition {
  const part = snapshotBlock(block);
  return { id: part.id, title: part.title || 'Untitled block', kind: 'block', positive: [], negative: [], [channel]: [part], variables: [], template: !!part.variables?.length };
}

export function promptAddition(prompt: SavedPrompt): CompositionAddition {
  const editor = normalizeEditor(prompt.editor);
  const text = editor.document ? documentText(editor.document) : prompt;
  const parts = (content: string): PromptPart[] => content.length ? [{ id: crypto.randomUUID(), kind: 'text', enabled: true, text: content }] : [];
  return {
    id: crypto.randomUUID(), title: editor.title || 'Untitled prompt', kind: 'prompt',
    positive: parts(text.positivePrompt), negative: parts(text.negativePrompt),
    variables: editor.document?.mode === 'template' ? structuredClone(allVariables(editor.document)) : [],
    template: editor.document?.mode === 'template',
  };
}

export function appendAdditions(document: PromptDocument, additions: CompositionAddition[]): PromptDocument {
  // Validate before merging definitions so a same-name field can never silently replace another.
  const known = new Map(allVariables(document).map(variable => [variable.name, variable]));
  const variables = new Map(document.variables.map(variable => [variable.name, variable]));
  for (const addition of additions) for (const variable of addition.variables) {
    const existing = known.get(variable.name);
    if (existing && !sameVariableDefinition(existing, variable)) throw new Error(`Conflicting definitions for ${variable.name}. Rename the variable before inserting this prompt.`);
    known.set(variable.name, variable);
    variables.set(variable.name, variable);
  }
  const next: PromptDocument = {
    ...document, mode: additions.some(addition => addition.template) ? 'template' : document.mode,
    positive: [...document.positive, ...additions.flatMap(addition => addition.positive)],
    negative: [...document.negative, ...additions.flatMap(addition => addition.negative)],
    variables: [...variables.values()],
  };
  allVariables(next);
  return next;
}

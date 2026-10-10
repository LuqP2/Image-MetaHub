import type { PromptEditorData, PromptDocument, PromptVariable, PromptPart, PromptBlock, SavedPrompt, PromptLibraryMutation, PromptLibrarySnapshot } from '../../types';
export function emptyEditor(): PromptEditorData;
export function normalizeEditor(value?: unknown): PromptEditorData;
export function normalizeTags(value?: unknown): string[];
export function normalizeVariables(value?: unknown): PromptVariable[];
export function normalizeDocument(value?: unknown): PromptDocument | null;
export function documentText(document: PromptDocument): {
  positivePrompt: string;
  negativePrompt: string;
};
export function allVariables(document: PromptDocument): PromptVariable[];
export function compilePrompt(item: Partial<SavedPrompt>, values?: Record<string, string>): {
  positivePrompt: string;
  negativePrompt: string;
  errors: string[];
};
export function makeDocument(positivePrompt?: string, negativePrompt?: string): PromptDocument;
export function snapshotBlock(block: PromptBlock): PromptPart;
export function prepareItem(kind: string, input: unknown): {
  editor: PromptEditorData;
  positivePrompt?: string;
  negativePrompt?: string;
  text?: string;
};
export function portableItem<T>(item: T): T;
export function equivalentItem(kind: string, item: unknown): string;
export function applyMutation(snapshot: PromptLibrarySnapshot, command: PromptLibraryMutation, uuid?: () => string, now?: () => number): PromptLibrarySnapshot & {
  selectedId?: string;
};

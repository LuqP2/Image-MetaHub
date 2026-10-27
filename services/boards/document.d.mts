import type { BoardDocument, BoardSummary, BoardAssetLocator, BoardReferenceRemap } from './types';
export class BoardError extends Error { code: string; constructor(code: string, message: string); }
export function isBoardId(value: unknown): value is string;
export function validateBoardId(value: unknown): string;
export function normalizeBoardLocator(value: unknown): BoardAssetLocator;
export function normalizeBoardDocument(input: unknown): BoardDocument;
export function createBoardDocument(name?: string, id?: string, now?: number): BoardDocument;
export function duplicateBoardDocument(document: BoardDocument, name?: string, id?: string, now?: number): BoardDocument;
export function summarizeBoard(document: BoardDocument): BoardSummary;
export function normalizeReferenceRemap(value: unknown): BoardReferenceRemap;
export function applyBoardReferenceRemaps(document: BoardDocument, remaps: BoardReferenceRemap[]): BoardDocument;
export function mergeReferenceRemaps(existing: BoardReferenceRemap[], additions: BoardReferenceRemap[]): BoardReferenceRemap[];

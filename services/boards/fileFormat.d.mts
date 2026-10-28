import type { BoardDocument } from './types';
export function parseBoardFile(text: string): BoardDocument;
export function serializeBoardFile(document: BoardDocument): string;

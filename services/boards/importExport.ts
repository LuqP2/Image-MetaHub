import type { BoardDocument } from './types';
import { duplicateBoardDocument } from './document.mjs';
import { parseBoardFile, serializeBoardFile } from './fileFormat.mjs';

export const exportBoard = serializeBoardFile;
export function importBoard(text: string): BoardDocument {
  const document = parseBoardFile(text);
  return duplicateBoardDocument(document, document.name);
}

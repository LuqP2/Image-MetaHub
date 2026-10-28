import type { BoardDocument } from './types';
import { BoardError, duplicateBoardDocument, normalizeBoardDocument } from './document.mjs';

export function exportBoard(document: BoardDocument): string {
  return JSON.stringify({ format: 'image-metahub-board', version: 1, document: normalizeBoardDocument(document) }, null, 2);
}

export function importBoard(text: string): BoardDocument {
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { throw new BoardError('BOARD_INVALID_IMPORT', 'The board file is not valid JSON.'); }
  if (!envelope || typeof envelope !== 'object' || !('format' in envelope) || envelope.format !== 'image-metahub-board') {
    throw new BoardError('BOARD_INVALID_IMPORT', 'This file is not an Image MetaHub board.');
  }
  if (!('version' in envelope) || envelope.version !== 1) throw new BoardError('BOARD_UNSUPPORTED_VERSION', 'Unsupported board file version.');
  if (!('document' in envelope)) throw new BoardError('BOARD_INVALID_IMPORT', 'The board document is missing.');
  const document = normalizeBoardDocument(envelope.document);
  return duplicateBoardDocument(document, document.name);
}

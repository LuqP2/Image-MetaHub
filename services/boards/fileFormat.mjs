import { BoardError, normalizeBoardDocument } from './document.mjs';

export function parseBoardFile(text) {
  let envelope;
  try { envelope = JSON.parse(text); } catch { throw new BoardError('BOARD_INVALID_IMPORT', 'The board file is not valid JSON.'); }
  if (!envelope || envelope.format !== 'image-metahub-board') throw new BoardError('BOARD_INVALID_IMPORT', 'This file is not an Image MetaHub board.');
  if (![1, 2, 3].includes(envelope.version)) throw new BoardError('BOARD_UNSUPPORTED_VERSION', 'Unsupported board file version.');
  if (!envelope.document) throw new BoardError('BOARD_INVALID_IMPORT', 'The board document is missing.');
  return normalizeBoardDocument(envelope.document);
}

export function serializeBoardFile(document) {
  return JSON.stringify({ format: 'image-metahub-board', version: 3, document: normalizeBoardDocument(document) }, null, 2);
}

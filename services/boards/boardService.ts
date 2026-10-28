import type { BoardApiResult, BoardDocument, BoardReferenceRemap, BoardRepository, BoardSummary } from './types';
import { BoardError, normalizeBoardDocument } from './document.mjs';

function unwrap<T>(result: BoardApiResult<T>): T {
  if (result.success === false) throw new BoardError(result.code, result.error);
  return result.data;
}

function desktop() {
  if (typeof window === 'undefined' || !window.electronAPI?.boardsList || !window.electronAPI.boardsSave || !window.electronAPI.boardsLoad
    || !window.electronAPI.boardsRemove || !window.electronAPI.boardsRemapReferences) {
    throw new BoardError('BOARD_BRIDGE_UNAVAILABLE', 'Canvas desktop storage is unavailable. Restart the updated application.');
  }
  return window.electronAPI;
}

export const boardService: BoardRepository = {
  async list(): Promise<BoardSummary[]> { return unwrap(await desktop().boardsList()); },
  async load(id: string): Promise<BoardDocument> { return unwrap(await desktop().boardsLoad(id)); },
  async save(document: BoardDocument, expectedRevision: number): Promise<BoardDocument> {
    const api = desktop();
    return unwrap(await api.boardsSave({ document: normalizeBoardDocument(document), expectedRevision }));
  },
  async remove(id: string, expectedRevision: number): Promise<void> {
    const api = desktop();
    unwrap(await api.boardsRemove({ id, expectedRevision }));
  },
  async remapReferences(remaps: BoardReferenceRemap[]): Promise<void> {
    const api = desktop();
    unwrap(await api.boardsRemapReferences(remaps));
  },
  async flush(): Promise<void> {
    const api = desktop();
    if (!api.boardsFlush) throw new BoardError('BOARD_BRIDGE_UNAVAILABLE', 'Canvas flush is unavailable.');
    unwrap(await api.boardsFlush());
  },
};

export async function importBoardFile(): Promise<BoardDocument | null> {
  const api = desktop();
  if (!api.boardsImport) throw new BoardError('BOARD_BRIDGE_UNAVAILABLE', 'Canvas import is unavailable.');
  return unwrap(await api.boardsImport());
}

export async function exportBoardFile(document: BoardDocument): Promise<void> {
  const api = desktop();
  if (!api.boardsExport) throw new BoardError('BOARD_BRIDGE_UNAVAILABLE', 'Canvas export is unavailable.');
  unwrap(await api.boardsExport(normalizeBoardDocument(document)));
}

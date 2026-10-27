import fs from 'node:fs/promises';
import path from 'node:path';
import { BoardRepository } from './boardRepository.mjs';
import { BoardError, duplicateBoardDocument, normalizeBoardDocument } from '../services/boards/document.mjs';

export const boardExportFilename = name => `${Array.from(name, character =>
  character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character).join('')}.imhboard.json`;

/** Register once; getMainWindow is evaluated per request, including after window recreation. */
export function registerBoardIpc({ ipcMain, app, dialog, getMainWindow }) {
  let repository;
  const getRepository = () => repository ??= new BoardRepository({ directory: path.join(app.getPath('userData'), 'boards') });
  const register = (channel, operation) => ipcMain.handle(channel, async (event, ...args) => {
    try {
      const window = getMainWindow();
      if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new BoardError('BOARD_ACCESS_DENIED', 'Boards are accessible only from the main application window.');
      }
      return { success: true, data: await operation(getRepository(), window, ...args) };
    } catch (error) {
      return { success: false, code: error.code || 'BOARD_OPERATION_FAILED', error: error.message || String(error) };
    }
  });
  register('boards:list', repository => repository.list());
  register('boards:load', (repository, _window, id) => repository.load(id));
  register('boards:save', (repository, _window, input) => repository.save(input?.document, input?.expectedRevision));
  register('boards:remove', async (repository, _window, input) => {
    await repository.remove(input?.id, input?.expectedRevision);
    return null;
  });
  register('boards:remap-references', async (repository, _window, remaps) => {
    await repository.remapReferences(remaps);
    return null;
  });
  register('boards:flush', async repository => { await repository.flush(); return null; });
  register('boards:import', async (repository, window) => {
    const result = await dialog.showOpenDialog(window, { title: 'Import board', properties: ['openFile'], filters: [{ name: 'Image MetaHub board', extensions: ['imhboard.json'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const envelope = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'));
    if (envelope?.format !== 'image-metahub-board') throw new BoardError('BOARD_INVALID_IMPORT', 'This file is not an Image MetaHub board.');
    if (envelope.version !== 1) throw new BoardError('BOARD_UNSUPPORTED_VERSION', 'Unsupported board file version.');
    const document = normalizeBoardDocument(envelope.document);
    return repository.save(duplicateBoardDocument(document, document.name), 0);
  });
  register('boards:export', async (_repository, window, input) => {
    const document = normalizeBoardDocument(input);
    const result = await dialog.showSaveDialog(window, { title: 'Export board', defaultPath: boardExportFilename(document.name), filters: [{ name: 'Image MetaHub board', extensions: ['imhboard.json'] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, JSON.stringify({ format: 'image-metahub-board', version: 1, document }, null, 2), 'utf8');
    return { exported: true };
  });
  return { flush: () => repository?.flush() ?? Promise.resolve(), isBusy: () => repository?.isBusy() ?? false };
}

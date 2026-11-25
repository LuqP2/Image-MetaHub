import { getBoardLinkPreview } from './boardLinkPreview.mjs';
import { parseBoardFile, serializeBoardFile } from '../services/boards/fileFormat.mjs';
import { listSystemFonts } from './systemFonts.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BoardRepository } from './boardRepository.mjs';
import { BoardError, duplicateBoardDocument, normalizeBoardDocument } from '../services/boards/document.mjs';
import { exportBoardPng } from './boardPngExport.mjs';
import { isModel3DFileName, SUPPORTED_MEDIA_EXTENSIONS } from '../utils/mediaTypes.js';

export const boardExportFilename = name => `${Array.from(name, character =>
  character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character).join('')}.imhboard.json`;

/** Register once; getMainWindow is evaluated per request, including after window recreation. */
export function registerBoardIpc({
  ipcMain,
  app,
  dialog,
  getMainWindow,
  BrowserWindow,
  clipboard,
  externalAccess,
  buildBoardMediaUrl,
  readMediaMetadata,
  readModel3DMetadata,
  generateThumbnail,
  getExrRuntime,
}) {
  let repository;
  const getRepository = () => repository ??= new BoardRepository({ directory: path.join(app.getPath('userData'), 'boards') });
  const requireExternalAccess = async (boardId, filePath) => {
    if (!externalAccess) throw new BoardError('BOARD_EXTERNAL_UNAVAILABLE', 'External files are unavailable.');
    if (typeof boardId !== 'string' || !boardId.trim() || typeof filePath !== 'string' || !filePath) {
      throw new BoardError('BOARD_APPROVAL_REQUIRED', 'External file access requires approval.');
    }
    const normalized = path.resolve(filePath);
    const canonical = typeof externalAccess.resolveAllowed === 'function'
      ? externalAccess.resolveAllowed(boardId, normalized)
      : (externalAccess.allows(boardId, normalized) ? normalized : null);
    if (canonical) return canonical;
    if (externalAccess.hasGrant?.(boardId, normalized)) {
      let missing = false;
      try { await fs.lstat(normalized); }
      catch (error) { if (error?.code === 'ENOENT') missing = true; }
      if (missing) throw new BoardError('BOARD_FILE_NOT_FOUND', 'External file is unavailable.');
    }
    throw new BoardError('BOARD_APPROVAL_REQUIRED', 'External file access requires approval.');
  };
  const mapFsError = error => {
    if (error?.code === 'ENOENT') throw new BoardError('BOARD_FILE_NOT_FOUND', 'External file is unavailable.');
    throw error;
  };
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
  register('boards:link-preview', async (_repository, _window, url) => getBoardLinkPreview({ url, nativeImage: (await import('electron')).nativeImage, cacheDirectory: path.join(app.getPath('userData'), 'boards', 'link-previews') }));
  register('boards:pick-external-file', async (_repository, window, input) => {
    if (!externalAccess) throw new BoardError('BOARD_EXTERNAL_UNAVAILABLE', 'External files are unavailable.');
    const boardId = typeof input === 'string' ? input : input?.boardId;
    const defaultPath = typeof input === 'object' && typeof input?.defaultPath === 'string' ? input.defaultPath : undefined;
    if (typeof boardId !== 'string' || !boardId.trim()) throw new BoardError('BOARD_INVALID_ID', 'A board identifier is required.');
    const result = await dialog.showOpenDialog(window, {
      title: 'Select media file',
      defaultPath,
      properties: ['openFile'],
      filters: [{ name: 'Media files', extensions: SUPPORTED_MEDIA_EXTENSIONS.map(ext => ext.slice(1)) }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return externalAccess.authorize(boardId, result.filePaths[0]);
  });
  register('boards:authorize-dropped-file', (_repository, _window, input) => {
    if (!externalAccess) throw new BoardError('BOARD_EXTERNAL_UNAVAILABLE', 'External files are unavailable.');
    return externalAccess.authorize(input?.boardId, input?.filePath);
  });
  register('boards:revoke-external-access', (_repository, _window, input) => {
    if (!externalAccess) return null;
    if (typeof input === 'string') externalAccess.revokeBoard(input);
    else if (input?.boardId && input?.filePath) externalAccess.revoke(input.boardId, input.filePath);
    else if (input?.boardId) externalAccess.revokeBoard(input.boardId);
    return null;
  });
  register('boards:stat-file', async (_repository, _window, input) => {
    const filePath = await requireExternalAccess(input?.boardId, input?.filePath);
    try {
      const stats = await fs.stat(filePath);
      return { size: stats.size, mtimeMs: stats.mtimeMs, birthtimeMs: stats.birthtimeMs, isDirectory: stats.isDirectory() };
    } catch (error) { mapFsError(error); }
  });
  register('boards:read-file', async (_repository, _window, input) => {
    const filePath = await requireExternalAccess(input?.boardId, input?.filePath);
    if (path.extname(filePath).toLowerCase() === '.exr') throw new BoardError('BOARD_EXR_UNSUPPORTED', 'EXR originals are not read into the renderer.');
    try { return await fs.readFile(filePath); }
    catch (error) { mapFsError(error); }
  });
  register('boards:resolve-media-url', async (_repository, _window, input) => {
    if (!buildBoardMediaUrl) throw new BoardError('BOARD_EXTERNAL_UNAVAILABLE', 'External media streaming is unavailable.');
    const filePath = await requireExternalAccess(input?.boardId, input?.filePath);
    if (path.extname(filePath).toLowerCase() === '.exr') throw new BoardError('BOARD_EXR_UNSUPPORTED', 'EXR originals require EXR preview.');
    try {
      await fs.access(filePath);
      return buildBoardMediaUrl(input.boardId.trim(), filePath);
    } catch (error) { mapFsError(error); }
  });
  register('boards:read-media-metadata', async (_repository, _window, input) => {
    if (!readMediaMetadata) throw new BoardError('BOARD_EXTERNAL_UNAVAILABLE', 'Media metadata reader is unavailable.');
    const filePath = await requireExternalAccess(input?.boardId, input?.filePath);
    return readMediaMetadata(filePath);
  });
  register('boards:read-model3d-metadata', async (_repository, _window, input) => {
    if (!readModel3DMetadata) throw new BoardError('BOARD_EXTERNAL_UNAVAILABLE', '3D metadata reader is unavailable.');
    const filePath = await requireExternalAccess(input?.boardId, input?.filePath);
    if (!isModel3DFileName(filePath)) throw new BoardError('BOARD_INVALID_MODEL', 'Not a supported 3D model.');
    return readModel3DMetadata(filePath);
  });
  register('boards:generate-thumbnail', async (_repository, _window, input) => {
    if (!generateThumbnail) throw new BoardError('BOARD_EXTERNAL_UNAVAILABLE', 'Thumbnail generation is unavailable.');
    const filePath = await requireExternalAccess(input?.boardId, input?.filePath);
    return generateThumbnail({ filePath, maxEdge: input?.maxEdge, quality: input?.quality });
  });
  register('boards:exr-inspect', async (_repository, _window, input) => {
    const exrRuntime = getExrRuntime?.();
    if (!exrRuntime) throw new BoardError('BOARD_EXTERNAL_UNAVAILABLE', 'EXR support is unavailable.');
    const boardId = input?.boardId;
    const filePath = await requireExternalAccess(boardId, input?.filePath);
    return exrRuntime.inspect(filePath, {
      allowPath: candidate => externalAccess.allows(boardId, candidate),
    });
  });
  register('boards:exr-preview', async (_repository, window, input) => {
    const exrRuntime = getExrRuntime?.();
    if (!exrRuntime) throw new BoardError('BOARD_EXTERNAL_UNAVAILABLE', 'EXR support is unavailable.');
    const boardId = input?.boardId;
    const filePath = await requireExternalAccess(boardId, input?.request?.filePath);
    return exrRuntime.preview({ ...input.request, filePath }, window.webContents.id, {
      allowPath: candidate => externalAccess.allows(boardId, candidate),
    });
  });
  register('boards:fonts', () => listSystemFonts());
  register('boards:list', repository => repository.list());
  register('boards:reference-baseline', repository => repository.referenceBaseline());
  register('boards:load', (repository, _window, id) => repository.load(id));
  register('boards:save', (repository, _window, input) => repository.save(input?.document, input?.expectedRevision));
  register('boards:remove', async (repository, _window, input) => {
    await repository.remove(input?.id, input?.expectedRevision);
    externalAccess?.revokeBoard(input?.id);
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
    const document = parseBoardFile(await fs.readFile(result.filePaths[0], 'utf8'));
    return repository.save(duplicateBoardDocument(document, document.name), 0);
  });
  register('boards:export', async (_repository, window, input) => {
    const document = normalizeBoardDocument(input);
    const result = await dialog.showSaveDialog(window, { title: 'Export board', defaultPath: boardExportFilename(document.name), filters: [{ name: 'Image MetaHub board', extensions: ['imhboard.json'] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, serializeBoardFile(document), 'utf8');
    return { exported: true };
  });
  register('boards:export-png', async (_repository, parent, input) => exportBoardPng({ BrowserWindow, dialog, parent, input }));
  register('boards:clipboard-read', () => clipboard.readText());
  return { flush: () => repository?.flush() ?? Promise.resolve(), isBusy: () => repository?.isBusy() ?? false };
}

// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBoardExternalAccess } from '../electron/boardExternalAccess.mjs';
import { registerBoardIpc } from '../electron/boardIpc.mjs';
import { createBoardDocument } from '../services/boards/document.mjs';
import { serializeBoardFile } from '../services/boards/fileFormat.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('Canvas external file reads', () => {
  it('grants only the authorized file, sidecars, and 3D model resources scoped to a specific board with refcounting', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imh-659-acl-')); roots.push(root);
    for (const file of ['a.png', 'a.json', 'other.png', 'model.obj', 'texture.png', 'private.txt']) fs.writeFileSync(path.join(root, file), 'synthetic');
    const access = createBoardExternalAccess();
    const imgA = path.join(root, 'a.png');
    const jsonA = path.join(root, 'a.json');
    const other = path.join(root, 'other.png');
    const model = path.join(root, 'model.obj');
    const texture = path.join(root, 'texture.png');
    const privateTxt = path.join(root, 'private.txt');

    expect(access.allows('board-1', imgA)).toBe(false);
    access.authorize('board-1', imgA);
    expect(access.allows('board-1', imgA)).toBe(true);
    expect(access.allows('board-1', jsonA)).toBe(true);
    expect(access.allows('board-1', other)).toBe(false);
    // Board isolation: board-2 must not inherit board-1's grants.
    expect(access.allows('board-2', imgA)).toBe(false);

    // Reference counting within a board + across boards for 3D model roots.
    access.authorize('board-1', model);
    access.authorize('board-1', model);
    access.authorize('board-2', model);
    expect(access.allows('board-1', texture)).toBe(true);
    expect(access.allows('board-1', privateTxt)).toBe(false);
    expect(access.allows('board-2', texture)).toBe(true);

    // One revoke on board-1 leaves refcount at 1.
    access.revoke('board-1', model);
    expect(access.allows('board-1', model)).toBe(true);
    expect(access.allows('board-1', texture)).toBe(true);

    // Second revoke removes model + modelRoot from board-1, leaving board-2 intact.
    access.revoke('board-1', model);
    expect(access.allows('board-1', model)).toBe(false);
    expect(access.allows('board-1', texture)).toBe(false);
    expect(access.allows('board-2', model)).toBe(true);
    expect(access.allows('board-2', texture)).toBe(true);

    // Closing/revoking board-2 revokes its grants completely.
    access.revokeBoard('board-2');
    expect(access.allows('board-2', model)).toBe(false);
    expect(access.allows('board-2', texture)).toBe(false);

    expect(() => access.authorize('board-1', root)).toThrow();
    expect(() => access.authorize('', imgA)).toThrow();
  });

  it('keeps generic read channels isolated from board external grants and enforces board-scoped IPCs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imh-666-ipc-')); roots.push(root);
    const externalFile = path.join(root, 'external.png');
    const importFile = path.join(root, 'imported.imhboard.json');
    fs.writeFileSync(externalFile, 'png-bytes');

    const importedDoc = createBoardDocument('Imported');
    importedDoc.objects.push({
      id: 'ext-1',
      type: 'asset',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      zIndex: 1,
      frameId: null,
      name: 'external.png',
      mediaType: 'image',
      visibleFields: [],
      reference: { kind: 'external', locator: { imageId: `canvas-external:${externalFile}`, directoryPath: root, relativePath: 'external.png' } },
    });
    fs.writeFileSync(importFile, serializeBoardFile(importedDoc));

    const access = createBoardExternalAccess();
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<any>>();
    const mainFrame = {};
    const webContents = { mainFrame, id: 1 };
    const mainWindow = { isDestroyed: () => false, webContents };
    const senderEvent = { sender: webContents, senderFrame: mainFrame };

    const showOpenDialog = vi.fn(async (_win, options) => {
      if (options.filters?.[0]?.extensions?.includes('imhboard.json')) {
        return { canceled: false, filePaths: [importFile] };
      }
      return { canceled: false, filePaths: [externalFile] };
    });

    const exrFile = path.join(root, 'render.exr');
    fs.writeFileSync(exrFile, 'exr-bytes');
    const exrInspect = vi.fn(async (filePath: string, options?: { allowPath?: (candidate: string) => boolean }) => {
      if (!options?.allowPath?.(filePath)) throw new Error('ACCESS_DENIED');
      return { parts: [{ index: 0, width: 128, height: 128, channels: [] }] };
    });

    registerBoardIpc({
      ipcMain: { handle: (channel: string, fn: any) => { handlers.set(channel, fn); } },
      app: { getPath: () => root },
      dialog: { showOpenDialog, showSaveDialog: vi.fn() },
      getMainWindow: () => mainWindow,
      BrowserWindow: {},
      clipboard: { readText: () => '' },
      externalAccess: access,
      buildBoardMediaUrl: (boardId: string, filePath: string) => `imh-board-media://local/?boardId=${encodeURIComponent(boardId)}&path=${encodeURIComponent(filePath)}`,
      getExrRuntime: () => ({ inspect: exrInspect, preview: vi.fn() }),
    });

    // Generic arbitrary-path authorization IPC must not exist.
    expect(handlers.has('boards:authorize-file')).toBe(false);

    // Importing a board with external references must NOT grant access.
    const imported = await handlers.get('boards:import')!(senderEvent);
    expect(imported.success).toBe(true);
    const boardId = imported.data.id;
    expect(access.allows(boardId, externalFile)).toBe(false);

    const statBefore = await handlers.get('boards:stat-file')!(senderEvent, { boardId, filePath: externalFile });
    expect(statBefore).toMatchObject({ success: false, code: 'BOARD_APPROVAL_REQUIRED' });

    // Approving via native dialog grants access only to that board.
    const picked = await handlers.get('boards:pick-external-file')!(senderEvent, { boardId });
    expect(picked.success).toBe(true);
    const statAfter = await handlers.get('boards:stat-file')!(senderEvent, { boardId, filePath: externalFile });
    expect(statAfter.success).toBe(true);
    const readAfter = await handlers.get('boards:read-file')!(senderEvent, { boardId, filePath: externalFile });
    expect(readAfter.success).toBe(true);
    const mediaUrl = await handlers.get('boards:resolve-media-url')!(senderEvent, { boardId, filePath: externalFile });
    expect(mediaUrl.success).toBe(true);
    expect(mediaUrl.data).toContain('imh-board-media://local/');

    // Another board cannot read the file.
    const otherBoardStat = await handlers.get('boards:stat-file')!(senderEvent, { boardId: 'other-board', filePath: externalFile });
    expect(otherBoardStat).toMatchObject({ success: false, code: 'BOARD_APPROVAL_REQUIRED' });

    // Board-scoped EXR inspection enforces approval per board.
    const exrDenied = await handlers.get('boards:exr-inspect')!(senderEvent, { boardId, filePath: exrFile });
    expect(exrDenied).toMatchObject({ success: false, code: 'BOARD_APPROVAL_REQUIRED' });
    access.authorize(boardId, exrFile);
    const exrAllowed = await handlers.get('boards:exr-inspect')!(senderEvent, { boardId, filePath: exrFile });
    expect(exrAllowed.success).toBe(true);
    expect(exrAllowed.data.parts[0]).toMatchObject({ width: 128, height: 128 });
    const exrOtherBoard = await handlers.get('boards:exr-inspect')!(senderEvent, { boardId: 'other-board', filePath: exrFile });
    expect(exrOtherBoard).toMatchObject({ success: false, code: 'BOARD_APPROVAL_REQUIRED' });

    // Missing approved file reports BOARD_FILE_NOT_FOUND, while an existing file whose canonical
    // target is unapproved (e.g. replaced by a symlink) must be rejected with BOARD_APPROVAL_REQUIRED.
    const replaceableFile = path.join(root, 'replaceable.png');
    const secretFile = path.join(root, 'secret.txt');
    fs.writeFileSync(replaceableFile, 'png-bytes');
    fs.writeFileSync(secretFile, 'top-secret');
    access.authorize(boardId, replaceableFile);
    fs.unlinkSync(replaceableFile);
    expect(await handlers.get('boards:stat-file')!(senderEvent, { boardId, filePath: replaceableFile })).toMatchObject({ success: false, code: 'BOARD_FILE_NOT_FOUND' });
    expect(await handlers.get('boards:read-file')!(senderEvent, { boardId, filePath: replaceableFile })).toMatchObject({ success: false, code: 'BOARD_FILE_NOT_FOUND' });

    let symlinkCreated = false;
    try {
      fs.symlinkSync(secretFile, replaceableFile);
      symlinkCreated = true;
    } catch { /* Windows without symlink privilege */ }
    if (symlinkCreated) {
      expect(await handlers.get('boards:read-file')!(senderEvent, { boardId, filePath: replaceableFile })).toMatchObject({ success: false, code: 'BOARD_APPROVAL_REQUIRED' });
      expect(await handlers.get('boards:stat-file')!(senderEvent, { boardId, filePath: replaceableFile })).toMatchObject({ success: false, code: 'BOARD_APPROVAL_REQUIRED' });
    } else {
      // Even without OS symlink privileges, verify an existing file rejected by canonical authorization is never read via hasGrant().
      const resolveSpy = vi.spyOn(access, 'resolveAllowed').mockReturnValueOnce(null);
      fs.writeFileSync(replaceableFile, 'replaced-bytes');
      expect(await handlers.get('boards:read-file')!(senderEvent, { boardId, filePath: replaceableFile })).toMatchObject({ success: false, code: 'BOARD_APPROVAL_REQUIRED' });
      resolveSpy.mockRestore();
    }

    // Deleting the board revokes its access.
    const removed = await handlers.get('boards:remove')!(senderEvent, { id: boardId, expectedRevision: imported.data.revision });
    expect(removed.success).toBe(true);
    expect(access.allows(boardId, externalFile)).toBe(false);
    const statAfterRemove = await handlers.get('boards:stat-file')!(senderEvent, { boardId, filePath: externalFile });
    expect(statAfterRemove).toMatchObject({ success: false, code: 'BOARD_APPROVAL_REQUIRED' });
  });
});

it.each(['clip.mp4', 'sound.mp3'])('generic resolve-media-url stays denied even after board-scoped authorization of %s', async name => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imh-659-media-')); roots.push(root);
  const file = path.join(root, name); fs.writeFileSync(file, 'synthetic');
  const access = createBoardExternalAccess();
  let resolveMedia!: (_event: unknown, file: string) => Promise<{ success: boolean; url?: string; errorType?: string }>;
  const main = fs.readFileSync(new URL('../electron.mjs', import.meta.url), 'utf8');
  expect(main).toContain('const isReadPathAllowed = filePath => isPathAllowed(filePath);');
  const start = main.indexOf("  ipcMain.handle('resolve-media-url'");
  const end = main.indexOf("  ipcMain.handle('read-file'", start);
  const install = new Function('ipcMain', 'path', 'getSafeFileDetails', 'isReadPathAllowed', 'isPathAllowed', 'fs', 'logProcessEvent', 'buildMediaProtocolUrl', 'allowedDirectoryPaths', 'redactDiagnosticText', 'console', main.slice(start, end));
  const readFile = vi.fn(() => { throw new Error('Streaming must not read the whole file'); });
  const url = (file: string) => `imh-media://local/?path=${encodeURIComponent(file)}`;
  // Generic isReadPathAllowed delegates only to isPathAllowed (library roots), never boardExternalAccess.
  install({ handle: (_name: string, handler: typeof resolveMedia) => { resolveMedia = handler; } }, path, async () => ({}), () => false, () => false, { access: fs.promises.access, readFile }, () => {}, url, new Set(), String, { error: vi.fn() });
  access.authorize('board-1', file);
  expect(access.allows('board-1', file)).toBe(true);
  expect(await resolveMedia({}, file)).toMatchObject({ success: false, errorType: 'PERMISSION_DENIED' });
  expect(readFile).not.toHaveBeenCalled();
});

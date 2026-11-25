import fsp from 'node:fs/promises';
import path from 'node:path';
import { TeamWorkspaceService } from './teamWorkspaceService.mjs';

const MAX_FEEDBACK_BYTES = 2 * 1024 * 1024;

export function registerTeamWorkspaceIpc({ ipcMain, app, dialog, nativeImage, getMainWindow, logger = console }) {
  const service = new TeamWorkspaceService({
    userDataPath: app.getPath('userData'),
    logger,
    onWorkspaceUpdated: (summary) => {
      const window = getMainWindow();
      if (window && !window.isDestroyed()) {
        window.webContents.send('team-workspace-updated', summary);
      }
    },
  });

  const register = (channel, operation) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        const window = getMainWindow();
        if (
          !window
          || window.isDestroyed()
          || event.sender !== window.webContents
          || event.senderFrame !== window.webContents.mainFrame
        ) {
          return {
            success: false,
            code: 'TEAM_ACCESS_DENIED',
            error: 'Team workspaces are accessible only from the main application window.',
          };
        }
        const data = await operation(...args);
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          code: error?.code || 'TEAM_OPERATION_FAILED',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  };

  register('team:detect-workspace', (rootPath) => service.detectWorkspace(rootPath));
  register('team:init-workspace', (args) => service.initWorkspace(args.rootPath, args));
  register('team:open-workspace', (args) => service.openWorkspace(args.rootPath, args));
  register('team:close-workspace', (workspaceId) => service.closeWorkspace(workspaceId));
  register('team:list-workspaces', () => service.listActiveWorkspaces());
  register('team:get-profile', () => service.getLocalProfile());
  register('team:update-profile', (profile) => service.updateLocalProfile(profile));
  register('team:queue-op', (args) => service.queueOperation(args.workspaceId, args.op, { flushNow: Boolean(args.flushNow) }));
  register('team:flush-ops', (workspaceId) => service.flushPendingOps(workspaceId));
  register('team:sync-now', (workspaceId) => (
    workspaceId ? service.reconcileWorkspace(workspaceId) : service.reconcileAllActive()
  ));
  register('team:list-ops', (workspaceId) => service.listOps(workspaceId));
  register('team:list-asset-identities', (workspaceId) => service.listAssetIdentities(workspaceId));
  register('team:upsert-asset-identities', (args) => service.upsertAssetIdentities(args.workspaceId, args.identities));
  register('team:list-prompts', (workspaceId) => service.listTeamPrompts(workspaceId));
  register('team:save-prompt', (args) => service.saveTeamPrompt(args.workspaceId, args.prompt));
  register('team:delete-prompt', (args) => service.deleteTeamPrompt(args.workspaceId, args.promptId));
  register('team:list-boards', (workspaceId) => service.listTeamBoards(workspaceId));
  register('team:load-board', (args) => service.loadTeamBoard(args.workspaceId, args.boardId));
  register('team:save-board', (args) => service.saveTeamBoard(args.workspaceId, args));
  register('team:delete-board', (args) => service.deleteTeamBoard(args.workspaceId, args.boardId));
  register('team:read-models-manifest', (workspaceId) => service.readModelsManifest(workspaceId));
  register('team:write-models-manifest', (args) => service.writeModelsManifest(args.workspaceId, args.models));

  register('team:write-audit-reports', async ({ destDir, csvContent, jsonContent, htmlContent }) => {
    if (typeof destDir !== 'string' || !destDir.trim()) {
      throw new Error('Destination directory is required.');
    }
    const resolvedDir = path.resolve(destDir);
    const written = [];
    if (typeof csvContent === 'string') {
      const target = path.join(resolvedDir, 'PROVENANCE-AUDIT-REPORT.csv');
      await fsp.writeFile(target, csvContent, 'utf8');
      written.push(target);
    }
    if (typeof jsonContent === 'string') {
      const target = path.join(resolvedDir, 'PROVENANCE-AUDIT-REPORT.json');
      await fsp.writeFile(target, jsonContent, 'utf8');
      written.push(target);
    }
    if (typeof htmlContent === 'string') {
      const target = path.join(resolvedDir, 'PROVENANCE-AUDIT-REPORT.html');
      await fsp.writeFile(target, htmlContent, 'utf8');
      written.push(target);
    }
    return { written };
  });

  register('team:save-text-file', async ({ title, defaultPath, filters, content }) => {
    if (!dialog) throw new Error('Save dialog is unavailable.');
    const window = getMainWindow();
    const res = await dialog.showSaveDialog(window, {
      title: title || 'Save file',
      defaultPath: defaultPath || 'export.html',
      filters: Array.isArray(filters) ? filters : [{ name: 'HTML', extensions: ['html'] }],
    });
    if (res.canceled || !res.filePath) return { saved: false, filePath: null };
    await fsp.writeFile(res.filePath, String(content ?? ''), 'utf8');
    return { saved: true, filePath: res.filePath };
  });

  register('team:pick-and-read-feedback', async () => {
    if (!dialog) throw new Error('Open dialog is unavailable.');
    const window = getMainWindow();
    const res = await dialog.showOpenDialog(window, {
      title: 'Import Client Feedback (.imh-feedback.json)',
      properties: ['openFile'],
      filters: [{ name: 'Client Feedback JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths?.[0]) return null;
    const filePath = res.filePaths[0];
    const stat = await fsp.stat(filePath);
    if (stat.size > MAX_FEEDBACK_BYTES) {
      throw new Error('Client feedback file exceeds 2 MB limit.');
    }
    const content = await fsp.readFile(filePath, 'utf8');
    return { filePath, content };
  });

  register('team:build-thumbnail-data-url', async ({ filePath, maxEdge = 768, quality = 80 }) => {
    if (!nativeImage || typeof filePath !== 'string' || !filePath.trim()) return '';
    try {
      const img = nativeImage.createFromPath(filePath);
      if (img.isEmpty()) return '';
      const size = img.getSize();
      const maxDim = Math.max(size.width || 0, size.height || 0);
      const resized = maxDim > maxEdge
        ? (size.width >= size.height
          ? img.resize({ width: maxEdge, quality: 'good' })
          : img.resize({ height: maxEdge, quality: 'good' }))
        : img;
      const jpegBuf = resized.toJPEG(Math.max(40, Math.min(95, Math.round(quality))));
      return `data:image/jpeg;base64,${jpegBuf.toString('base64')}`;
    } catch {
      return '';
    }
  });

  return {
    service,
    reconcileAllActive: () => service.reconcileAllActive(),
    dispose: () => service.dispose(),
  };
}

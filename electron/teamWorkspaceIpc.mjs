import { TeamWorkspaceService } from './teamWorkspaceService.mjs';

export function registerTeamWorkspaceIpc({ ipcMain, app, getMainWindow, logger = console }) {
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

  return {
    service,
    reconcileAllActive: () => service.reconcileAllActive(),
    dispose: () => service.dispose(),
  };
}

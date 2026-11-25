import { create } from 'zustand';
import { reduceTeamOps } from '../services/team/teamOpsReducer';
import type {
  TeamAssetState,
  TeamBoardEnvelope,
  TeamBoardSaveResult,
  TeamBoardSummary,
  TeamCommentPin,
  TeamExpectedModelEntry,
  TeamMemberProfile,
  TeamModelsManifest,
  TeamOpEvent,
  TeamOpInput,
  TeamSharedPrompt,
  TeamSharedPromptInput,
  TeamWorkspaceSummary,
  WorkspaceAssetIdentity,
} from '../services/team/teamWorkspaceTypes';

export interface TeamApiResult<T> {
  success: boolean;
  data?: T;
  code?: string;
  error?: string;
}

interface TeamWorkspaceStoreState {
  initialized: boolean;
  localProfile: TeamMemberProfile | null;
  workspacesById: Record<string, TeamWorkspaceSummary>;
  assetStatesByWorkspace: Record<string, Record<string, TeamAssetState>>;
  teamPromptsByWorkspace: Record<string, TeamSharedPrompt[]>;
  teamBoardsByWorkspace: Record<string, TeamBoardSummary[]>;
  modelsManifestByWorkspace: Record<string, TeamModelsManifest | null>;
  linkedBoardsByLocalId: Record<string, { workspaceId: string; boardId: string; revision: number; contentHash: string }>;
  syncingWorkspaceIds: Record<string, boolean>;
  reviewStatusFilter: 'all' | 'approved' | 'needs_changes' | 'in_review' | 'rejected' | 'conflict' | 'unreviewed';
  pinPlacementActive: boolean;
  draftPin: TeamCommentPin | null;
  highlightedCommentId: string | null;
  error: string | null;

  initialize: () => Promise<void>;
  setReviewStatusFilter: (filter: 'all' | 'approved' | 'needs_changes' | 'in_review' | 'rejected' | 'conflict' | 'unreviewed') => void;
  setPinPlacementActive: (active: boolean) => void;
  setDraftPin: (pin: TeamCommentPin | null) => void;
  setHighlightedCommentId: (commentId: string | null) => void;
  setLinkedBoardMeta: (localBoardId: string, meta: { workspaceId: string; boardId: string; revision: number; contentHash: string } | null) => void;
  detectWorkspace: (rootPath: string) => Promise<{ manifest: TeamWorkspaceSummary['manifest']; rootPath: string } | null>;
  initWorkspace: (rootPath: string, name?: string) => Promise<TeamWorkspaceSummary | null>;
  openWorkspace: (rootPath: string) => Promise<TeamWorkspaceSummary | null>;
  closeWorkspace: (workspaceId: string) => Promise<void>;
  updateProfile: (profile: Partial<Pick<TeamMemberProfile, 'displayName' | 'initials' | 'color'>>) => Promise<TeamMemberProfile | null>;
  syncNow: (workspaceId?: string) => Promise<void>;
  refreshWorkspaceOps: (workspaceId: string) => Promise<void>;
  queueOp: (workspaceId: string, op: TeamOpInput, flushNow?: boolean) => Promise<TeamOpEvent | null>;
  upsertAssetIdentities: (workspaceId: string, identities: WorkspaceAssetIdentity[]) => Promise<void>;
  refreshTeamResources: (workspaceId: string) => Promise<void>;
  saveTeamPrompt: (workspaceId: string, prompt: TeamSharedPromptInput) => Promise<TeamSharedPrompt | null>;
  deleteTeamPrompt: (workspaceId: string, promptId: string) => Promise<boolean>;
  loadTeamBoard: (workspaceId: string, boardId: string) => Promise<TeamBoardEnvelope | null>;
  saveTeamBoard: (args: { workspaceId: string; boardId?: string; name: string; document: Record<string, unknown>; expectedRevision?: number; expectedHash?: string | null; forceOverwrite?: boolean }) => Promise<TeamBoardSaveResult | null>;
  deleteTeamBoard: (workspaceId: string, boardId: string) => Promise<boolean>;
  writeModelsManifest: (workspaceId: string, models: TeamExpectedModelEntry[]) => Promise<TeamModelsManifest | null>;
  getWorkspaceForRootPath: (rootPath: string) => TeamWorkspaceSummary | null;
}

let unsubscribeUpdated: (() => void) | null = null;

function mapToRecord(map: Map<string, TeamAssetState>): Record<string, TeamAssetState> {
  const out: Record<string, TeamAssetState> = {};
  for (const [key, value] of map.entries()) {
    out[key] = value;
  }
  return out;
}

function normalizePathForCompare(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export const useTeamWorkspaceStore = create<TeamWorkspaceStoreState>((set, get) => ({
  initialized: false,
  localProfile: null,
  workspacesById: {},
  assetStatesByWorkspace: {},
  teamPromptsByWorkspace: {},
  teamBoardsByWorkspace: {},
  modelsManifestByWorkspace: {},
  linkedBoardsByLocalId: {},
  syncingWorkspaceIds: {},
  reviewStatusFilter: 'all',
  pinPlacementActive: false,
  draftPin: null,
  highlightedCommentId: null,
  error: null,

  setReviewStatusFilter: (reviewStatusFilter) => set({ reviewStatusFilter }),
  setPinPlacementActive: (pinPlacementActive) => set({ pinPlacementActive }),
  setDraftPin: (draftPin) => set({ draftPin }),
  setHighlightedCommentId: (highlightedCommentId) => set({ highlightedCommentId }),
  setLinkedBoardMeta: (localBoardId, meta) => set((state) => {
    const next = { ...state.linkedBoardsByLocalId };
    if (meta) next[localBoardId] = meta;
    else delete next[localBoardId];
    return { linkedBoardsByLocalId: next };
  }),

  initialize: async () => {
    const bridge = typeof window !== 'undefined' ? window.electronAPI?.team : undefined;
    if (!bridge) {
      set({ initialized: true });
      return;
    }

    if (!unsubscribeUpdated) {
      unsubscribeUpdated = bridge.onWorkspaceUpdated((summary) => {
        set((state) => ({
          workspacesById: {
            ...state.workspacesById,
            [summary.manifest.workspaceId]: summary,
          },
          localProfile: summary.localProfile,
        }));
        void get().refreshWorkspaceOps(summary.manifest.workspaceId);
        void get().refreshTeamResources(summary.manifest.workspaceId);
      });
    }

    const [profileRes, listRes] = await Promise.all([
      bridge.getProfile(),
      bridge.listWorkspaces(),
    ]);

    const workspacesById: Record<string, TeamWorkspaceSummary> = {};
    if (listRes.success && Array.isArray(listRes.data)) {
      for (const summary of listRes.data) {
        workspacesById[summary.manifest.workspaceId] = summary;
      }
    }

    set({
      initialized: true,
      localProfile: profileRes.success ? (profileRes.data ?? null) : null,
      workspacesById,
      error: null,
    });

    await Promise.all(Object.keys(workspacesById).map(async (id) => {
      await get().refreshWorkspaceOps(id);
      await get().refreshTeamResources(id);
    }));
  },

  detectWorkspace: async (rootPath) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return null;
    const res = await bridge.detectWorkspace(rootPath);
    return res.success ? (res.data ?? null) : null;
  },

  initWorkspace: async (rootPath, name) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return null;
    const res = await bridge.initWorkspace({ rootPath, name });
    if (!res.success || !res.data) {
      set({ error: res.error || 'Failed to initialize Team Workspace.' });
      return null;
    }
    const summary = res.data;
    set((state) => ({
      workspacesById: { ...state.workspacesById, [summary.manifest.workspaceId]: summary },
      localProfile: summary.localProfile,
      error: null,
    }));
    await get().refreshWorkspaceOps(summary.manifest.workspaceId);
    await get().refreshTeamResources(summary.manifest.workspaceId);
    return summary;
  },

  openWorkspace: async (rootPath) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return null;
    const res = await bridge.openWorkspace({ rootPath });
    if (!res.success || !res.data) {
      set({ error: res.error || 'Failed to open Team Workspace.' });
      return null;
    }
    const summary = res.data;
    set((state) => ({
      workspacesById: { ...state.workspacesById, [summary.manifest.workspaceId]: summary },
      localProfile: summary.localProfile,
      error: null,
    }));
    await get().refreshWorkspaceOps(summary.manifest.workspaceId);
    await get().refreshTeamResources(summary.manifest.workspaceId);
    return summary;
  },

  closeWorkspace: async (workspaceId) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return;
    await bridge.closeWorkspace(workspaceId);
    set((state) => {
      const nextWorkspaces = { ...state.workspacesById };
      const nextAssets = { ...state.assetStatesByWorkspace };
      delete nextWorkspaces[workspaceId];
      delete nextAssets[workspaceId];
      return { workspacesById: nextWorkspaces, assetStatesByWorkspace: nextAssets };
    });
  },

  updateProfile: async (profile) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return null;
    const res = await bridge.updateProfile(profile);
    if (!res.success || !res.data) {
      set({ error: res.error || 'Failed to update profile.' });
      return null;
    }
    set({ localProfile: res.data, error: null });
    return res.data;
  },

  syncNow: async (workspaceId) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return;
    const targetIds = workspaceId ? [workspaceId] : Object.keys(get().workspacesById);
    set((state) => {
      const next = { ...state.syncingWorkspaceIds };
      targetIds.forEach((id) => { next[id] = true; });
      return { syncingWorkspaceIds: next };
    });
    try {
      await bridge.syncNow(workspaceId);
      await Promise.all(targetIds.map(async (id) => {
        await get().refreshWorkspaceOps(id);
        await get().refreshTeamResources(id);
      }));
    } finally {
      set((state) => {
        const next = { ...state.syncingWorkspaceIds };
        targetIds.forEach((id) => { next[id] = false; });
        return { syncingWorkspaceIds: next };
      });
    }
  },

  refreshWorkspaceOps: async (workspaceId) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return;
    const res = await bridge.listOps(workspaceId);
    if (!res.success || !Array.isArray(res.data)) return;
    const reduced = reduceTeamOps(res.data);
    const reducedRecord = mapToRecord(reduced);
    set((state) => ({
      assetStatesByWorkspace: {
        ...state.assetStatesByWorkspace,
        [workspaceId]: reducedRecord,
      },
    }));

    // Propagate remote tags, ratings, and favorites into the local image library without re-emitting.
    try {
      const [{ useImageStore }, { computeTeamAnnotationDiffs, runWithRemoteTeamSyncGuard }] = await Promise.all([
        import('./useImageStore'),
        import('../services/team/teamAnnotationSync'),
      ]);
      const imageState = useImageStore.getState();
      const diffs = computeTeamAnnotationDiffs(
        imageState.images,
        imageState.directories,
        workspaceId,
        get().workspacesById,
        reducedRecord,
      );
      if (diffs.length > 0) {
        await runWithRemoteTeamSyncGuard(() => imageState.applySyncedTeamAnnotations(diffs));
      }
    } catch {
      // Non-fatal in isolated test environments without full image store hydration.
    }
  },

  queueOp: async (workspaceId, op, flushNow = false) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return null;
    const res = await bridge.queueOp({ workspaceId, op, flushNow });
    if (!res.success || !res.data) {
      set({ error: res.error || 'Failed to record team operation.' });
      return null;
    }
    if (flushNow) {
      await get().refreshWorkspaceOps(workspaceId);
    }
    return res.data;
  },

  upsertAssetIdentities: async (workspaceId, identities) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return;
    await bridge.upsertAssetIdentities({ workspaceId, identities });
  },

  refreshTeamResources: async (workspaceId) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return;
    const [promptsRes, boardsRes, manifestRes] = await Promise.all([
      bridge.listPrompts(workspaceId),
      bridge.listBoards(workspaceId),
      bridge.readModelsManifest(workspaceId),
    ]);
    set((state) => ({
      teamPromptsByWorkspace: promptsRes.success && Array.isArray(promptsRes.data)
        ? { ...state.teamPromptsByWorkspace, [workspaceId]: promptsRes.data }
        : state.teamPromptsByWorkspace,
      teamBoardsByWorkspace: boardsRes.success && Array.isArray(boardsRes.data)
        ? { ...state.teamBoardsByWorkspace, [workspaceId]: boardsRes.data }
        : state.teamBoardsByWorkspace,
      modelsManifestByWorkspace: manifestRes.success
        ? { ...state.modelsManifestByWorkspace, [workspaceId]: manifestRes.data ?? null }
        : state.modelsManifestByWorkspace,
    }));
  },

  saveTeamPrompt: async (workspaceId, prompt) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return null;
    const res = await bridge.savePrompt({ workspaceId, prompt });
    if (!res.success || !res.data) {
      set({ error: res.error || 'Failed to save team prompt.' });
      return null;
    }
    await get().refreshTeamResources(workspaceId);
    return res.data;
  },

  deleteTeamPrompt: async (workspaceId, promptId) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return false;
    const res = await bridge.deletePrompt({ workspaceId, promptId });
    if (res.success && res.data?.deleted) {
      await get().refreshTeamResources(workspaceId);
      return true;
    }
    return false;
  },

  loadTeamBoard: async (workspaceId, boardId) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return null;
    const res = await bridge.loadBoard({ workspaceId, boardId });
    return res.success ? (res.data ?? null) : null;
  },

  saveTeamBoard: async (args) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return null;
    const res = await bridge.saveBoard(args);
    if (!res.success || !res.data) {
      set({ error: res.error || 'Failed to save team board.' });
      return null;
    }
    if (res.data.saved) {
      await get().refreshTeamResources(args.workspaceId);
    }
    return res.data;
  },

  deleteTeamBoard: async (workspaceId, boardId) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return false;
    const res = await bridge.deleteBoard({ workspaceId, boardId });
    if (res.success && res.data?.deleted) {
      await get().refreshTeamResources(workspaceId);
      return true;
    }
    return false;
  },

  writeModelsManifest: async (workspaceId, models) => {
    const bridge = window.electronAPI?.team;
    if (!bridge) return null;
    const res = await bridge.writeModelsManifest({ workspaceId, models });
    if (!res.success || !res.data) {
      set({ error: res.error || 'Failed to write project models manifest.' });
      return null;
    }
    set((state) => ({
      modelsManifestByWorkspace: { ...state.modelsManifestByWorkspace, [workspaceId]: res.data! },
    }));
    return res.data;
  },

  getWorkspaceForRootPath: (rootPath) => {
    const normalized = normalizePathForCompare(rootPath);
    const workspaces = Object.values(get().workspacesById);
    return workspaces.find((ws) => normalizePathForCompare(ws.rootPath) === normalized) ?? null;
  },
}));

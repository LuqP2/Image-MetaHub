import { create } from 'zustand';
import { reduceTeamOps } from '../services/team/teamOpsReducer';
import type {
  TeamAssetState,
  TeamMemberProfile,
  TeamOpEvent,
  TeamOpInput,
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
  syncingWorkspaceIds: Record<string, boolean>;
  reviewStatusFilter: 'all' | 'approved' | 'needs_changes' | 'in_review' | 'rejected' | 'conflict' | 'unreviewed';
  error: string | null;

  initialize: () => Promise<void>;
  setReviewStatusFilter: (filter: 'all' | 'approved' | 'needs_changes' | 'in_review' | 'rejected' | 'conflict' | 'unreviewed') => void;
  detectWorkspace: (rootPath: string) => Promise<{ manifest: TeamWorkspaceSummary['manifest']; rootPath: string } | null>;
  initWorkspace: (rootPath: string, name?: string) => Promise<TeamWorkspaceSummary | null>;
  openWorkspace: (rootPath: string) => Promise<TeamWorkspaceSummary | null>;
  closeWorkspace: (workspaceId: string) => Promise<void>;
  updateProfile: (profile: Partial<Pick<TeamMemberProfile, 'displayName' | 'initials' | 'color'>>) => Promise<TeamMemberProfile | null>;
  syncNow: (workspaceId?: string) => Promise<void>;
  refreshWorkspaceOps: (workspaceId: string) => Promise<void>;
  queueOp: (workspaceId: string, op: TeamOpInput, flushNow?: boolean) => Promise<TeamOpEvent | null>;
  upsertAssetIdentities: (workspaceId: string, identities: WorkspaceAssetIdentity[]) => Promise<void>;
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
  syncingWorkspaceIds: {},
  reviewStatusFilter: 'all',
  error: null,

  setReviewStatusFilter: (reviewStatusFilter) => set({ reviewStatusFilter }),

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

    await Promise.all(Object.keys(workspacesById).map((id) => get().refreshWorkspaceOps(id)));
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
      await Promise.all(targetIds.map((id) => get().refreshWorkspaceOps(id)));
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
    set((state) => ({
      assetStatesByWorkspace: {
        ...state.assetStatesByWorkspace,
        [workspaceId]: mapToRecord(reduced),
      },
    }));
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

  getWorkspaceForRootPath: (rootPath) => {
    const normalized = normalizePathForCompare(rootPath);
    const workspaces = Object.values(get().workspacesById);
    return workspaces.find((ws) => normalizePathForCompare(ws.rootPath) === normalized) ?? null;
  },
}));

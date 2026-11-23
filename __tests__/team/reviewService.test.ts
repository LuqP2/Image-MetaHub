import { describe, expect, it } from 'vitest';
import {
  filterApprovedDeliveryImages,
  filterImagesByTeamReview,
  resolveImageTeamContext,
} from '../../services/team/reviewService';
import { buildWorkspaceAssetKey } from '../../services/team/teamOpsReducer';
import type { TeamAssetState, TeamWorkspaceSummary } from '../../services/team/teamWorkspaceTypes';
import type { Directory, IndexedImage } from '../../types';

const DIRECTORIES: Directory[] = [
  { id: 'dir-team', name: 'Studio Project', path: 'Z:\\Studio\\ProjectA', handle: null as unknown as FileSystemDirectoryHandle },
  { id: 'dir-personal', name: 'Personal', path: 'D:\\Personal', handle: null as unknown as FileSystemDirectoryHandle },
];

const WORKSPACES_BY_ID: Record<string, TeamWorkspaceSummary> = {
  'ws-1': {
    manifest: {
      schemaVersion: 1,
      workspaceId: 'ws-1',
      name: 'Studio Project',
      createdAt: '2026-11-23T10:00:00.000Z',
      createdByDeviceId: 'dev-a',
    },
    rootPath: 'Z:/Studio/ProjectA',
    localProfile: { deviceId: 'dev-a', displayName: 'Alice', initials: 'AL', color: '#3B82F6', updatedAt: '2026-11-23T10:00:00.000Z' },
    members: [],
    syncStatus: {
      workspaceId: 'ws-1',
      rootPath: 'Z:/Studio/ProjectA',
      name: 'Studio Project',
      state: 'idle',
      lastSyncedAt: null,
      appliedFileCount: 1,
      appliedOpCount: 3,
      pendingLocalOps: 0,
      memberCount: 1,
      error: null,
    },
  },
};

function makeImage(id: string, directoryId: string, name: string): IndexedImage {
  return {
    id,
    directoryId,
    name,
    handle: null as unknown as FileSystemFileHandle,
    metadata: {} as IndexedImage['metadata'],
    metadataString: '',
    lastModified: Date.now(),
    models: [],
    loras: [],
    scheduler: '',
  };
}

function makeState(relativePath: string, overrides: Partial<TeamAssetState>): TeamAssetState {
  const assetKey = buildWorkspaceAssetKey(relativePath, null);
  return {
    assetKey,
    relativePath,
    contentHash: null,
    tags: [],
    rating: null,
    isFavorite: false,
    reviewStatus: 'none',
    reviewDecision: null,
    reviewConflict: null,
    comments: [],
    shadowPatch: null,
    lastLamportClock: 1,
    ...overrides,
  };
}

describe('reviewService filtering and Client Delivery Pack', () => {
  const approvedKey = buildWorkspaceAssetKey('shots/approved.png', null);
  const changesKey = buildWorkspaceAssetKey('shots/changes.png', null);
  const conflictKey = buildWorkspaceAssetKey('shots/conflict.png', null);

  const assetStatesByWorkspace: Record<string, Record<string, TeamAssetState>> = {
    'ws-1': {
      [approvedKey]: makeState('shots/approved.png', { reviewStatus: 'approved' }),
      [changesKey]: makeState('shots/changes.png', { reviewStatus: 'needs_changes' }),
      [conflictKey]: makeState('shots/conflict.png', {
        reviewStatus: 'approved',
        reviewConflict: {
          baseOpId: null,
          competingDecisions: [
            { opId: 'op-a', status: 'approved', deviceId: 'dev-a', authorName: 'Alice', lamportClock: 2, createdAt: '2026-11-23T10:00:00.000Z', baseOpId: null },
            { opId: 'op-b', status: 'needs_changes', deviceId: 'dev-b', authorName: 'Bob', lamportClock: 2, createdAt: '2026-11-23T10:01:00.000Z', baseOpId: null },
          ],
        },
      }),
    },
  };

  const images = [
    makeImage('1', 'dir-team', 'shots\\approved.png'),
    makeImage('2', 'dir-team', 'shots/changes.png'),
    makeImage('3', 'dir-team', 'shots/conflict.png'),
    makeImage('4', 'dir-team', 'shots/unreviewed.png'),
    makeImage('5', 'dir-personal', 'personal.png'),
  ];

  it('resolves team context for workspace folders and returns null for personal folders', () => {
    const teamCtx = resolveImageTeamContext(images[0], DIRECTORIES, WORKSPACES_BY_ID, assetStatesByWorkspace);
    expect(teamCtx?.workspaceId).toBe('ws-1');
    expect(teamCtx?.assetState?.reviewStatus).toBe('approved');

    const personalCtx = resolveImageTeamContext(images[4], DIRECTORIES, WORKSPACES_BY_ID, assetStatesByWorkspace);
    expect(personalCtx).toBeNull();
  });

  it('filters library images accurately by review status and conflict state', () => {
    expect(filterImagesByTeamReview(images, 'approved', DIRECTORIES, WORKSPACES_BY_ID, assetStatesByWorkspace).map((i) => i.id)).toEqual(['1']);
    expect(filterImagesByTeamReview(images, 'needs_changes', DIRECTORIES, WORKSPACES_BY_ID, assetStatesByWorkspace).map((i) => i.id)).toEqual(['2']);
    expect(filterImagesByTeamReview(images, 'conflict', DIRECTORIES, WORKSPACES_BY_ID, assetStatesByWorkspace).map((i) => i.id)).toEqual(['3']);
    expect(filterImagesByTeamReview(images, 'unreviewed', DIRECTORIES, WORKSPACES_BY_ID, assetStatesByWorkspace).map((i) => i.id)).toEqual(['4']);
    expect(filterImagesByTeamReview(images, 'all', DIRECTORIES, WORKSPACES_BY_ID, assetStatesByWorkspace)).toHaveLength(5);
  });

  it('Client Delivery Pack exports only cleanly approved assets and excludes unresolved conflicts', () => {
    const deliverable = filterApprovedDeliveryImages(images, DIRECTORIES, WORKSPACES_BY_ID, assetStatesByWorkspace);
    expect(deliverable.map((i) => i.id)).toEqual(['1']);
  });
});

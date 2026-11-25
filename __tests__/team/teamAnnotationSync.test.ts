import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeTeamAnnotationDiffs,
  hasTeamWriteAccess,
} from '../../services/team/teamAnnotationSync';
import { buildWorkspaceAssetKey, reduceTeamOps } from '../../services/team/teamOpsReducer';
import { useLicenseStore } from '../../store/useLicenseStore';
import type { TeamAssetState, TeamWorkspaceSummary } from '../../services/team/teamWorkspaceTypes';
import type { Directory, IndexedImage } from '../../types';

describe('teamAnnotationSync & Teams license gating', () => {
  beforeEach(() => {
    useLicenseStore.setState({
      initialized: true,
      licenseStatus: 'free',
      licenseTier: null,
      trialStartDate: null,
      trialActivated: false,
      trialExtensionStartDate: null,
      trialRelease023: null,
    });
  });

  it('enforces canUseTeams / hasTeamWriteAccess for free, pro, teams, and active trial', () => {
    expect(hasTeamWriteAccess()).toBe(false);

    useLicenseStore.setState({ licenseStatus: 'pro', licenseTier: 'pro' });
    expect(hasTeamWriteAccess()).toBe(false);

    useLicenseStore.setState({ licenseStatus: 'pro', licenseTier: 'teams' });
    expect(hasTeamWriteAccess()).toBe(true);

    useLicenseStore.setState({
      licenseStatus: 'trial',
      licenseTier: null,
      trialStartDate: Date.now() - 60_000,
      trialActivated: true,
    });
    expect(hasTeamWriteAccess()).toBe(true);
  });

  it('computes exact annotation diffs for remote tags, ratings, and favorites', () => {
    const directories: Directory[] = [
      { id: 'dir-1', name: 'Studio', path: 'Z:\\Studio\\ProjectA', handle: null as unknown as FileSystemDirectoryHandle },
    ];
    const workspacesById: Record<string, TeamWorkspaceSummary> = {
      'ws-1': {
        manifest: {
          schemaVersion: 1,
          workspaceId: 'ws-1',
          name: 'ProjectA',
          createdAt: '2026-11-23T10:00:00.000Z',
          createdByDeviceId: 'dev-a',
        },
        rootPath: 'Z:/Studio/ProjectA',
        localProfile: { deviceId: 'dev-a', displayName: 'Alice', initials: 'AL', color: '#3B82F6', updatedAt: '2026-11-23T10:00:00.000Z' },
        members: [],
        syncStatus: {
          workspaceId: 'ws-1',
          rootPath: 'Z:/Studio/ProjectA',
          name: 'ProjectA',
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

    const key1 = buildWorkspaceAssetKey('shots/a.png', null);
    const key2 = buildWorkspaceAssetKey('shots/b.png', null);
    const remoteStates: Record<string, TeamAssetState> = {
      [key1]: {
        assetKey: key1,
        relativePath: 'shots/a.png',
        contentHash: null,
        annotationFields: { tags: true, rating: true, isFavorite: true },
        tags: ['hero', 'lighting'],
        rating: 5,
        isFavorite: true,
        reviewStatus: 'approved',
        reviewDecision: null,
        reviewConflict: null,
        comments: [],
        shadowPatch: null,
        lastLamportClock: 3,
      },
      [key2]: {
        assetKey: key2,
        relativePath: 'shots/b.png',
        contentHash: null,
        annotationFields: { tags: true, rating: true, isFavorite: true },
        tags: ['wip'],
        rating: 3,
        isFavorite: false,
        reviewStatus: 'none',
        reviewDecision: null,
        reviewConflict: null,
        comments: [],
        shadowPatch: null,
        lastLamportClock: 2,
      },
    };

    const images: IndexedImage[] = [
      {
        id: 'img-1',
        directoryId: 'dir-1',
        name: 'shots/a.png',
        handle: null as unknown as FileSystemFileHandle,
        metadata: {} as IndexedImage['metadata'],
        metadataString: '',
        lastModified: Date.now(),
        models: [],
        loras: [],
        scheduler: '',
        isFavorite: false,
        rating: null,
        tags: [],
      },
      {
        id: 'img-2',
        directoryId: 'dir-1',
        name: 'shots/b.png',
        handle: null as unknown as FileSystemFileHandle,
        metadata: {} as IndexedImage['metadata'],
        metadataString: '',
        lastModified: Date.now(),
        models: [],
        loras: [],
        scheduler: '',
        isFavorite: false,
        rating: 3,
        tags: ['wip'],
      },
    ];

    const existing = { ...images[0], isFavorite: true, rating: 4 as const, tags: ['local'] };
    const base = {
      workspaceId: 'ws-1', assetKey: key1, relativePath: 'shots/a.png', contentHash: null,
      deviceId: 'remote', createdAt: '2026-11-25T00:00:00Z',
    };
    const reviewOps = [
      { ...base, opId: 'review', lamportClock: 1, type: 'set_review_status' as const, status: 'approved' as const, baseOpId: null },
      { ...base, opId: 'comment', lamportClock: 2, type: 'add_comment' as const, commentId: 'c1', text: 'Review only' },
    ];
    const diffFor = (ops: Parameters<typeof reduceTeamOps>[0]) => computeTeamAnnotationDiffs(
      [existing], directories, 'ws-1', workspacesById, Object.fromEntries(reduceTeamOps(ops)),
    );
    expect(diffFor(reviewOps)).toEqual([]);
    // Each explicit clear is authoritative without touching either of the other fields.
    expect(diffFor([...reviewOps, { ...base, opId: 'rating', lamportClock: 3, type: 'set_rating', rating: null }]))
      .toEqual([{ imageId: existing.id, rating: null }]);
    expect(diffFor([...reviewOps, { ...base, opId: 'favorite', lamportClock: 3, type: 'set_favorite', isFavorite: false }]))
      .toEqual([{ imageId: existing.id, isFavorite: false }]);
    expect(diffFor([...reviewOps, { ...base, opId: 'tags', lamportClock: 3, type: 'tags_remove', tags: ['local'] }]))
      .toEqual([{ imageId: existing.id, tags: [] }]);

    const diffs = computeTeamAnnotationDiffs(images, directories, 'ws-1', workspacesById, remoteStates);
    expect(diffs).toEqual([
      {
        imageId: 'img-1',
        isFavorite: true,
        rating: 5,
        tags: ['hero', 'lighting'],
      },
    ]);
  });
});

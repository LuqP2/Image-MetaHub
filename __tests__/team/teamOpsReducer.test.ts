import { describe, expect, it } from 'vitest';
import { reduceTeamOps } from '../../services/team/teamOpsReducer';
import type { TeamOpEvent } from '../../services/team/teamWorkspaceTypes';

const BASE_OP = {
  workspaceId: 'ws-1',
  assetKey: 'h:abc123|p:shots/shot01.png',
  relativePath: 'shots/shot01.png',
  contentHash: 'abc123',
};

describe('reduceTeamOps', () => {
  it('converges deterministically regardless of operation ingestion order or duplicates', () => {
    const ops: TeamOpEvent[] = [
      {
        ...BASE_OP,
        opId: 'op-1',
        deviceId: 'dev-a',
        lamportClock: 1,
        createdAt: '2026-11-23T10:00:00.000Z',
        type: 'tags_add',
        tags: ['Hero', 'Lighting'],
      },
      {
        ...BASE_OP,
        opId: 'op-2',
        deviceId: 'dev-b',
        lamportClock: 2,
        createdAt: '2026-11-23T09:55:00.000Z', // Intentionally earlier wall-clock (clock skew)
        type: 'set_rating',
        rating: 5,
      },
      {
        ...BASE_OP,
        opId: 'op-3',
        deviceId: 'dev-a',
        lamportClock: 3,
        createdAt: '2026-11-23T10:05:00.000Z',
        type: 'set_favorite',
        isFavorite: true,
      },
      {
        ...BASE_OP,
        opId: 'op-4',
        deviceId: 'dev-b',
        lamportClock: 4,
        createdAt: '2026-11-23T10:06:00.000Z',
        type: 'tags_remove',
        tags: ['lighting'],
        observedAddOpIds: ['op-1'],
      },
    ];

    const forward = reduceTeamOps(ops).get(BASE_OP.assetKey);
    const reversedWithDups = reduceTeamOps([...ops].reverse().concat([ops[0], ops[2]])).get(BASE_OP.assetKey);

    expect(forward).toEqual(reversedWithDups);
    expect(forward?.tags).toEqual(['hero']);
    expect(forward?.rating).toBe(5);
    expect(forward?.isFavorite).toBe(true);
  });

  it('detects concurrent review/approval conflicts instead of silently overwriting by wall-clock', () => {
    const initialInReview: TeamOpEvent = {
      ...BASE_OP,
      opId: 'rev-1',
      deviceId: 'dev-artist',
      lamportClock: 1,
      createdAt: '2026-11-23T10:00:00.000Z',
      authorName: 'Artist',
      type: 'set_review_status',
      status: 'in_review',
      baseOpId: null,
    };

    // Two leads concurrently review from the same baseOpId ('rev-1') before syncing
    const leadAApproves: TeamOpEvent = {
      ...BASE_OP,
      opId: 'rev-2a',
      deviceId: 'dev-lead-a',
      lamportClock: 2,
      createdAt: '2026-11-23T10:01:00.000Z',
      authorName: 'Director A',
      type: 'set_review_status',
      status: 'approved',
      baseOpId: 'rev-1',
    };

    const leadBRequestsChanges: TeamOpEvent = {
      ...BASE_OP,
      opId: 'rev-2b',
      deviceId: 'dev-lead-b',
      lamportClock: 2,
      createdAt: '2026-11-23T10:02:00.000Z',
      authorName: 'Director B',
      type: 'set_review_status',
      status: 'needs_changes',
      baseOpId: 'rev-1',
      note: 'Fix hand anatomy',
    };

    const conflicted = reduceTeamOps([initialInReview, leadAApproves, leadBRequestsChanges]).get(BASE_OP.assetKey);
    expect(conflicted?.reviewConflict).not.toBeNull();
    expect(conflicted?.reviewConflict?.competingDecisions).toHaveLength(2);
    expect(conflicted?.reviewConflict?.competingDecisions.map((d) => d.status).sort()).toEqual([
      'approved',
      'needs_changes',
    ]);

    // Explicit resolution clears the conflict
    const resolution: TeamOpEvent = {
      ...BASE_OP,
      opId: 'rev-3',
      deviceId: 'dev-lead-a',
      lamportClock: 3,
      createdAt: '2026-11-23T10:10:00.000Z',
      authorName: 'Director A',
      type: 'resolve_review_conflict',
      status: 'needs_changes',
      resolvedOpIds: ['rev-2a', 'rev-2b'],
      note: 'Agreed, will fix hand first',
    };

    const resolved = reduceTeamOps([initialInReview, leadAApproves, leadBRequestsChanges, resolution]).get(BASE_OP.assetKey);
    expect(resolved?.reviewConflict).toBeNull();
    expect(resolved?.reviewStatus).toBe('needs_changes');
    expect(resolved?.reviewDecision?.opId).toBe('rev-3');
  });

  it('merges asset history across asset_moved operations', () => {
    const oldKey = 'h:abc123|p:shots/old_name.png';
    const newKey = 'h:abc123|p:shots/new_name.png';

    const ops: TeamOpEvent[] = [
      {
        workspaceId: 'ws-1',
        opId: 'op-1',
        deviceId: 'dev-a',
        lamportClock: 1,
        createdAt: '2026-11-23T10:00:00.000Z',
        assetKey: oldKey,
        relativePath: 'shots/old_name.png',
        contentHash: 'abc123',
        type: 'tags_add',
        tags: ['final-candidate'],
      },
      {
        workspaceId: 'ws-1',
        opId: 'op-2',
        deviceId: 'dev-a',
        lamportClock: 2,
        createdAt: '2026-11-23T10:01:00.000Z',
        assetKey: newKey,
        relativePath: 'shots/new_name.png',
        contentHash: 'abc123',
        type: 'asset_moved',
        previousAssetKey: oldKey,
        previousRelativePath: 'shots/old_name.png',
      },
      {
        workspaceId: 'ws-1',
        opId: 'op-3',
        deviceId: 'dev-b',
        lamportClock: 3,
        createdAt: '2026-11-23T10:02:00.000Z',
        assetKey: newKey,
        relativePath: 'shots/new_name.png',
        contentHash: 'abc123',
        type: 'add_comment',
        commentId: 'c-1',
        text: 'Looks sharp!',
      },
    ];

    const stateMap = reduceTeamOps(ops);
    expect(stateMap.has(oldKey)).toBe(false);
    const merged = stateMap.get(newKey);
    expect(merged?.relativePath).toBe('shots/new_name.png');
    expect(merged?.tags).toEqual(['final-candidate']);
    expect(merged?.comments).toHaveLength(1);
    expect(merged?.comments[0].text).toBe('Looks sharp!');
  });
});
